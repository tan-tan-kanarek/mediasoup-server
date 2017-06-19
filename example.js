'use strict';

//process.env.DEBUG = "mediasoup*";

const fs = require('fs');
const ip = require('ip');
const path = require('path');

const {WebRtcServer, RtspServer, ffmpeg} = require('./index.js');

const recordingsPath = path.join(__dirname, "recordings");
const ipAddress = ip.address();
const streamer = new ffmpeg({
	enableDebug: true
});

const webRtcServer = new WebRtcServer();
webRtcServer
.listen({
	enableDebug: true,
	key: fs.readFileSync('keys/server.key'),
	cert: fs.readFileSync('keys/server.crt'),
	port: 3888,
	path: 'public',
})
.on('listen', () => {
	console.log('Mediasoup demo started');
})
.on('web-listen', (port) => {
	console.log(`Open https://${ipAddress}:${port} with browser`);
})
.on('new-connection', (connection) => {
	console.log(`New connection [${connection.id}]`);
	
	connection
	.on('error', (err) => {
		console.log(`Connection [${connection.id}] error: ${err}`);
	})
	.on('receive', (action, data) => {
		console.log(`Connection [${connection.id}] receive [${action}]`);
	})
	.on('send', (action, data) => {
		console.log(`Connection [${connection.id}] send [${action}]`);
	})
	.on('new-stream', (stream) => {
		console.log(`Connection [${connection.id}] peer [${stream.peer.id}] new stream [${stream.id}]`);
	})
	.on('ready', (peerConnection) => {
		console.log(`Connection [${connection.id}] peer [${peerConnection.peer.id}] ready`);
	})
	.on('close', (peerId) => {
		console.log(`Connection [${connection.id}] peer [${peerId}] closed`);
	})
	.on('disconnect', (err) => {
		console.log(`Connection [${connection.id}] signaling disconnected`);
		connection = null;
	});
});

const rtspServer = new RtspServer(webRtcServer);
rtspServer
.listen(5000)
.on('listen', (port) => {
	console.log(`RTSP server started rtsp://${ipAddress}:${port}`);
})
.on('new-source', (source) => {
	let rtspUrl = `rtsp://${ipAddress}:${rtspServer.port}/${source.id}.sdp`;
	console.log(`New RTSP source ${rtspUrl}`);
	
	let process;
	source.on('enabled', () => {
		let filepath = `${recordingsPath}/${source.id}.mp4`;
		let logpath = `${recordingsPath}/${source.id}.log`;
		
		console.log(`Recording [${source.id}]: ${filepath}`);
		
		process = streamer.record(rtspUrl, filepath, logpath)
		.on('error', (err) => {
			console.error(`Streamer [${source.id}] error: ${err}`);
		})
		.on('exit', (code, signal) => {
			console.log(`Streamer [${source.id}] closed, log: ${logpath}`);
		});
	})
	.on('error', (err) => {
		console.error(`RTSP Source [${source.id}] error:`, err);
	});
})
.on('request', (method, uri) => {
	console.log(`RTSP Request [${method}]`, uri);
});
