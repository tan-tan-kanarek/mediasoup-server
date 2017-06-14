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

module.exports = WebRtcRoom;