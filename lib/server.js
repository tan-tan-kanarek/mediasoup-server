'use strict';

//process.env.DEBUG = "mediasoup*";
	

const https = require('https');
const express = require('express');
const Promise = require('bluebird');
const socketIO = require('socket.io');
const EventEmitter = require('events');

const mediasoup = require('mediasoup');

const WebRtcRoom = require('./room.js');
const WebRtcConnection = require('./connection.js');

class WebRtcServer extends EventEmitter {
	constructor(){
		super();
		
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
		let room = new WebRtcRoom(this.mediaServer, name);
		this.rooms[room.id] = room;
		this.roomsList[room.id] = room.name;

		return room.init();
	}
	
	listen(options) {
		this.options = options;

		this.mediaServer = mediasoup.Server(options);
		
		this.startWebServer();
		this.startSocketIoServer();
		
		let This = this;
		setTimeout(() => {
			This.emit('listen');
		}, 0);
		
		return this;
	}
	
	startWebServer() {
		const app = express();

		let This = this;
		this.webServer = https.createServer(this.options, app).listen(this.options.port, function() {
			This.emit('web-listen', This.options.port);
		});
		app.use(express.static(this.options.path));
	}

	startSocketIoServer() {
		let This = this;
		
		this.io = socketIO(this.webServer);
		this.io.on('connection', function(socket){
			let connection = new WebRtcConnection(This, socket);
			This.emit('new-connection', connection);
		});
	}
}

module.exports = WebRtcServer;
