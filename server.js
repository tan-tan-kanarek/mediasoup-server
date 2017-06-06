'use strict';

process.env.DEBUG = "mediasoup*";
	

const os = require('os');
const ip = require('ip');
const fs = require('fs');
const net = require('net');
const url = require('url');
const udid = require('udid');
const util = require('util');
const path = require('path');
const rtsp = require('rtsp-stream');
const dgram = require('dgram');
const https = require('https');
const express = require('express');
const Promise = require('bluebird');
const socketIO = require('socket.io');
const child_process = require('child_process');
const sdp_transform = require('sdp-transform');

const mediasoup = require('mediasoup');
const RTCPeerConnection = mediasoup.webrtc.RTCPeerConnection;
const RTCSessionDescription = mediasoup.webrtc.RTCSessionDescription;
const roomOptions = require('./data/options').roomOptions;
const peerCapabilities = require('./data/options').peerCapabilities;

const OutputTypes = {
	RTMP: 1,
	MKV: 2,
	MP4: 3
};

class Room {
	
	constructor(mediaServer, name){
		const d = new Date();
		this.id = udid('y' + name + d.getTime());
		this.name = name;
		this.mediaServer = mediaServer;
	}
	
	init() {
		let This = this;

		return new Promise((resolve, reject) => {
			This.mediaServer.createRoom(roomOptions)
    	    .then((mediaRoom) => {
				This.mediaRoom = mediaRoom;
				resolve(This);
    	    })
			.catch((err) => reject(err));
		});
	}

}

const max32 = Math.pow(2, 32) - 1;

class Connection {
	constructor(server, socket){
		this.server = server;
		this.socket = socket;
		this.peerconnection = null;

		this.id = socket.id;
//		this.id = Math.floor(Math.random() * max32).toString();
		this.sdp = null;
		this.roomId = null;
		this.mediaPeer = null;

		let This = this;

		server.addConnection(this);
		
		// socket.io
		socket.on('disconnect', () => {
			This.closePeerConnection();
			server.removeConnection(This.id);
		});
		
		socket.on('error', (err) => {
			console.error('ERROR:', err);
		});

		socket.on('list', () => {
			This.debug(`Receive [${This.id}] [list]`);
			This.send('list', This.server.getRoomsList());
		});

		socket.on('create-room', (name) => {
			This.debug(`Receive [${This.id}] [create-room] name [${name}]`);
			This.server.addRoom(name).
			then((room) => {
				This.send('room-created', {
					id: room.id,
					name: room.name
				});
			});
		});

		socket.on('join', (message) => {
			This.debug(`Receive [${This.id}] [join] room id [${message.roomId}]`);
			socket.join(message.roomId);
			This.roomId = message.roomId;
			This.handleOffer(message.sdp, message.planb);
		});

		socket.on('joined', (answer) => {
			This.debug(`Receive [${This.id}] [joined]`);
			This.handleAnswer(answer);
		});

		socket.on('quit', () => {
			This.debug(`Receive [${This.id}] [quit]`);
			This.closePeerConnection();
		});
	}

	debug(message) {
		this.server.debug(message);
	}

	send(type, data) {
		this.debug(`Sending [${this.id}], type: ${type}: ` + util.inspect(data));
		this.socket.emit(type, data);
	};
	
	sendRoom(type, data) {
		this.debug(`Sending [${this.id}], type: ${type}: ` + util.inspect(data));
		this.server.io.sockets.in(this.roomId).emit(type, data);
	};

	closePeerConnection() {
		if(this.peerconnection) {
			this.peerconnection.close();
			this.peerconnection = null;
		}
	}

	handleOffer(sdp, usePlanB) {
		let This = this;
		
		let room = this.server.getRoom(this.roomId);
		this.mediaPeer = room.mediaRoom.Peer(this.id);
		this.peerconnection = new RTCPeerConnection({ 
			peer: this.mediaPeer,
			usePlanB: usePlanB 
		});
		let peerconnection = this.peerconnection;
		peerconnection.on('close', function(err) {
			if(err) {
				console.error(`PeerConnection [${This.id}] closed,	err: ${err}`);
			}
			else {
				This.debug(`PeerConnection [${This.id}] closed`);
			}
		});
		peerconnection.on('signalingstatechange', function() {
			This.debug(`PeerConnection [${This.id}] signaling state changed,	state: ${peerconnection.signalingState}`);
		});		

		// Set the remote SDP offer
		peerconnection.setCapabilities(sdp)
		.then(() => {
			console.log('after setCapabilities');
			This.sendOffer();
		});

		// Handle 'negotiationneeded' event
		peerconnection.on('negotiationneeded', () => {
			This.debug(`PeerConnection [${This.id}] negotiation needed`);
			This.sendOffer();
		});
		peerconnection.on('leave', () => {
			This.debug(`PeerConnection [${This.id}] leaves`);
			This.closePeerConnection();
		});
	}

