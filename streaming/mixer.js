"use strict";
const stream = require("stream");
const EventEmitter = require("events").EventEmitter;
const util = require("util");
const config = require("../config");

function Source(obj) {
	var self = this;
	if (!(this instanceof Source)) {
		return new Source(obj);
	}
	
	EventEmitter.call(this);
	
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
	
	Object.keys(dafaultValue).forEach(function (key) {
		self[key] = dafaultValue[key];
	});
	
	Object.keys(obj).forEach(function (key) {
		self[key] = obj[key];
	});
}

util.inherits(Source, EventEmitter);

Source.prototype.addBuffer = function addBuffer(buffer) {
	this.buffers.push(buffer);
	this.length += buffer.length;
	this.total += buffer.length;
};

Source.prototype.remainingSamples = function remainingSamples(sampleSize) {
	return Math.floor(this.length / sampleSize);
};

Source.prototype.setVolume = function fadeTo(volume) {
	this.transitionLength = -1;
	this.volume = volume;
};

Source.prototype.fadeTo = function fadeTo(volume, time) {
	this.transitionFrom = this.volume;
	this.transitionTo = volume;
	this.transitionCurrent = 0;
	this.transitionLength = Math.floor(time / 1000 * this.sampleRate);
};

Source.prototype.setError = function setError(err) {
	if (err) this.error = err;
};

Source.prototype.is = function is(label) {
	return this.labels.indexOf(label) >= 0;
};

var tableSize = 4000;
var easingLookup = [];
var volumeLookup = [];

function easingFunction(x) {
	return x * x * x;
}

function easing(x, from, to) {
	// Do a clamp to prevent out of bounds access
	if(x > 1.0) x = 1.0;
	if(x < 0.0) x = 0.0;
	var i = ~~(x * (tableSize - 1));
	return from + easingLookup[i] * (to - from);
}

function volumeFunction(x) {
	// return Math.exp(6.9077528 * x) / 1000;
	return Math.pow(10, (1 - x) * -3);
}

function volume(rawVolume) {
	// Do a clamp to prevent out of bounds access
	if(rawVolume > 1.0) rawVolume = 1.0;
	if(rawVolume < 0.0) rawVolume = 0.0;
	var i = ~~(rawVolume * (tableSize - 1));
	return volumeLookup[i];
}

for (var i = 0; i < tableSize; i++) {
	easingLookup.push(easingFunction(i / (tableSize - 1)));
	volumeLookup.push(volumeFunction(i / (tableSize - 1)));
}

function MixerStream (bitdepth, channel, sampleRate) {
	stream.Readable.call(this);
	
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
}

util.inherits(MixerStream, stream.Readable);

MixerStream.prototype._read = function _read(size) {
	if (!this.started) {
		this._startPolling();
		this._startLoop();
		this.startTime = Date.now();
		this.started = true;
	}
};

// start to push data to destination
MixerStream.prototype._startLoop = function _startLoop() {
	var self = this;
	
	this.startTime = Date.now();
	this.frame = 0;
	
	var fn = function () {
		self.frame++;
		
		self.sources.forEach(function(item, index) {
			var buff;
			if (item.length < self.highWaterMark) {
				buff = item.stream.read(~~(self.sampleRate * self.sampleSize * self.channel / self.fps * 4));
				if (buff) {
					item.addBuffer(buff);
				}
			}
		});
		
		self._startMerge(self.sampleRate * self.sampleSize / self.fps);
		self.loopId = setTimeout(fn, self.startTime + 1000 / self.fps * self.frame - Date.now());
	};
	
	this.loopId = setTimeout(fn, 1000 / this.fps);
	fn();
};

// stop to push data to destination
MixerStream.prototype._stopLoop = function _stopLoop() {
};

