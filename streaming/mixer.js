'use strict';

const { Stream } = require('stream');
const EventEmitter = require('events').EventEmitter;
const deepAssign = require('deep-assign');
const config = deepAssign(require('../config.example.json'), require('../config.json'));

class Source extends EventEmitter {
	constructor(obj) {
		super();

		if (!(this instanceof Source)) {
			return new Source(obj);
		}

		var dafaultValue = {
			labels: [],
			stream: null,
			sampleRate: null,
			buffers: [],
			length: 0,
			total: 0,
			volume: 1,

			error: null,

			transitionMode: 0,
			transitionLength: -1,
			transitionCurrent: 0,
			transitionFrom: 1,
			transitionTo: 1,

			ended: false
		};

		Object.keys(dafaultValue).forEach((key) => {
			this[key] = dafaultValue[key];
		});

		Object.keys(obj).forEach((key) => {
			this[key] = obj[key];
		});
	}

	addBuffer(buffer) {
		this.buffers.push(buffer);
		this.length += buffer.length;
		this.total += buffer.length;
	}

	remainingSamples(sampleSize) {
		return Math.floor(this.length / sampleSize);
	}

	setVolume(volume) {
		this.transitionLength = -1;
		this.volume = volume;
	}

	fadeTo(volume, time) {
		this.transitionFrom = this.volume;
		this.transitionTo = volume;
		this.transitionCurrent = 0;
		this.transitionLength = Math.floor(time / 1000 * this.sampleRate);
	}

	setError(err) {
		if (err)
			this.error = err;
	}

	is(label) {
		return this.labels.indexOf(label) >= 0;
	}
}

class MixerStream extends Stream.Readable {
	constructor(bitdepth, channel, sampleRate) {
		super();

		if (bitdepth % 8 != 0) {
			throw new Error('Bit depth is not a multiple of 8');
		}

		this.bitdepth = bitdepth;
		this.channel = channel;
		this.sampleSize = bitdepth * channel / 8;
		this.sampleRate = sampleRate;

		this.sources = [];

		this.sampleCount = 0;

		this.started = false;
		this.startTime = null;

		this.loopId = null;

		this.paused = true;
		this.fps = 20;
		this.frame = 0;

		this.segmentLength = this.sampleRate * this.sampleSize / this.fps;
		this.segmentLength = Math.floor(this.segmentLength / this.sampleSize) * this.sampleSize;

		this.emptyBuffer = Buffer.alloc(this.segmentLength);

		this.highWaterMark = this.sampleRate * this.sampleSize / this.fps * 8; // prefetch

		this._tableSize = 4000;
		this._easingLookup = [];

		for (var i = 0; i < this._tableSize; i++) {
			this._easingLookup.push(this.easingFunction(i / (this._tableSize - 1)));
		}
	}

	easingFunction(x) {
		return x * x * x;
	}
	
	easing(x, from, to) {
		// Do a clamp to prevent out of bounds access
		if (x > 1.0) x = 1.0;
		if (x < 0.0) x = 0.0;

		var i = ~~(x * (this._tableSize - 1));
		return from + this._easingLookup[i] * (to - from);
	}

	_read(size) {
		if (!this.started) {
			this._startPolling();
			this._startLoop();
			this.startTime = Date.now();
			this.started = true;
		}
	}

	// start to push data to destination
	_startLoop() {
		this.startTime = Date.now();
		this.frame = 0;

		var fn = () => {
			this.frame++;

			this.sources.forEach((item) => {
				var buff;
				if (item.length < this.highWaterMark) {
					buff = item.stream.read(~~(this.sampleRate * this.sampleSize * this.channel / this.fps * 4));
					if (buff) {
						item.addBuffer(buff);
					}
				}
			});

			this._startMerge(this.sampleRate * this.sampleSize / this.fps);
			this.loopId = setTimeout(fn, this.startTime + 1000 / this.fps * this.frame - Date.now());
		};

		this.loopId = setTimeout(fn, 1000 / this.fps);
		fn();
	}

	// stop to push data to destination
	_stopLoop() {
	}

	// get data we want to merge
	_startMerge(length) {
		// find the shortest buffer
		var buffers = [];
		this.sources.forEach((item) => {
			if (item.length < length && item.ended) {
				item.buffers.push(Buffer.alloc(length - item.length));
				item.length = length;
			}
		});

		// align to frame border
		length = Math.floor(length / this.sampleSize) * this.sampleSize;

		// get buffers we want
		this.sources.forEach((item) => {
			var temp;
			if (item.length >= length) {
				if (item.buffers[0].length >= length) {
					temp = item.buffers[0];
					buffers.push(temp.slice(0, length));
					item.buffers[0] = temp.slice(length);
				} else {
					temp = Buffer.concat(item.buffers);
					buffers.push(temp.slice(0, length));
					item.buffers = [temp.slice(length)];
				}
				item.length -= length;
			} else {
				buffers.push(this.emptyBuffer);
			}
		});

		var output = this._mixin(buffers, this.sources, length, this.bitdepth, this.channel);
		this.sampleCount += length / this.sampleSize;
		this.push(output);

		// remove ended source
		for (var i = this.sources.length - 1; i >= 0; i--) {
			if (this.sources[i].ended && this.sources[i].remainingSamples(this.sampleSize) === 0) {
				var source = this.sources[i].emit('remove', this.sources[i].error);
				this.sources.splice(i, 1);

				this.emit('remove_track', source);
			}
		}
	}