	handleAnswer(answer) {
		this.peerconnection.setRemoteDescription(answer);
	}

	sendOffer() {
		let This = this;
		
		This.peerconnection.createOffer()
		.then((desc) => {
			return This.peerconnection.setLocalDescription(desc);
		})
		.then(() => {
			let sessionDescription = This.peerconnection.localDescription;
			This.send(sessionDescription.type, sessionDescription.sdp);
			This.sendStream();
		})
        .catch((err) => {
        	console.error(err);
        	This.peerconnection.reset();
        });
	}
	
	//TODO - execute the ffmpeg on remote machine
	ffmpeg(input) {
		let args = [
			'-loglevel', 'debug',	
			'-max_delay', '5000', 
//			'-thread_queue_size', '2048', 
			'-reorder_queue_size', '16384', 
//			'-analyzeduration', '2147483647', 
//			'-probesize', '2147483647', 
			'-protocol_whitelist', 'file,crypto,tcp,udp,rtp',
//			'-rtbufsize', '128000k',
			'-re',  
			'-i', input,
		];

//		args.push('-c', 'copy');
		args.push('-vcodec', 'copy');
		args.push('-acodec', 'aac');
		
//		args.push('-vsync', 'passthrough');
//		args.push('-q', '10');
//		args.push('-max_interleave_delta', '30000000');
//		args.push('-max_delay', '100000');
//		args.push('-framerate', '50');
		args.push('-shortest');
//		args.push('-map', '0:v', '-map', '1:a');

		if(this.server.options.outputType === OutputTypes.RTMP) {
			args.push('-f', 'flv');
			args.push(this.server.options.rtmpURL + this.id);
		}
		else {
			let ext = this.server.options.outputType === OutputTypes.MKV ? 'mkv' : 'mp4'
			let outputFilePath = this.server.options.recordedMediaPath +	`/${this.id}.${ext}`;
			args.push('-y');
			args.push(outputFilePath);
		}
		
		let ffmpeg = this.server.options.ffmpegPath;
		let command = ffmpeg + ' ' + args.join(' ');
		console.log('Executing: ' + command);
		return child_process.spawn(ffmpeg, args);
	}
	
	//TODO - execute the vlc on remote machine
	vlc(input) {
		
		// cvlc -vvv --play-and-exit --sout-ffmpeg-strict=-2 --sout "#transcode{acodec=mp4a,ab=128,channels=2,samplerate=44100}:std{access=file,mux=mp4,dst=output2.mp4}" rtsp://dev-hudson10.dev.kaltura.com:5000/FkPeypd8i2vHvGq6AAAB.sdp

		let args = [
			'-vvv',	
			'--play-and-exit',
			'--sout-ffmpeg-strict=-2', 
			'--audio-desync=-2000', 
//			'--no-sout-display',
//			'--sout-keep',
			'--sout-mux-caching=4096', // 2147483647
//			'--no-sout-smem-time-sync',
//			'--packetizer-mpegvideo-sync-iframe',
//			'--clock-synchro=1',
		];

//		let transcode = 'transcode{acodec=mp4a,ab=128,channels=2,samplerate=44100}';
		let transcode = 'transcode{acodec=mp4a,samplerate=44100}';
		if(this.server.options.outputType === OutputTypes.RTMP) {
//			args.push(`--sout=${transcode}:rtmp{url=${this.server.options.rtmpURL},name=${this.id}}`);
			args.push(`--sout=#${transcode}:std{access=rtmp,mux=ffmpeg{mux=flv},dst=${this.server.options.rtmpURL}${this.id}}`);
		}
		else if(this.server.options.outputType === OutputTypes.MP4) {
			let outputFilePath = this.server.options.recordedMediaPath +	`/${this.id}.mp4`;
			args.push(`--sout=#${transcode}:std{access=file,mux=mp4,dst=${outputFilePath}}`);
//			args.push(`--sout=#std{access=file,mux=mp4,dst=${outputFilePath}}`);
		}

		args.push(input);

		let vlc = this.server.options.vlcPath;
		let command = vlc + ' ' + args.join(' ');
		console.log('Executing: ' + command);
		return child_process.spawn(vlc, args);
	}
	
