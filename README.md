# mediasoup-server
WebRTC SFU mediasoup implementation
* Optional RTSP server to play the streams.
* Optional ffmpeg recorder to media file or publish to RTMP media server. 

* Mediasoup GitHub [https://github.com/ibc/mediasoup](https://github.com/ibc/mediasoup)
* Mediasoup Web site [https://mediasoup.org](https://mediasoup.org)

# Installation

# How to use library

## Install NPM modules

Python 2, make, g++ or clang are required for installing mediasoup.
```
$ npm install mediasoup-server
```

## Run WebRTC server

```javascript
const WebRtcServer = require('mediasoup-server').WebRtcServer;

const hostname = os.hostname();

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
	console.log(`Open https://${hostname}:${port} with browser`);
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
```

## Run RTSP server

```javascript
const RtspServer = require('mediasoup-server').RtspServer;

const rtspServer = new RtspServer(webRtcServer);
rtspServer
.listen(5000)
.on('listen', (port) => {
	console.log(`RTSP server started rtsp://${hostname}:${port}`);
})
.on('new-source', (source) => {
	let rtspUrl = `rtsp://${hostname}:${rtspServer.port}/${source.id}.sdp`;
	source.on('enabled', () => {
		console.log(`RTSP source available: ${rtspUrl}`);
	});
});
```

## Record to disc

```javascript
const rtspServer = new RtspServer(webRtcServer);
rtspServer
.listen(5000)
.on('new-source', (source) => {
	source.on('enabled', () => {
		let rtspUrl = `rtsp://${hostname}:${rtspServer.port}/${source.id}.sdp`;
		let filepath = `${recordingsPath}/${source.id}.mp4`;
		let logpath = `${recordingsPath}/${source.id}.log`;
		
		console.log(`Recording [${source.id}]: ${filepath}`);
		let process = streamer.record(rtspUrl, filepath, logpath)
		.on('error', (err) => {
			console.error(`Streamer [${source.id}] error: ${err}`);
		})
		.on('exit', (code, signal) => {
			console.log(`Streamer [${source.id}] closed, log: ${logpath}`);
		});
	});
});
```

## Publish to RTMP server

```javascript
const rtspServer = new RtspServer(webRtcServer);
rtspServer
.listen(5000)
.on('new-source', (source) => {
	source.on('enabled', () => {
		let rtspUrl = `rtsp://${hostname}:${rtspServer.port}/${source.id}.sdp`;
		let rtmpUrl = `rtmp://${hostname}:1935/live/${source.id}`;
		let logpath = `${recordingsPath}/${source.id}.log`;
		
		console.log(`Publishing [${source.id}]: ${rtmpUrl}`);
		let process = streamer.publish(rtspUrl, rtmpUrl, logpath)
		.on('error', (err) => {
			console.error(`Streamer [${source.id}] error: ${err}`);
		})
		.on('exit', (code, signal) => {
			console.log(`Streamer [${source.id}] closed, log: ${logpath}`);
		});
	});
});
```

# How to use example

## Git clone
```
git clone https://github.com/tan-tan-kanarek/mediasoup-server.git
cd mediasoup-server/
```

## Install NPM modules

Python 2, make, g++ or clang are required for installing mediasoup.
```
$ npm install
```

## Run server example
```
$ node example
```
or
```
$ npm start
```

*access with borwser*

* Open [http://localhost:3888/](http://localhost:3888/).
* Set room name and click [Join] button

# TODO

## Server
* Execute ffmpeg remotely (send message to different server to execute ffmpeg)
* To support scalability and redundancy, hold list of rooms in all servers and redirect socket.io commands to the server that handles the room, SDPs should be generated on the server that holds the room.

## Client
* Rejoin room when socket.io reconnected.
* Accept new room created event.
