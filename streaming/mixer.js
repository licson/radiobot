var stream = require("stream");
var EventEmitter = require("events").EventEmitter;
var util = require("util");

function Source(obj) {
	var self = this;
	if (!(this instanceof Source)) {
		return new Source(obj);
	}
	
	EventEmitter.call(this);
	
	var dafaultValue = {
		stream: null,
		sampleRate: null,
		buffers: [],
		length: 0,
		total: 0,
		volume: 1,
		fadeCount: 0,
		onStep: null,
		
		transitionMode: 0,
		transitionLength: -1,
		transitionCurrent: 0,
		transitionFrom: 1,
		transitionTo: 1,
		
		ended: false
	}
	
	Object.keys(dafaultValue).forEach(function (key) {
		self[key] = dafaultValue[key];
	})
	
	Object.keys(obj).forEach(function (key) {
		self[key] = obj[key];
	})
}

util.inherits(Source, EventEmitter);

Source.prototype.addBuffer = function addBuffer(buffer) {
	this.buffers.push(buffer);
	this.length += buffer.length;
	this.total += buffer.length;
}

Source.prototype.remainingSamples = function remainingSamples(sampleSize) {
	return Math.floor(this.length / sampleSize);
}

Source.prototype.setVolume = function fadeTo(volume) {
	this.onStep = null;
	this.volume = volume;
}

// rewrite this for better effect
Source.prototype.fadeTo = function fadeTo(volume, time) {;
	/*
	var self = this
	this.fadeCount = 0;
	var startVolume = this.volume;
	var totalSample = time / 1000 * this.sampleRate;
	
	this.onStep = function (count) {
		self.volume = startVolume + (volume - startVolume) * (self.fadeCount / totalSample);
		if (self.fadeCount >= totalSample) {
			self.volume = volume;
			self.onStep = null;
		}
		self.fadeCount++;
	}
	*/
	this.transitionFrom = this.volume;
	this.transitionTo = volume;
	this.transitionCurrent = 0;
	this.transitionLength = Math.floor(time / 1000 * this.sampleRate);
}

function MixerStream (bitdepth, channel, sampleRate, prebuffer) {
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
}

// start to push data to distination
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
		})
		
		self._startMerge(self.sampleRate * self.sampleSize / self.fps);
		self.loopId = setTimeout(fn, self.startTime + 1000 / self.fps * self.frame - Date.now())
	};
	
	this.loopId = setTimeout(fn, 1000 / this.fps)
	fn();
}

// stop to push data to distination
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
	})

	var output = this._mixin(buffers, this.sources, length, this.bitdepth, this.channel);
	this.sampleCount += length / this.sampleSize;
	this.push(output);
	
	// remove ended source
	for (var i = this.sources.length - 1; i >= 0; i--) {
		if (this.sources[i].ended && this.sources[i].remainingSamples(this.sampleSize) === 0) {
			this.sources[i].emit('remove');
			this.sources.splice(i, 1);
		}
	}
}

// merge sounds and push it out
MixerStream.prototype._mixin = function mixin(buffers, sources, length, bitdepth, channel) {
	// mix these buffers
	var sourceIndex, source,
		offset = 0,
		target = Buffer.alloc(length),
		sampleSize = bitdepth / 8 * channel,
		max = Math.pow(2, bitdepth - 1) - 1;
	
	var readValue = MixerStream.helpers.readValue[bitdepth];
	var writeValue = MixerStream.helpers.writeValue[bitdepth];
	
	for (offset = 0; offset < target.length; offset += bitdepth / 8) {
		var value = 0, value2 = null;
		for (sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
			source = sources[sourceIndex];
			
			/*
			
			if (offset % (this.sampleSize) === 0 && source.onStep) {
				source.onStep(this.sampleCount + Math.floor(offset / this.sampleSize));
			}
			
			*/
			
			if (offset % sampleSize === 0 && source.transitionLength > 0) {
				source.transitionCurrent++;
				source.volume = source.transitionFrom + (source.transitionTo - source.transitionFrom)
					* (source.transitionCurrent / source.transitionLength);
				if (source.transitionCurrent >= source.transitionLength) {
					source.volume = source.transitionTo;
					source.transitionLength = -1;
				}
			}
			
			value2 = (readValue(buffers[sourceIndex], offset) * source.volume) / max;
			
			// value += value2;
			
			value = (1 - Math.abs(value * value2)) * (value + value2)
		}
		
		// Clip the sample if neccessary
		value = value > 1 ? 1 : value;
		value = value < -1 ? -1 : value;
		value *= max;
		writeValue(target, ~~value, offset);
	}
	
	return target;
}

try {
	MixerStream.prototype._mixin = require('../native_mixer/build/Release/mix.node');
	console.log("[Mixer] Using optimized C++ implementation.");
} catch (e) {
	console.warn("[Mixer] Using JS implementation.");
}

// start to pull from source
MixerStream.prototype._startPolling = function _startPolling() {
	this.paused = false;
}

// stop to pull from source
MixerStream.prototype._stopPolling = function _stopPolling() {
	this.paused = true;
}

MixerStream.prototype.addSource = function addSource(readable) {
	console.log('[Mixer] New track')
	
	var self = this, item = Source({
		stream: readable,
		sampleRate: this.sampleRate,
		buffers: [],
		length: 0,
		total: 0,
		volume: 1,
		fadeCount: 0,
		onStep: null,
		ended: false
	});
	
	this.sources.push(item)
	
	readable.on('end', function () {
		item.ended = true;
	})
	
	readable.on('close', function () {
		item.ended = true;
	})
	
	readable.on('error', function () {
		item.ended = true;
	})
	
	// force the underlying data source to start
	var res = readable.read(this.highWaterMark);
	if (res) item.addBuffer(res);
	
	item.on('remove', function () {
		console.log('[Mixer] Removing track...')
	})
	
	return item;
}

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
}

module.exports = MixerStream;