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

		// socket.io
		socket.on('disconnect', () => {
			this.closePeerConnection();
			this.emit('disconnect');
			this.removeAllListeners();
		});

		socket.on('error', (err) => {
			this.emit('error', err);
		});

		socket.on('list', () => {
			this.emit('receive', 'list');
			this.send('list', this.server.getRoomsList());
		});

		socket.on('create-room', (name) => {
			this.emit('receive', 'create-room', name);
			this.server.addRoom(name, this)
			.then((room) => {
				this.send('room-created', {
					id: room.id,
					name: room.name
				});
			});
		});

		socket.on('join', (message) => {
			this.emit('receive', 'join', message);
			let room = this.server.getRoom(message.roomId);
			if(room) {
    			socket.join(message.roomId);
    			this.roomId = message.roomId;
    			this.handleOffer(message.sdp, message.planb);
			}
			else {
				this.send('error', 'Room not found');
			}
		});

		socket.on('joined', (answer) => {
			this.emit('receive', 'joined', answer);
			this.handleAnswer(answer);
		});

		socket.on('quit', () => {
			this.emit('receive', 'quit');
			this.closePeerConnection();
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
		let room = this.server.getRoom(this.roomId);
		this.mediaPeer = room.mediaRoom.Peer(this.id);
		this.mediaPeer.on('newrtpreceiver', (rtpReceiver) => {
			this.emit('new-stream', rtpReceiver);
		});

		this.peerConnection = new RTCPeerConnection({
			peer: this.mediaPeer,
			usePlanB: usePlanB
		});
		let peerConnection = this.peerConnection;
		peerConnection.on('close', (err) => {
			if(err) {
				this.emit('error', err);
			}
			else {
				this.emit('close', peerConnection.peer.id);
			}
		});
		peerConnection.on('signalingstatechange', () => {
			this.emit('signaling-state-change', peerConnection.signalingState);
		});

		// Set the remote SDP offer
		peerConnection.setCapabilities(sdp)
		.then(() => {
			this.sendOffer();
		});

		// Handle 'negotiationneeded' event
		peerConnection.on('negotiationneeded', () => {
			this.emit('negotiation-needed');
			this.sendOffer();
		});
		peerConnection.on('leave', () => {
			this.emit('peer-leave');
			this.closePeerConnection();
		});
	}

	handleAnswer(answer) {
		this.peerConnection.setRemoteDescription(answer)
		.then(() => {
			this.send('ready');
			this.emit('ready', this.peerConnection);
		}, (err) => {
			this.emit('error', err);
		});
	}

	sendOffer() {
		this.peerConnection.createOffer()
			.then((desc) => {
				return this.peerConnection.setLocalDescription(desc);
			})
			.then(() => {
				let sessionDescription = this.peerConnection.localDescription;
				this.send(sessionDescription.type, sessionDescription.sdp);
			})
			.catch((err) => {
				this.emit('error', err);
				this.peerConnection.reset();
			});
	}
}

module.exports = WebRtcConnection;
