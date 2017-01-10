var EventEmitter = require('events').EventEmitter;
var util = require('util');

// wrapper function to prevent duplicate call to callback
function callOnce(fn) {
	var called = false;
	return function () {
		if (called) {
			console.error(new Error('expect function be called only once'));
			return;
		}
		called = true;
		return fn.apply(null, [].slice.call(arguments, 0));
	}
}

function Queue(loopSize) {
	this.max = loopSize;
	this.items = [];
	this.old = 0;
	this.exceedItems = [];
	this.running = false;
	this.prependList = [];
	this.length = 0;
	this.taskHandle = null;
	this.currentTask = null;
}
util.inherits(Queue, EventEmitter);
Queue.prototype._updateLength = function _updateLength() {
	this.length = this.items.length - this.old + this.exceedItems.length + this.prependList.length;
}
Queue.prototype._updateQueue = function _updateQueue() {
	while (this.exceedItems.length > 0 && 
			(this.old > 0 || this.max > this.items.length)) {
		this.push(this.exceedItems.shift());
	}
}
Queue.prototype.push = function push(item) {
	if (this.max > this.items.length) {
		this.items.splice(this.items.length - this.old, 0, item);
		this._updateLength();
		return true
	}
	if(this.old > 0) {
		this.emit('remove', this.items[this.items.length - this.old]);
		this.items.splice(this.items.length - this.old, 1, item);
		this.old--;
		this._updateLength();
		return true;
	}
	// queue full
	this.exceedItems.push(item);
	this._updateLength();
	return false;
}
Queue.prototype.shift = function shift() {
	var item;
	if (this.prependList.length > 0) {
		item = this.prependList.shift();
		this._updateLength();
		return item
	}
	if (this.old < this.items.length) {
		this.old++;
	}
	if (this.items.length === 0) {
		return null;
	}
	item = this.items.shift();
	this.items.push(item);
	this._updateQueue()
	this._updateLength();
	this.emit('repeat', item);
	return item;
}
// these task only run once
Queue.prototype.unshift = function unshift(item) {
	this.prependList.unshift(item);
	this._updateLength();
}
Queue.prototype.remove = function remove(item) {
	var i, isOld;
	for (i = this.exceedItems.length - 1; i >= 0; i--) {
		if (item === this.exceedItems[i]) {
			this.exceedItems.splice(i, 1)
			this.emit('remove', item)
		}
	}
	for (i = this.prependList.length - 1; i >= 0; i--) {
		if (item === this.prependList[i]) {
			this.prependList.splice(i, 1)
			this.emit('remove', item)
		}
	}
	for (i = this.items.length - 1; i >= 0; i--) {
		isOld = this.items.length - this.old <= i;
		if (item === this.items[i]) {
			if (isOld) this.old--;
			this.items.splice(i, 1)
			this.emit('remove', item)
		}
	}
	this._updateQueue();
	this._updateLength();
}
Queue.prototype.toString = function toString() {
	return `[${this.exceedItems.join(',')}][${this.items.join(',')}] ${this.length}`;
}
Queue.prototype._next = function start() {
	var self = this;
	var task = self.shift();
	if (!task) {
		this.running = false;
		return;
	}
	this.currentTask = task;
	try {
		this.taskHandle = task(callOnce(function (err, data) {
			self.taskHandle = null;
			self.currentTask = null;
			if (err) {
				self.remove(task);
				self.emit('error', err, task);
			} else {
				self.emit('success', data, task);
			}
			self._next();
		}))
	} catch (err) {
		this.taskHandle = null;
		this.currentTask = null;
		this.remove(task);
		this.emit('error', err, task);
		this._next();
	}
}
Queue.prototype.start = function start() {
	if (this.running) return false;
	if (this.items.length === 0) return false;
	this.running = true;
	this._next();
	return true;
}
Queue.prototype.signal = function signal(data) {
	if ('function' === typeof this.taskHandle) {
		this.taskHandle(data)
	}
}
Queue.helpers = {
	mergeTask: function(task1, task2) {
		return function merged(cb) {
			var handle, stopped = false;
			handle = task1(callOnce(function (err, data) {
				if (err) {
					return cb(err);
				}
				if (stopped) {
					cb(null, data);
				}
				handle = task2(callOnce(function (err, data2) {
					if (err) {
						return cb(err);
					}
					cb(null, [data, data2])
				}))
			}))
			return function wrapHandle(data) {
				if (data !== 'stop') {
					throw new Error('not implement yet');
				}
				stopped = true;
				if ('function' === typeof handle) {
					handle(data)
				}
			}
		}
	}
}

module.exports = Queue;