	forwardStream(sdp) {

		let input;
		if(this.server.options.rtspPort) {
			this.sdp = sdp;
			input = `rtsp://${this.server.hostname}:${this.server.options.rtspPort}/${this.id}.sdp`;
			console.log('RTSP URL: ' + input);
		}
		else {
			let sdpFilePath = this.server.options.sdpPath + `/${this.id}.sdp`;
			console.log('Saving SDP file ' + sdpFilePath);
			fs.writeFileSync(sdpFilePath, sdp);
			input = sdpFilePath;
		}
		
		let process = null;
		if(this.server.options.ffmpegPath) {
			process = this.ffmpeg(input);
		}
		else if(this.server.options.vlcPath) {
			process = this.vlc(input);
		}
		
		if(process) {
			let logPath = this.server.options.logPath + `/${this.id}.log`;
			let log = fs.createWriteStream(logPath);
			
    		process.stdout.on('data', (data) => {
    			let message = data.toString('utf8')
    			log.write(message);
    		});
    
    		process.stderr.on('data', (data) => {
    			let message = data.toString('utf8')
    			log.write(message);
    		});
    
    		process.on('error', (err) => {
    			console.error('Process [ffmpeg] error: ' + err);
    		});
    
    		process.on('exit', (code, signal) => {
    			log.end();
    			console.log(`Process [${this.id}] closed, log: ` + logPath);
    		});
		}
	}

	enableRtpPlayback(rtpReceiver) {
		let This = this;
		rtpReceiver.forwardPort = 0;
		
		let socket = dgram.createSocket('udp4');
		socket.on('error', (err) => {
			console.log(`UDP socket error:\n${err.stack}`);
			socket.close();
		});

		rtpReceiver.on('rtpraw', (packet) => {
			if(This.shouldPlay && rtpReceiver.forwardPort) {
//				let newPacket = new rtp.RtpPacket(packet);
//				newPacket.setSSRC(parseInt(This.id, 10));
//				socket.send(newPacket.getBuffer(), rtpReceiver.forwardPort, rtpReceiver.forwardAddress);
				socket.send(packet, rtpReceiver.forwardPort, rtpReceiver.forwardAddress);
			}
		});
		rtpReceiver.on('close', (packet) => {
			socket.close();
		});
		
	}
	
	play(){
		this.shouldPlay = true;
	}

	pause(){
		this.shouldPlay = false;
	}


