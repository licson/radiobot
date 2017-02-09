const EventEmitter = require("events").EventEmitter;
const util = require("util");

function StickyEventEmitter(opts) {
	EventEmitter.call(this);
	this._stickyEvent = {};
	this._stickyEventOptions = opts || {};
}

util.inherits(StickyEventEmitter, EventEmitter);

StickyEventEmitter.prototype.emitSticky = function emitSticky(event) {
	if (this._stickyEventOptions.debug) {
		console.log('[stick event] emit sticky event: ' + event, ([].slice.call(arguments, 1) + "").replace(/\r|\n/g, ' ').slice(0, 30));
	}
	
	this._stickyEvent[event] = [].slice.call(arguments, 1);
	return EventEmitter.prototype.emit.apply(this, [].slice.call(arguments, 0));
};

StickyEventEmitter.prototype.addListener = function addListener(event, listener) {
	if (typeof listener !== 'function') {
		throw new TypeError('"listener" argument must be a function');
	}
	
	if (this._stickyEvent[event] != null) {
		listener.apply(this, this._stickyEvent[event]);
	}
	
	return EventEmitter.prototype.addListener.call(this, event, listener);
};

StickyEventEmitter.prototype.on = StickyEventEmitter.prototype.addListener;

if (EventEmitter.prototype.prependListener) {
	StickyEventEmitter.prototype.prependListener = function prependListener(event, listener) {
		if (typeof listener !== 'function') {
			throw new TypeError('"listener" argument must be a function');
		}
		
		if (this._stickyEvent[event] != null) {
			listener.apply(this, this._stickyEvent[event]);
		}
		
		return EventEmitter.prototype.prependListener.call(this, event, listener);
	};
}

StickyEventEmitter.prototype.once = function once(event, listener) {
	if (typeof listener !== 'function') {
		throw new TypeError('"listener" argument must be a function');
	}
	
	if (this._stickyEvent[event] != null) {
		listener.apply(this, this._stickyEvent[event]);
		return this; // it only got called once;
	}
	
	return EventEmitter.prototype.once.call(this, event, listener);
};

if (EventEmitter.prototype.prependOnceListener) {
	StickyEventEmitter.prototype.prependOnceListener = function once(type, listener) {
		if (typeof listener !== 'function') {
			throw new TypeError('"listener" argument must be a function');
		}
		
		if (this._stickyEvent[event] != null) {
			listener.apply(this, this._stickyEvent[event]);
			return this; // it only got called once;
		}
		
		return EventEmitter.prototype.prependOnceListener.call(this, event, listener);
	};
}

StickyEventEmitter.prototype.allOnce = function allOnce(events, listener) {
	if (!Array.isArray(events)) {
		throw new TypeError('"events" argument must be an array');
	}
	
	if (typeof listener !== 'function') {
		throw new TypeError('"listener" argument must be a function');
	}
	
	var results = [];
	var remain = events.length;
	
	var self = this;
	
	events.forEach(function (event, index) {
		self.once(event, function () {
			var args = arguments[0];
			
			if (arguments.length > 1) {
				args = [].slice.call(arguments, 0);
			}
			
			results[index] = args;
			remain--;
			
			if (remain === 0) {
				listener.apply(self, results);
			}
		});
	});
	
	return this;
};

module.exports = StickyEventEmitter;