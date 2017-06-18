/**
 * http://usejsdoc.org/
 */

const fs = require('fs');
const child_process = require('child_process');

class ffmpeg {
	constructor(options) {
		this.options = options;
	}

	record(input, filepath, logpath, overwrite = true) {
		let args = this.getCommand(input);

		if(overwrite) {
			args.push('-y');
		}
		args.push(filepath);

		return this.exec(args, logpath);
	}

	publish(input, rtmpUrl, logpath) {
		let args = this.getCommand(input);
		args.push('-f', 'flv');
		args.push(rtmpUrl);

		return this.exec(args, logpath);
	}

	exec(args, logpath) {
		let exe = this.options.path ? this.options.path : 'ffmpeg';
		let process = child_process.spawn(exe, args);

		if(logpath) {
			let log = fs.createWriteStream(logpath);

			process.stdout.on('data', (data) => {
				let message = data.toString('utf8')
				log.write(message);
			});

			process.stderr.on('data', (data) => {
				let message = data.toString('utf8')
				log.write(message);
			});

			process.on('exit', (code, signal) => {
				log.end();
			});
		}

		return process;
	}

	getCommand(input) {
		let args = [
			'-analyzeduration', '2147483647',
			'-probesize', '2147483647',
			'-protocol_whitelist', 'file,crypto,tcp,udp,rtp',
			'-i', input,
			'-vcodec', 'h264',
			'-acodec', 'aac',
			'-shortest'
		];

		if(this.options.enableDebug) {
			args.push('-loglevel', 'debug');
		}

		return args;
	}
}

module.exports = ffmpeg;