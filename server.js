'use strict';


const os = require('os');
const ip = require('ip');
const fs = require('fs');
const net = require('net');
const udid = require('udid');
const util = require('util');
const path = require('path');
const dgram = require('dgram');
const https = require('https');
const express = require('express');
const socketIO = require('socket.io');
const child_process = require('child_process');
const sdp_transform = require('sdp-transform');

const mediasoup = require('mediasoup');
const RTCPeerConnection = mediasoup.webrtc.RTCPeerConnection;
const RTCSessionDescription = mediasoup.webrtc.RTCSessionDescription;
const roomOptions = require('./data/options').roomOptions;
const peerCapabilities = require('./data/options').peerCapabilities;

const StreamMethods = {
	SEPERATE_STREAMS_TO_SINGLE_OUTPUT: 1,
	SEPERATE_STREAMS_TO_SEPERATE_OUTPUTS: 2,
	AUDIO_ONLY: 3,
	ALL_STREAMS_TO_SINGLE_OUTPUT: 4
};

const OutputTypes = {
	RTMP: 1,
	MKV: 2,
	MP4: 3
};

class Room {
	
	constructor(name){
		if(!Room.soupServer){
			Room.soupServer = mediasoup.Server();
		}

		const d = new Date();
		this.id = udid('y' + name + d.getTime());
		this.name = name;
	}
	
	init() {
		let This = this;

		return new Promise((resolve, reject) => {
    		Room.soupServer.createRoom(roomOptions)
    		.then((room) => {
    			This.soup = room;
    			resolve(This);
    		})
    		.catch((err) => reject(err));
		});
	}

}

