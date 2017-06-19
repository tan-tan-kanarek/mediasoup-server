/**
 * http://usejsdoc.org/
 */

const net = require('net');
const url = require('url');
const rtsp = require('rtsp-stream');
const EventEmitter = require('events');

const RtspSource = require('./source.js');

class RtspServer extends EventEmitter {
	constructor(webRtcServer){
		super();

		this.sources = {};
		this.webRtcServer = webRtcServer;

		webRtcServer
        .on('new-connection', (connection) => {
        	connection
        	.on('new-stream', (stream) => {
        		let source = this.getSource(stream.peer.id, connection);
        		source.addStream(stream);
        	})
        	.on('ready', (peerConnection) => {
        		let source = this.getSource(peerConnection.peer.id, connection);
        		source.enable();
        	})
        	.on('close', (peerId) => {
        		this.removeSource(peerId);
        	});
        });
	}

	listen (port) {
		this.port = port;

		this.rtspServer = net.createServer((client) => {
			client.id = client.remotePort;
			this.emit('client-connected', client);

			client.on('error', (err) => {
				this.emit('client-error', client, err);
			});
			client.on('end', () => {
				this.emit('client-end', client);
			});
			client.on('close', () => {
				this.emit('client-close', client);
			});

			var decoder = new rtsp.Decoder();
			var encoder = new rtsp.Encoder();

			decoder.on('request', (request) => {
				var response = encoder.response()
				response.setHeader('CSeq', request.headers['cseq']);
				response.setHeader('Date', new Date().toGMTString());

				this.handleRequest(client, request, response);
			});
			decoder.on('error', (err) => {
				this.emit('decoder-error', client, err);
				client.destroy();
			});

			client.pipe(decoder);
			encoder.pipe(client);
		});

		this.rtspServer.on('error', (err) => {
			this.emit('error', client, err);
		});
		this.rtspServer.listen(port, () => {
			this.emit('listen', port);
		});

		return this;
	}

	addSource(source) {
		this.sources[source.id] = source;
		this.emit('new-source', source);
	}

	getSource(sourceId, connection = null) {
		if(connection !== null && !this.sources[sourceId]){
			this.addSource(new RtspSource(sourceId, connection));
		}

		return this.sources[sourceId];
	}

	removeSource(sourceId) {
		delete this.sources[sourceId];
	}

	parsePath(path) {
    	let pattern, matches;

    	pattern = /^\/([^./]+)\.sdp$/i;
    	matches = pattern.exec(path);
    	if(matches) {
        	return {
        		sourceId: parseInt(matches[1])
        	};
    	}

    	pattern = /^\/([^./]+)\.sdp\/streamid=(\d+)$/i;
    	matches = pattern.exec(path);
    	if(matches) {
        	return {
        		sourceId: parseInt(matches[1]),
        		streamId: parseInt(matches[2])
        	};
    	}

    	return false;
	}

	handleRequest(client, request, response) {
    	let parsedUrl = url.parse(request.uri);
    	let ids, streamId;

    	this.emit('request', request.method, request.uri);
    	if(client.sourceId && !(this.sources[client.sourceId] && this.sources[client.sourceId].enabled)) {
           	response.statusCode = 404; // Not found
    	}
    	else {
    		try{
                switch (request.method) {
                    case 'OPTIONS':
                    	response.setHeader('Public', 'DESCRIBE, SETUP, TEARDOWN, PLAY', 'PAUSE');
                    	break

                    case 'DESCRIBE':
                    	ids = this.parsePath(parsedUrl.path);
                    	if(ids) {
                        	client.sourceId = ids.sourceId;
                        	if(this.sources[client.sourceId] && this.sources[client.sourceId].enabled) {
                            	let sdp = this.sources[client.sourceId].getSdp();
                            	response.setHeader('Content-Base', request.uri);
                            	response.setHeader('Content-Type', 'application/sdp');
                            	response.setHeader('Content-Length', sdp.length);
                            	response.write(sdp);
                            	break;
                        	}
                    	}
                       	response.statusCode = 404; // Not found
                    	break

                    case 'SETUP':
                    	ids = this.parsePath(parsedUrl.path);
                    	streamId = ids.streamId;
                    	let transport = request.headers['transport'];
                    	let transportParts = transport.split(';');
                    	for(let i = 0; i < transportParts.length; i++) {
                        	let pattern = /^client_port=(\d+)-(\d+)$/i;
                        	let matches = pattern.exec(transportParts[i]);
                    		if(matches) {
                    			let address = client.remoteAddress;
                    			if(net.isIPv6(address)) {
                    				let addressParts = address.split(':');
                    				address = addressParts[addressParts.length - 1];
                    				if(address === '1') {
                    					address = '127.0.0.1';
                    				}
                    			}
                    			let port = parseInt(matches[1]);
                    			this.sources[client.sourceId].addAddress(client.id, streamId, address, port);
                    		}
                    	}
                    	response.setHeader('Transport', transport);
                    	response.setHeader('Session', client.id);
                    	break

                    case 'PLAY':
                    	ids = this.parsePath(parsedUrl.path);
                    	streamId = ids.streamId ? ids.streamId : null;
            			this.sources[client.sourceId].enableAddress(client.id, streamId);
                    	response.setHeader('Session', client.id);
                    	break

                    case 'PAUSE':
                    	ids = this.parsePath(parsedUrl.path);
                    	streamId = ids.streamId;
            			this.sources[client.sourceId].disableAddress(client.id, streamId);
                    	response.setHeader('Session', client.id);
                    	break

                    case 'TEARDOWN':
                    	response.setHeader('Session', client.id);
                    	break

                    default:
                    	response.statusCode = 501; // Not implemented
                }
    		}
    		catch(err) {
            	response.setHeader('Error', err);
            	response.statusCode = 500; // error
    		}
    	}

        response.end();
	}
}

module.exports = RtspServer;