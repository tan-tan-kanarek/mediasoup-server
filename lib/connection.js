'use strict';

const EventEmitter = require('events');

const mediasoup = require('mediasoup');
const RTCPeerConnection = mediasoup.webrtc.RTCPeerConnection;

class WebRtcConnection extends EventEmitter {
	constructor(server, socket){
		super();
		
		this.server = server;
		this.socket = socket;
		this.peerConnection = null;

		this.id = socket.id;
		this.sdp = null;
		this.roomId = null;
		this.mediaPeer = null;

		let This = this;

		// socket.io
		socket.on('disconnect', () => {
			This.closePeerConnection();
			This.emit('disconnect');
			This.removeAllListeners();
		});
		
		socket.on('error', (err) => {
			This.emit('error', err);
		});

		socket.on('list', () => {
			This.emit('receive', 'list');
			This.send('list', This.server.getRoomsList());
		});

		socket.on('create-room', (name) => {
			This.emit('receive', 'create-room', name);
			This.server.addRoom(name).
			then((room) => {
				This.send('room-created', {
					id: room.id,
					name: room.name
				});
			});
		});

		socket.on('join', (message) => {
			This.emit('receive', 'join', message);
			let room = This.server.getRoom(message.roomId);
			if(room) {
    			socket.join(message.roomId);
    			This.roomId = message.roomId;
    			This.handleOffer(message.sdp, message.planb);
			}
			else {
				This.send('error', 'Room not found');
			}
		});

		socket.on('joined', (answer) => {
			This.emit('receive', 'joined', answer);
			This.handleAnswer(answer);
		});

		socket.on('quit', () => {
			This.emit('receive', 'quit');
			This.closePeerConnection();
		});
	}

	send(type, data) {
		this.emit('send', type, data);
		this.socket.emit(type, data);
	};
	
	sendRoom(type, data) {
		this.emit('send-room', type, data);
		this.server.io.sockets.in(this.roomId).emit(type, data);
	};

	closePeerConnection() {
		if(this.peerConnection) {
			this.peerConnection.close();
			this.peerConnection = null;
		}
	}

	handleOffer(sdp, usePlanB) {
		let This = this;
		
		let room = this.server.getRoom(this.roomId);
		this.mediaPeer = room.mediaRoom.Peer(this.id);
		this.mediaPeer.on('newrtpreceiver', (rtpReceiver) => {
			This.emit('new-stream', rtpReceiver);
		});
		
		this.peerConnection = new RTCPeerConnection({ 
			peer: this.mediaPeer,
			usePlanB: usePlanB 
		});
		let peerConnection = this.peerConnection;
		peerConnection.on('close', function(err) {
			if(err) {
				This.emit('error', err);
			}
			else {
				This.emit('close', peerConnection.peer.id);
			}
		});
		peerConnection.on('signalingstatechange', function() {
			This.emit('signaling-state-change', peerConnection.signalingState);
		});		

		// Set the remote SDP offer
		peerConnection.setCapabilities(sdp)
		.then(() => {
			This.sendOffer();
		});

		// Handle 'negotiationneeded' event
		peerConnection.on('negotiationneeded', () => {
			This.emit('negotiation-needed');
			This.sendOffer();
		});
		peerConnection.on('leave', () => {
			This.emit('peer-leave');
			This.closePeerConnection();
		});
	}

	handleAnswer(answer) {
		let This = this;
		
		this.peerConnection.setRemoteDescription(answer)
		.then(() => {
			This.send('ready');
			This.emit('ready', this.peerConnection);
		}, (err) => {
			This.emit('error', err);
		});
	}

	sendOffer() {
		let This = this;
		
		This.peerConnection.createOffer()
		.then((desc) => {
			return This.peerConnection.setLocalDescription(desc);
		})
		.then(() => {
			let sessionDescription = This.peerConnection.localDescription;
			This.send(sessionDescription.type, sessionDescription.sdp);
		})
        .catch((err) => {
			This.emit('error', err);
        	This.peerConnection.reset();
        });
	}
}

module.exports = WebRtcConnection;