	sendStream() {
		this.streams = [];
		
		let peer = this.peerconnection.peer;
		
		console.log('Build ' + peer.rtpReceivers.length + ' media descriptors');

		let description = {
			version: 0,
			origin: {
				username: 'mediasoup',
				sessionId: this.id,
				sessionVersion: 0,
				netType: 'IN',
				ipVer: 4,
				address: this.server.ip 
			},
			name: this.id,
			timing: {
				start: 0, 
				stop: 0 
			},
			connection: {
				version: 4, 
				ip: this.server.ip 
			},
			media: [],
			groups: [],
//			ssrcGroups: [],
		};

		let mids = [];
//		let ssrcs = [];
		
		this.shouldPlay = false;
		for(let i = 0; i < peer.rtpReceivers.length; i++) {
			let rtpReceiver = peer.rtpReceivers[i];
			
			this.enableRtpPlayback(rtpReceiver);
			this.streams[i] = rtpReceiver;

//			let ssrc = rtpReceiver.rtpParameters.encodings[0].ssrc;
//			ssrcs.push(ssrc);
			
			let mid = rtpReceiver.rtpParameters.muxId;
			mids.push(mid);
			
			let media = {
				rtp: [],
				ext: [],
				type: rtpReceiver.kind,
//				ssrcs: [{
//					id: ssrc
//				}],
				mid: mid,
				port: 0,
				quality: 10,
//				protocol: 'RTP/SAVPF',
				protocol: 'RTP/AVP',
//				rtcpMux: 'rtcp-mux',
//				direction: 'sendrecv',
				direction: 'recvonly',
				control: 'streamid=' + i
			};

//			console.log(util.inspect(rtpReceiver.rtpParameters, {depth: 10}));
			
			let payloads = [];
			for(let i = 0; i < rtpReceiver.rtpParameters.codecs.length; i++){
				let codec = rtpReceiver.rtpParameters.codecs[i];
				let payload = codec.payloadType;
				media.rtp.push({
					payload: payload,
					codec: codec.name.substr(codec.name.indexOf('/') + 1),
					rate: codec.clockRate
				});
				payloads.push(payload);
				
				if(codec.parameters) {
					let configs = [];

					for(let parameter in codec.parameters) {
						let parameterName = parameter.split(/(?=[A-Z])/).join('-').toLowerCase();
						configs.push(parameterName + '=' + codec.parameters[parameter]);
					}
					
					if(configs.length) {
						if(!media.fmtp) {
							media.fmtp = [];
						}

						media.fmtp.push({
							payload: payload,
							config: configs.join(';')
						});	
					}
				}
				
				if(codec.rtcpFeedback && codec.rtcpFeedback.length) {
					if(!media.rtcpFb) {
						media.rtcpFb = [];
					}
					for(let j = 0; j < codec.rtcpFeedback.length; j++) {
						let rtcpFeedback = codec.rtcpFeedback[j];
						media.rtcpFb.push({
							payload: payload,
							type: rtcpFeedback.type,
							subtype: rtcpFeedback.parameter,
						});
					}
				}
			}
			media.payloads = payloads.join(' ');

			for(let i = 0; i < rtpReceiver.rtpParameters.headerExtensions.length; i++){
				let headerExtension = rtpReceiver.rtpParameters.headerExtensions[i];
				media.ext.push({
					value: headerExtension.id, 
					uri: headerExtension.uri
				});
			}

			description.media.push(media);
		}

		description.groups.push({
//    		type: 'BUNDLE',
			type: 'LS',
//    		type: 'FID',
//    		type: 'DDP',
			mids: mids.join(' ')
		});
    		
//    	description.ssrcGroups.push({
//    		semantics: 'FID',
//    		ssrcs: ssrcs.join(' ')
//    	});

		let sdp = sdp_transform.write(description);
		this.forwardStream(sdp);
	}
}

class RtspServer {
	constructor(server){
		this.server = server;
		
		let This = this;
		
		this.rtspServer = net.createServer((client) => {
			console.log('RTSP client connected');

			client.on('error', (err) => {
				console.error('RTSP client error: ' + err);
			});
			client.on('end', () => {
				console.log('RTSP client disconnected');
			});
			client.on('close', () => {
				console.log('RTSP client closed');
			});

			var decoder = new rtsp.Decoder();
			var encoder = new rtsp.Encoder();

			decoder.on('request', function (request) {
				This.debug(request.method + ' ' + request.uri + ' ' + util.inspect(request.headers));
			
				var response = encoder.response()
				response.setHeader('CSeq', request.headers['cseq']);
				response.setHeader('Date', new Date().toGMTString());
			
				This.handleRequest(client, request, response);
			})

			decoder.on('error', function (err) {
				console.error(err);
				client.destroy();
			})

			client.pipe(decoder);
			encoder.pipe(client);
		});

		this.rtspServer.on('error', (err) => {
			console.log('RTSP error: ' + err);
		});
		this.rtspServer.listen(server.options.rtspPort, () => {
			console.log('RTSP server bound');
		});
	}