// get data we want to merge
MixerStream.prototype._startMerge = function _startMerge(length) {
	// console.log('[start merge]');
	// find the shortest buffer
	var self = this;
	var buffers = [];
	this.sources.forEach(function (item, index) {
		if (item.length < length && item.ended) {
			item.buffers.push(Buffer.alloc(length - item.length));
			item.length = length;
		}
	});
	
	// align to frame border
	length = Math.floor(length / this.sampleSize) * this.sampleSize;
	
	// get buffers we want
	this.sources.forEach(function(item) {
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
		    buffers.push(self.emptyBuffer);
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
};

// merge sounds and push it out
MixerStream.prototype._mixin = function mixin(buffers, sources, length, bitdepth, channel) {
	// mix these buffers
	var sourceIndex, source,
		offset = 0,
		target = Buffer.alloc(length),
		sampleSize = bitdepth / 8 * channel,
		max = (1 << bitdepth - 1) - 1;
	
	var readValue = MixerStream.helpers.readValue[bitdepth];
	var writeValue = MixerStream.helpers.writeValue[bitdepth];
	
	for (offset = 0; offset < target.length; offset += bitdepth / 8) {
		var value = 0, value2 = null;
		for (sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
			source = sources[sourceIndex];
			
			if (offset % sampleSize === 0 && source.transitionLength > 0) {
				source.transitionCurrent++;
				source.volume = easing(
					source.transitionCurrent / source.transitionLength,
					source.transitionFrom,
					source.transitionTo
				);
				
				if (source.transitionCurrent >= source.transitionLength) {
					source.volume = source.transitionTo;
					source.transitionLength = -1;
				}
			}
			
			value2 = (readValue(buffers[sourceIndex], offset) * volume(source.volume)) / max;
			
			// value += value2;
			
			value = (1 - Math.abs(value * value2)) * (value + value2);
		}
		
		// Clip the sample if neccessary
		value = value > 1 ? 1 : value;
		value = value < -1 ? -1 : value;
		value *= max;
		writeValue(target, ~~value, offset);
	}
	
	return target;
};

try {
	if (config.debug.useJavascriptMixer) {
		throw new Error("debug throw");
	}
	
	MixerStream.prototype._mixin = require('../native_mixer/build/Release/mix.node');
	console.log("[Mixer] Using optimized C++ implementation.");
} catch (e) {
	console.warn("[Mixer] Using JS implementation.");
}

// start to pull from source
MixerStream.prototype._startPolling = function _startPolling() {
	this.paused = false;
};

// stop to pull from source
MixerStream.prototype._stopPolling = function _stopPolling() {
	this.paused = true;
};

MixerStream.prototype.addSource = function addSource(readable, labels) {
	console.log('[Mixer] New track');
	
	if (!labels) {
		labels = [];
	} else if (!Array.isArray(labels)) {
		labels = [labels];
	}
	
	var self = this, item = Source({
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
};

MixerStream.prototype.getSources = function (labels) {
	if (labels && !Array.isArray(labels)) {
		labels = [labels];
	}
	if (!labels) {
		return this.sources.slice(0);
	} else {
		return this.sources.filter(function (item) {
			var matched = false;
			
			labels.forEach(function(label) {
				if (item.labels.indexOf(label) >= 0) {
					matched = true;
				}
			});
			
			return matched;
		});
	}
};

MixerStream.prototype.count = function () {
	return this.sources.length;
};

MixerStream.helpers = {
	readValue: {
		"8": Function.prototype.call.bind(Buffer.prototype.readInt8),
		"16": Function.prototype.call.bind(Buffer.prototype.readInt16LE),
		"32": Function.prototype.call.bind(Buffer.prototype.readInt32LE)
	},
	writeValue: {
		"8": Function.prototype.call.bind(Buffer.prototype.writeInt8),
		"16": Function.prototype.call.bind(Buffer.prototype.writeInt16LE),
		"32": Function.prototype.call.bind(Buffer.prototype.writeInt32LE)
	},
};

module.exports = MixerStream;