class Connection {
	constructor(server, socket){
		if(!Connection.udpPort) {
			Connection.udpPort = 33400;
		}
		
		this.server = server;
		this.socket = socket;
		this.peerconnection = null;
		
		this.id = socket.id;
		this.roomId = null;

		let This = this;

		// socket.io
		socket.on('disconnect', () => {
        	This.closePeerConnection();
        });
        
		socket.on('error', (err) => {
        	console.error('ERROR:', err);
        });

		socket.on('list', () => {
        	This.send('list', This.server.getRoomsList());
        });

		socket.on('create-room', (name) => {
        	This.server.addRoom(name).
    		then((room) => {
    			This.send('room-created', {
                	id: room.id,
                	name: room.name
                });
    		});
        });

		socket.on('join', (message) => {
			socket.join(message.roomId);
			This.roomId = message.roomId;
        	This.handleOffer(message.sdp, message.planb, message.roomId);
        });

		socket.on('quit', () => {
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

	handleOffer(sdp, usePlanB, roomId) {
		const option = { usePlanB: usePlanB };

		let desc = new RTCSessionDescription({
    		type : 'offer',
    		sdp  : sdp
		});

		let This = this;
		
		let room = this.server.getRoom(roomId);
		this.peerconnection = new RTCPeerConnection(room.soup, this.id, option);
		let peerconnection = this.peerconnection;
		peerconnection.on('close', function(err) {
			if(err) {
				console.error(`PeerConnection [${This.id}] closed,  err: ${err}`);
			}
			else {
				This.debug(`PeerConnection [${This.id}] closed`);
			}
		});
		peerconnection.on('signalingstatechange', function() {
			This.debug(`PeerConnection [${This.id}] signaling state changed,  state: ${peerconnection.signalingState}`);
		});      

		// Set the remote SDP offer
		peerconnection.setRemoteDescription(desc)
		.then(() => {
    		return peerconnection.createAnswer();
		})
		.then((desc) => {
			return peerconnection.setLocalDescription(desc);
		})
		.then(() => {
//			console.log(peerconnection.localDescription.sdp);
//			console.log(util.inspect(sdp_transform.parse(peerconnection.localDescription.sdp), {depth: 10}));
			This.sendAnswer();
			This.sendStream();
		})
		.catch((error) => {
			console.error('Error handling SDP offer: ', error);
			This.closePeerConnection();
		});

		// Handle 'negotiationneeded' event
		peerconnection.on('negotiationneeded', () => {
			This.debug(`PeerConnection [${This.id}] negotiation needed`);
			peerconnection.createOffer()
    		.then((desc) => {
    			return peerconnection.setLocalDescription(desc);
    		})
    		.then(() => {
    			This.sendOffer();
    			This.sendStream();
    		})
    		.catch((error) => {
    			console.error(`Error handling SDP re-offer id[${This.id}], err: ${error}`);
    		});
		});
	}

	handleAnswer(sdp) {
		let desc = new RTCSessionDescription({
    		type : 'answer',
    		sdp  : sdp
		});

		let This = this;
		
		let peerconnection = this.peerconnection;
		peerconnection.setRemoteDescription(desc)
		.then( function() {
			This.debug(`PeerConnection [${this.id}] set remote description`);
		})
		.catch( (err) => {
    		console.eror(`PeerConnection [${this.id}] set remote description error: ${err}`);
		});
	}

	sendOffer() {
		let sessionDescription = this.peerconnection.localDescription;
		this.send(sessionDescription.type, sessionDescription.sdp);
		// TODO send offer to all room members
//		this.sendRoom(sessionDescription.type, sessionDescription.sdp);
	}
	
	sendAnswer() {
		let sessionDescription = this.peerconnection.localDescription;
		this.send(sessionDescription.type, sessionDescription.sdp);
	}

	createMediaSdp(rtpReceiver, port) {
		
		let media = {
			rtp: [],
			ext: [],
			type: rtpReceiver.kind,
			mid: rtpReceiver.rtpParameters.muxId,
			port: port,
			quality: 10,
			protocol: 'RTP/SAVPF',
			rtcpMux: 'rtcp-mux',
			direction: 'sendrecv'
		};

//		console.log(util.inspect(rtpReceiver.rtpParameters, {depth: 10}));
		
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
		
		return media;
	}
	
	openStreamSocket(rtpReceiver) {
		let This = this;
		
		return new Promise((resolve, reject) => {

			Connection.udpPort += 2;
			let port = Connection.udpPort;


			console.log('Streaming UDP (' + port + ') for ' + This.id + ' ' + rtpReceiver.kind);
			let socket = dgram.createSocket('udp4');
			socket.on('error', (err) => {
	            console.log(`UDP socket error:\n${err.stack}`);
	            socket.close();
	        });
	        
			let media = This.createMediaSdp(rtpReceiver, port);
			resolve(media);
			rtpReceiver.on('rtpraw', (packet) => {
				socket.send(packet, port, This.server.ip);
			});
			rtpReceiver.on('close', (packet) => {
				socket.close();
			});
		});
	}

	//TODO - execute the ffmpeg on remote machine
	forwardStream(sdp, type) {
		let This = this;
		
		let sdpFilePath = This.server.options.sdpPath + `/${This.id}.sdp`;
		if(type) {
			sdpFilePath = This.server.options.sdpPath + `/${This.id}.${type}.sdp`;
		}
		
		console.log('Saving SDP file ' + sdpFilePath);
		fs.writeFile(sdpFilePath, sdp, () => {

			let args = [
				'-loglevel', 'debug',  
				'-max_delay', '5000', 
//				'-thread_queue_size', '2048', 
				'-reorder_queue_size', '16384', 
//				'-analyzeduration', '2147483647', 
//				'-probesize', '2147483647', 
				'-protocol_whitelist', 'file,crypto,udp,rtp',
//				'-rtbufsize', '128000k',
				'-re', 
				'-i', sdpFilePath,
			];

//			args.push('-c', 'copy');
			if(!type || type == 'video') {
//				args.push('-vcodec', 'copy');
				args.push('-vcodec', 'h264');
			}
			if(!type || type == 'audio') {
//				args.push('-acodec', 'copy');
				args.push('-acodec', 'aac');
			}
			
//			args.push('-vsync', 'passthrough');
//			args.push('-q', '10');
			args.push('-max_interleave_delta', '30000000');
//			args.push('-max_delay', '100000');
//			args.push('-framerate', '50');
//			args.push('-shortest');
//			args.push('-map', '0:v', '-map', '0:a');

			if(This.server.options.outputType === OutputTypes.RTMP) {
				args.push('-f', 'flv');
				args.push(This.server.options.rtmpURL + This.id);
			}
			else {
				let ext = This.server.options.outputType === OutputTypes.MKV ? 'mkv' : 'mp4'
				let outputFilePath = This.server.options.recordedMediaPath +  `/${This.id}.${ext}`;
				if(type) {
					outputFilePath = This.server.options.recordedMediaPath +  `/${This.id}.${type}.${ext}`;
				}
				args.push('-y');
				args.push(outputFilePath);
			}

			
			let ffmpeg = This.server.options.ffmpegPath;
			let command = ffmpeg + ' ' + args.join(' ');
			console.log('Executing: ' + command);
			let process = child_process.spawn(ffmpeg, args);
			
			process.stdout.on('data', (data) => {
				console.log(data.toString('utf8'));
			});

			process.stderr.on('data', (data) => {
				console.error(data.toString('utf8'));
			});
		});
	}

	// TODO - execute the ffmpeg on remote machine
	forwardStreams(sdps) {
		let This = this;
		
		console.log('Saving SDP files');

		Promise.all(sdps.map((sdp, index) => {
			return new Promise((resolve, reject) => {
				let sdpFilePath = This.server.options.sdpPath + `/${This.id}.${index}.sdp`;
				fs.writeFile(sdpFilePath, sdp, () => {
					resolve(sdpFilePath);
				});
			});
		}))
		.then((sdpFilePaths) => {
			
			let args = [
				'-loglevel', 'debug', 
				
				'-max_delay', '5000', 
				'-reorder_queue_size', '16384',
				'-protocol_whitelist', 'file,crypto,udp,rtp',
				'-re', '-i', sdpFilePaths[0],

				'-max_delay', '5000', 
				'-reorder_queue_size', '16384',
				'-protocol_whitelist', 'file,crypto,udp,rtp',			
				'-re', '-i', sdpFilePaths[1],

//				'-c', 'copy',
				'-vcodec', 'h264',
				'-acodec', 'aac',
//				'-vsync', 'passthrough',
//				'-shortest', 
			];

			if(This.server.options.outputType === OutputTypes.RTMP) {
				args.push('-f', 'flv');
				args.push(This.server.options.rtmpURL + This.id);
			}
			else {
				let ext = This.server.options.outputType === OutputTypes.MKV ? 'mkv' : 'mp4'
				let outputFilePath = This.server.options.recordedMediaPath +  `/${This.id}.${ext}`;
				args.push('-y');
				args.push(outputFilePath);
			}

			let ffmpeg = This.server.options.ffmpegPath;
			let command = ffmpeg + ' ' + args.join(' ');
			console.log('Executing: ' + command);
			let process = child_process.spawn(ffmpeg, args);
			
			process.stdout.on('data', (data) => {
				console.log(data.toString('utf8'));
			});

			process.stderr.on('data', (data) => {
				console.error(data.toString('utf8'));
			});
		})
		.catch( (err) => {
			console.eror('Saving SDP files error:', err)
		});;
	}
	
	sendStream() {
		let peer = this.peerconnection.peer;
		let This = this;
		
		Promise.all(peer.rtpReceivers.map((rtpReceiver) => {
			return This.openStreamSocket(rtpReceiver);
		}))
		.then((media) => {
			console.log('Build ' + media.length + ' media descriptors');

			media.sort((a, b) => {
				if(a.type == b.type) {
					return 0;
				}
				
				if(a.type == 'video') {
					return -1;
				}
				
				return 1;
			});

			let mids = [];
			for(let i = 0; i <= media.length; i++) {
				if(!media[i]) {
					continue;
				}

				mids.push(media[i].mid);
				media[i].control = 'track' + i;
			}

			let description = {
	            version: 0,
	            origin: {
	            	username: 'mediasoup',
	                sessionId: This.id,
	                sessionVersion: 0,
	                netType: 'IN',
	                ipVer: 4,
	                address: This.server.ip 
	            },
	            name: This.id,
	            timing: {
	            	start: 0, 
	            	stop: 0 
	            },
	            connection: {
	            	version: 4, 
	            	ip: This.server.ip 
	            },
//	            groups: [{
//	            	type: 'LS',
////	            	type: 'FID',
////	            	type: 'DDP',
//	            	mids: mids.join(' ')
//	            }]
			};

			// send stream seperatly into the same output
			// working but the sync between video and audio get lost
			if(This.server.options.streamMethod === StreamMethods.SEPERATE_STREAMS_TO_SINGLE_OUTPUT) {
				let sdps = [];
				for(let i = 0; i <= media.length; i++) {
					let stream = media[i];
					if(!stream) {
						continue;
					}
					description.media = [stream];
					sdps[i] = sdp_transform.write(description);
				}
				This.forwardStreams(sdps);
			}
			

			
			
			// send each stream to different output
			// works perfect
			if(This.server.options.streamMethod === StreamMethods.SEPERATE_STREAMS_TO_SEPERATE_OUTPUTS) {
    			for(let i = 0; i <= media.length; i++) {
    				description.media = [media[i]];
    				let sdp = sdp_transform.write(description);
    				This.forwardStream(sdp, media[i].type);
    			}
			}
			
			

			// send only the audio stream
			if(This.server.options.streamMethod === StreamMethods.AUDIO_ONLY) {
				let stream;
				for(let i = 0; i <= media.length; i++) {
					if(media[i].type == 'audio') {
						stream = media[i];
						break;
					}
				}
				description.media = [stream];
				let sdp = sdp_transform.write(description);
				This.forwardStream(sdp);
			}
			

			// send both stream together to the same output
			// the output plays each time either the video or the audio, never bith of them together in sync
			if(This.server.options.streamMethod === StreamMethods.ALL_STREAMS_TO_SINGLE_OUTPUT) {
				description.groups = [{
	            	type: 'LS',
//	            	type: 'FID',
//	            	type: 'DDP',
	            	mids: mids.join(' ')
	            }];
        		description.media = media;
        		let sdp = sdp_transform.write(description);
        		This.forwardStream(sdp);
			}
		})
		.catch( (err) => {
			console.eror('Open stream socket error:', err)
		});
	}
}

class Server {
	constructor(options){
		this.options = options;
	    this.ip = ip.address();
	    this.hostname = os.hostname();
	    this.connections = {};
		
	    this.start();
	    this.rooms = {};
	    this.roomsList = {};
	}
	
	getRoomsList() {
		return this.roomsList;
	}
	
	getRoom(id) {
		return this.rooms[id];
	}
	
	addRoom(name) {
		let room = new Room(name);
		this.rooms[room.id] = room;
		this.roomsList[room.id] = room.name;

		return room.init();
	}
	
	start() {
		this.startWebServer();
		this.startSocketIo();
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

	startSocketIo() {
		this.io = socketIO(this.webServer);
		this.io.on('connection', function(socket){
			new Connection(server, socket);
		});
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
	
	streamMethod: StreamMethods.SEPERATE_STREAMS_TO_SINGLE_OUTPUT,
	sdpPath: path.join(__dirname, "recordings"),
	recordedMediaPath: path.join(__dirname, "recordings"),
	rtmpURL: 'rtmp://127.0.0.1:1936/live/',
	outputType: OutputTypes.RTMP,
	ffmpegPath: 'ffmpeg'
});


