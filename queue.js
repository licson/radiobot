var EventEmitter = require('events').EventEmitter;
var util = require('util');

function Queue(loopSize) {
	this.max = loopSize;
	this.items = [];
	this.old = 0;
	this.exceedItems = [];
	this.running = false;
	this.prependList = [];
}
util.inherits(Queue, EventEmitter);

Queue.prototype._updateLength = function _updateLength() {
	this.length = this.items.length - this.old + this.exceedItems.length + this.prependList.length;
}
Queue.prototype._updateQueue = function _updateQueue() {
	if (this.exceedItems.length > 0 && 
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
	item = this.items.shift();
	this.items.push(item);
	this._updateQueue()
	this._updateLength();
	return item;
}
// these task only run once
Queue.prototype.unshift = function unshift(item) {
	this.prependList.unshift(item);
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
	task(function (err, data) {
		if (err) {
			self.emit(err);
		}
		self.emit('success', data, task);
		self._next();
	})
}
Queue.prototype.start = function start() {
	if (this.running) return false;
	if (this.items.length === 0) return false;
	this.running = true;
	this._next();
	return true;
}
Queue.helpers = {
	mergeTask: function(a, b) {
		return function merged(cb) {
			a(function (err, data) {
				if (err) {
					return cb(err);
				}
				b(function (err, data2) {
					if (err) {
						return cb(err);
					}
					cb(null, [data, data2])
				})
			})
		}
	}
}

/*

var q = new Queue(5);

for (var i = 0; i < 8; i++) {
	+function (i) {
		q.push(Queue.helpers.mergeTask(function (cb) {
			setTimeout(function () {
				console.log(i)
				cb()
			}, 500)
		},function (cb) {
			setTimeout(function () {
				console.log(i + 0.5)
				cb()
			}, 500)
		}))
	} (i)
}

setInterval(function () {
	console.log('inserting a song');
	q.push(function (cb) {
		setTimeout(function () {
			console.log('song-' + Date.now())
			cb()
		}, 500)
	})
}, 3200);

setTimeout(function () {
	console.log('unshifting task...')
	q.unshift(function (cb) {
		console.log('this task run once only')
		cb()
	})
}, 3000)

q.start()
*/

module.exports = Queue;