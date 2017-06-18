'use strict';

const udid = require('udid');
const path = require('path');
const Promise = require('bluebird');

const roomOptions = require('../data/options').roomOptions;

class WebRtcRoom {

	constructor(mediaServer, name){
		const d = new Date();
		this.id = udid('y' + name + d.getTime());
		this.name = name;
		this.mediaServer = mediaServer;
		this.roomOptions = roomOptions;
	}

	init() {
		return this.mediaServer.createRoom(this.roomOptions)
			.then((mediaRoom) => {
				this.mediaRoom = mediaRoom;
				return this;
			});
	}

}

module.exports = WebRtcRoom;