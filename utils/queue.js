var EventEmitter = require('events').EventEmitter;
var util = require('util');

function TaskWrapper(taskFactory, info, initTime, execCount) {
	this.taskFactory = taskFactory;
	this.info = info || {};
	this.initTime = initTime || Date.now();
	this.execCount = execCount || 0;
}
TaskWrapper.prototype.run = function () {
	var args = [].slice.call(arguments, 0);
	return this.taskFactory.apply(this, args);
}

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

function Queue(loopSize, option) {
	this.max = loopSize;
	this.items = [];
	this.old = 0;
	this.exceedItems = [];
	this.running = false;
	this.prependList = [];
	this.length = 0;
	this.taskHandle = null;
	this.currentTask = null;
	
	option = option || {};
	if ('function' === typeof option.taskToJSON) {
		this._taskToJSON = option.taskToJSON
	}
	if ('function' === typeof option.JSONToTask) {
		this._JSONToTask = option.JSONToTask
	}
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

// info(optional) {uid: ....[, otherProperty]}
Queue.prototype.push = function push(task, info) {
	var self = this;
	
	process.nextTick(function () {
		this.emit('push', item.taskFactory, item.info);
	}.bind(this));
	
	this.findTask(info).forEach(function (task) {
		self.remove(task);
	});
	
	var item = new TaskWrapper(task, info);
	if (this.max > this.items.length) {
		this.items.splice(this.items.length - this.old, 0, item);
		this._updateLength();
		return true
	}
	
	if(this.old > 0) {
		var oldest = this.items.filter(function (item) {
			return item.execCount > 0;
		}).sort(function (a, b) {
			return a.initTime > b.initTime ? 1 : -1;
		})[0];
		
		this.remove(oldest);
		this.items.splice(this.items.length - this.old, 0, item);
		this._updateLength();
		return true;
	}
	
	// queue full
	this.exceedItems.push(item);
	this._updateLength();
	
	return false;
}

// these task only run once
Queue.prototype.unshift = function unshift(task, info) {
	var self = this;
	this.findTask(info).forEach(function (task) {
		self.remove(task);
	});
	
	var item = new TaskWrapper(task, info);
	this.prependList.unshift(item);
	this._updateLength();
	
	process.nextTick(function () {
		this.emit('unshift', item.taskFactory, item.info);
	}.bind(this));
}

Queue.prototype.shift = function shift() {
	var item;
	
	if (this.prependList.length > 0) {
		item = this.prependList.shift();
		this._updateLength();
		return item
	}
	
	if (this.items.length === 0) {
		return null;
	}
	
	if (this.old < this.items.length) {
		this.old++;
	}
	
	item = this.items.shift();
	this.items.push(item);
	this._updateQueue();
	this._updateLength();
	this.emit('repeat', item.taskFactory, item.info);
	return item;
}

Queue.prototype.remove = function remove(item, error) {
	if (!item) return;
	
	var i, isOld;
	for (i = this.exceedItems.length - 1; i >= 0; i--) {
		if (item === this.exceedItems[i]) {
			this.exceedItems.splice(i, 1);
			this.emit('remove', item.taskFactory, item.info, error);
		}
	}
	
	for (i = this.prependList.length - 1; i >= 0; i--) {
		if (item === this.prependList[i]) {
			this.prependList.splice(i, 1);
			this.emit('remove', item.taskFactory, item.info, error);
		}
	}
	
	for (i = this.items.length - 1; i >= 0; i--) {
		isOld = this.items.length - this.old <= i;
		if (item === this.items[i]) {
			if (isOld) this.old--;
			this.items.splice(i, 1);
			this.emit('remove', item.taskFactory, item.info, error);
		}
	}
	
	this._updateQueue();
	this._updateLength();
}

Queue.prototype.findTask = function findTask(info) {
	info = info || {};
	if (!info.uid) {
		return [];
	}
	return 	this.exceedItems.filter(function(item) {
	    return item.info.uid === info.uid
	}).concat(this.items.filter(function(item) {
	    return item.info.uid === info.uid
	})).concat(this.prependList.filter(function(item) {
	    return item.info.uid === info.uid
	}));
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
	
	task.execCount++;
	this.currentTask = task;
	
	self.emit('next', task.taskFactory, task.info);
	
	try {
		this.taskHandle = task.run(callOnce(function (err, data) {
			self.taskHandle = null;
			self.currentTask = null;
			if (err) {
				self.remove(task, err);
				self.emit('error', err, task.taskFactory, task.info);
			} else {
				self.emit('success', data, task.taskFactory, task.info);
			}
			self._next();
		}))
	} catch (err) {
		this.taskHandle = null;
		this.currentTask = null;
		this.remove(task, err);
		this.emit('error', err, task.taskFactory, task.info);
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
		this.taskHandle(data);
	}
}

Queue.prototype.toJSON = function toJSON() {
	var self = this;
	
	function encodeTask(task) {
		return {
			initTime: task.initTime,
			execCount: task.execCount,
			info: self._taskToJSON(task.taskFactory, task.info)
		};
	}
	
	return {
		old: this.old,
		items: this.items.map(encodeTask),
		exceedItems: this.exceedItems.map(encodeTask),
		prependList: this.prependList.map(encodeTask)
	};
}

Queue.prototype.loadFromObject = function fromObject(obj) {
	var self = this;
	
	function decodeTask(info) {
		var temp = self._JSONToTask(info.info);
		return new TaskWrapper(temp.task, temp.info, info.initTime, info.execCount);
	}
	
	this.old = obj.old;
	this.items = obj.items.map(decodeTask);
	this.exceedItems = obj.exceedItems.map(decodeTask);
	this.prependList = obj.prependList.map(decodeTask);
	this._updateLength();
}

Queue.prototype._taskToJSON = function _taskToJSON(task, info) {
	console.warn('queue does not implement a toJSON option');
	return info;
}

Queue.prototype._JSONToTask = function _JSONToTask(json) {
	throw new Error("_JSONToTask does not implement");
	// return {task, info}
}

Queue.prototype.getAllTasks = function getAllTasks() {
	return this.prependList.concat(this.items).concat(this.exceedItems);
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
					return cb(null, data);
				}
				
				handle = task2(callOnce(function (err, data2) {
					if (err) {
						return cb(err);
					}
					
					cb(null, [data, data2]);
				}));
			}));
			
			return function wrapHandle(data) {
				if (data !== 'stop') {
					throw new Error('not implement yet');
				}
				
				stopped = true;
				
				if ('function' === typeof handle) {
					handle(data);
				}
			}
		}
	}
}

module.exports = Queue;