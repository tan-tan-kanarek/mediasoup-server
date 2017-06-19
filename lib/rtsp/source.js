/**
 * http://usejsdoc.org/
 */

const ip = require('ip');
const dgram = require('dgram');
const EventEmitter = require('events');
const sdp_transform = require('sdp-transform');

const ipAddress = ip.address();

class RtspSource extends EventEmitter {
	constructor(id, connection){
		super();

		this.id = id;
		this.connection = connection;
		
		this.streams = {};
		this.clients = {};
		this.enabled = false;
	}

	enable() {
		this.enabled = true;
		this.emit('enabled');
	}

	disable() {
		this.enabled = false;
		this.emit('disabled');
	}

	addStream(stream) {
		this.streams[stream.id] = stream;

		let socket = dgram.createSocket('udp4');
		socket.on('error', (err) => {
			this.emit('error', err);
			if(socket) {
				console.log('closing socket (socket.error)');
				socket.close();
			}
		});
		socket.on('close', (err) => {
			socket = null;
		});
		stream.on('close', (err) => {
			if(socket) {
				socket.close();
			}
		});
		stream.on('rtpraw', (packet) => {
			if(socket) {
				let addresses = Object.keys(this.clients).map(((clientId) => this.clients[clientId][stream.id])).filter((address) => address && address.play);
				addresses.forEach((address) => {
					socket.send(packet, address.port, address.address);
				});
			}
		});
	}

	addAddress(clientId, streamId, address, port) {
		if(!this.streams[streamId]) {
			throw `Stream id [${streamId}] not found`;
		}

		if(!this.clients[clientId]) {
			this.clients[clientId] = {};
		}

		this.clients[clientId][streamId] = {
			address: address,
			port: port,
			play: false
		}
	}

	enableAddress(clientId, streamId) {
		if(streamId && !this.streams[streamId]) {
			throw `Stream id [${streamId}] not found`;
		}

		if(!this.clients[clientId]) {
			throw `Client id [${clientId}] not found`;
		}

		let streamIds = streamId ? [streamId] : Object.keys(this.clients[clientId]);
		streamIds.forEach((streamId) => {
			this.clients[clientId][streamId].play = true;
		});
	}

	disableAddress(clientId, streamId) {
		if(streamId && !this.streams[streamId]) {
			throw `Stream id [${streamId}] not found`;
		}

		if(!this.clients[clientId]) {
			throw `Client id [${clientId}] not found`;
		}


		let streamIds = streamId ? [streamId] : Object.keys(this.clients[clientId]);
		streamIds.forEach((streamId) => {
			this.clients[clientId][streamId].play = false;
		});
	}

	getSdp() {
		let description = {
			version: 0,
			origin: {
				username: 'mediasoup',
				sessionId: this.id,
				sessionVersion: 0,
				netType: 'IN',
				ipVer: 4,
				address: ipAddress
			},
			name: this.id,
			timing: {
				start: 0,
				stop: 0
			},
			connection: {
				version: 4,
				ip: ipAddress
			},
			media: [],
			groups: [],
		};

		let mids = [];

		for(let streamId in this.streams) {
			let stream = this.streams[streamId];

			if(typeof(stream) !== 'object') {
				continue;
			}

			let mid = stream.rtpParameters.muxId;
			mids.push(mid);

			let media = {
				rtp: [],
				ext: [],
				type: stream.kind,
				mid: mid,
				port: 0,
				quality: 10,
				protocol: 'RTP/AVP',
				direction: 'recvonly',
				control: 'streamid=' + streamId
			};

			let payloads = [];
			for(let i = 0; i < stream.rtpParameters.codecs.length; i++){
				let codec = stream.rtpParameters.codecs[i];
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
						if(typeof(codec.parameters[parameter]) === 'function') {
							continue;
						}
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

			for(let i = 0; i < stream.rtpParameters.headerExtensions.length; i++){
				let headerExtension = stream.rtpParameters.headerExtensions[i];
				media.ext.push({
					value: headerExtension.id,
					uri: headerExtension.uri
				});
			}

			description.media.push(media);
		}

		description.groups.push({
			type: 'LS',
			mids: mids.join(' ')
		});

		return sdp_transform.write(description);
	}
}

module.exports = RtspSource;