	// Main mixdown function
	_mixin(buffers, sources, length, bitdepth, channel) {
		var sourceIndex, source, offset = 0, target = Buffer.alloc(length), sampleSize = bitdepth / 8 * channel, max = (1 << bitdepth - 1) - 1;

		var readValue = MixerStream.helpers.readValue[bitdepth];
		var writeValue = MixerStream.helpers.writeValue[bitdepth];

		for (offset = 0; offset < target.length; offset += bitdepth / 8) {
			var value = 0, value2 = null;

			// Loop through all available sources
			for (sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
				source = sources[sourceIndex];

				// Process fading
				if (offset % sampleSize === 0 && source.transitionLength > 0) {
					source.transitionCurrent++;
					source.volume = this.easing(
						source.transitionCurrent / source.transitionLength,
						source.transitionFrom,
						source.transitionTo
					);

					if (source.transitionCurrent >= source.transitionLength) {
						source.volume = source.transitionTo;
						source.transitionLength = -1;
					}
				}

				value2 = (readValue(buffers[sourceIndex], offset) * source.volume) / max;

				// Mix
				value = (1 - Math.abs(value * value2)) * (value + value2);
			}

			// Clip the sample if neccessary
			value = value > 1 ? 1 : value;
			value = value < -1 ? -1 : value;
			value *= max;

			writeValue(target, ~~value, offset);
		}

		return target;
	}

	// start to pull from source
	_startPolling() {
		this.paused = false;
	}

	// stop to pull from source
	_stopPolling() {
		this.paused = true;
	}

	addSource(readable, labels) {
		console.log('[Mixer] New track');

		if (!labels) {
			labels = [];
		} else if (!Array.isArray(labels)) {
			labels = [labels];
		}

		var item = new Source({
			stream: readable,
			sampleRate: this.sampleRate,
			labels: labels
		});


		this.sources.push(item);
		this.emit('new_track', item);

		readable.on('end', function () {
			item.ended = true;
		});

		readable.on('close', function () {
			item.ended = true;
		});

		readable.on('error', function (err) {
			item.error = err;
			item.ended = true;
		});

		// force the underlying data source to start
		var res = readable.read(this.highWaterMark);
		if (res) item.addBuffer(res);

		item.on('remove', function () {
			console.log('[Mixer] Removing track...');
		});

		return item;
	}

	getSources(labels) {
		if (labels && !Array.isArray(labels)) {
			labels = [labels];
		}
		if (!labels) {
			return this.sources.slice(0);
		} else {
			return this.sources.filter(function (item) {
				var matched = false;

				labels.forEach(function (label) {
					if (item.labels.indexOf(label) >= 0) {
						matched = true;
					}
				});

				return matched;
			});
		}
	}

	count() {
		return this.sources.length;
	}
}

// Attempt to load and use C++ module
try {
	if (config.debug.useJavascriptMixer) {
		throw new Error('debug throw');
	}
	
	MixerStream.prototype._mixin = require('../native_mixer/build/Release/mix.node');
	console.log('[Mixer] Using optimized C++ implementation.');
} catch (e) {
	console.warn('[Mixer] Using JS implementation.');
}

// Implement read and write buffer logic for 24-bit integers
function readInt24LE(buf, offset) {
	var [b1, b2, b3] = [buf[offset], buf[offset + 1], buf[offset + 2]];
	return (b3 & 0x80) << 24 | b3 << 16 & 0x7fffff | b2 << 8 & 0xffff | b1 & 0xff;
};

function writeInt24LE(buf, v, offset) {
	buf[offset] = v & 0xff;
	buf[offset + 1] = v >> 8 & 0xff;
	buf[offset + 2] = v >> 16 & 0xff | (v < 0 ? 0x80 : 0);
};

MixerStream.helpers = {
	readValue: {
		'8': Function.prototype.call.bind(Buffer.prototype.readInt8),
		'16': Function.prototype.call.bind(Buffer.prototype.readInt16LE),
		'24': readInt24LE,
		'32': Function.prototype.call.bind(Buffer.prototype.readInt32LE)
	},
	writeValue: {
		'8': Function.prototype.call.bind(Buffer.prototype.writeInt8),
		'16': Function.prototype.call.bind(Buffer.prototype.writeInt16LE),
		'24': writeInt24LE,
		'32': Function.prototype.call.bind(Buffer.prototype.writeInt32LE)
	},
};

module.exports = MixerStream;