	handleRequest(client, request, response) {
    	let parsedUrl = url.parse(request.uri);
    	let pattern, matches;

    	if(client.connection && !client.connection.peerconnection) {
           	response.statusCode = 404; // Not found
    	}
    	else {
            switch (request.method) {
                case 'OPTIONS':
                	response.setHeader('Public', 'DESCRIBE, SETUP, TEARDOWN, PLAY', 'PAUSE');
                	break
    
                case 'DESCRIBE':
                	let sdp = null;
                	
                	pattern = /^\/([^./]+)\.sdp$/i;
                	matches = pattern.exec(parsedUrl.path);
                	if(matches) {
                    	client.id = matches[1];
                    	client.connection = this.server.getConnection(client.id);
                    	if(client.connection && client.connection.peerconnection) {
                        	sdp = client.connection.sdp;
                    	}
                	}
    
                	pattern = /^\/([^/]+)\/([^.]+)\.sdp$/i;
                	matches = pattern.exec(parsedUrl.path);
                	if(matches) {
                    	let type = matches[1];
                    	client.id = matches[2];
                    	client.connection = this.server.getConnection(client.id);
                    	if(client.connection && client.connection.peerconnection) {
                        	sdp = client.connection.sdp[type];
                    	}
                	}
    
                	if(sdp) {
                    	response.setHeader('Content-Base', request.uri);
                    	response.setHeader('Content-Type', 'application/sdp');
                    	response.setHeader('Content-Length', sdp.length);
                    	response.write(sdp);
                    	break;
                	}
                	
                   	response.statusCode = 404; // Not found
                	break
    
                case 'SETUP':
                	pattern = /\.sdp\/streamid=(\d+)$/i;
                	matches = pattern.exec(parsedUrl.path);
                	let streamId = parseInt(matches[1]);
                	
                	let transport = request.headers['transport'];
                	let transportParts = transport.split(';');
                	for(let i = 0; i < transportParts.length; i++) {
                    	pattern = /^client_port=(\d+)-(\d+)$/i;
                    	matches = pattern.exec(transportParts[i]);
                		if(matches) {
                			console.dir(client.address());
                			let address = client.remoteAddress;
                			if(net.isIPv6(address)) {
                				let addressParts = address.split(':');
                				address = addressParts[addressParts.length - 1];
                			}
                			let port = parseInt(matches[1]);
                			this.debug('Set RTP address: ' + address + ':' + port);
                			client.connection.streams[streamId].forwardAddress = address;
                			client.connection.streams[streamId].forwardPort = port;
                		}
                	}
                	response.setHeader('Transport', transport);
                	response.setHeader('Session', client.id);
                	break
    
                case 'PLAY':
                	client.connection.play();
                	response.setHeader('Session', client.id);
                	break
    
                case 'PAUSE':
                	client.connection.pause();
                	response.setHeader('Session', client.id);
                	break
    
                case 'TEARDOWN':
                	response.setHeader('Session', client.id);
                	break
                	
                default:
                	response.statusCode = 501; // Not implemented
            }
    	}
        
        response.end();
	}

	debug(message) {
		this.server.debug(message);
	}
}

class Server {
	constructor(options){
		this.options = options;
		this.ip = ip.address();
		this.hostname = os.hostname();
		this.connections = {};
		
		this.start();
		this.connections = {};
		this.rooms = {};
		this.roomsList = {};
		
		this.mediaServer = mediasoup.Server(options);
	}
	
	getRoomsList() {
		return this.roomsList;
	}
	
	getRoom(id) {
		return this.rooms[id];
	}
	
	addRoom(name) {
		let room = new Room(this.mediaServer, name);
		this.rooms[room.id] = room;
		this.roomsList[room.id] = room.name;

		return room.init();
	}
	
	addConnection(connection) {
		this.connections[connection.id] = connection;
	}
	
	removeConnection(id) {
		delete this.connections[id];
	}
	
	getConnection(id) {
		return this.connections[id];
	}
	
	start() {
		this.startWebServer();
		this.startSocketIoServer();
		this.startRtspServer();
	}
	
	startWebServer() {
		const app = express();
		var webServerOptions = {
			key: this.options.key,
			cert: this.options.cert
		};

		let This = this;
		this.webServer = https.createServer(this.options, app).listen(this.options.webPort, function() {
			This.debug('Mediasoup demo started');
			This.debug('Open https://' + This.hostname + ':' + This.options.webPort + ' with browser');
		});
		app.use(express.static(this.options.webStaticPath));
	}

	startSocketIoServer() {
		this.io = socketIO(this.webServer);
		this.io.on('connection', function(socket){
			new Connection(server, socket);
		});
	}

	startRtspServer() {
		this.rtsp = new RtspServer(this);
	}
	
	debug(msg) {
		if(this.options.enableDebug) {
			console.log(msg);
		}
	}
}

const server = new Server({
	enableDebug: true,
	key: fs.readFileSync('keys/server.key'),
	cert: fs.readFileSync('keys/server.crt'),
	webPort: 3888,
	webStaticPath: 'public',

	sdpPath: path.join(__dirname, "recordings"),
	logPath: path.join(__dirname, "recordings"),
	recordedMediaPath: path.join(__dirname, "recordings"),
	rtmpURL: 'rtmp://127.0.0.1:1936/live/',
	outputType: OutputTypes.MP4,
//	ffmpegPath: 'ffmpeg',
//	vlcPath: 'cvlc',
	
	rtspPort: 5000,

    logLevel   : "debug",
    rtcIPv4    : true,
    rtcIPv6    : false,
    rtcMinPort : 40000,
    rtcMaxPort : 49999
});


