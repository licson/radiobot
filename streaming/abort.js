const stream = require('stream');
const util = require('util');

function AbortStream(highWaterMark, chunkSize) {
	this.highWaterMark = highWaterMark;
	this.chunkSize = chunkSize;
	
	stream.Transform.call(this, {
		highWaterMark: this.highWaterMark * 2
	});
	
	
	// var self = this;
	
	// setInterval(function () {
	// 	console.log(self._readableState.length)
	// }, 10000)
}

util.inherits(AbortStream, stream.Transform);

AbortStream.prototype._transform = function (chunk, encoding, callback) {
	var self = this;
	
	if (this._readableState.length > this.highWaterMark) {
		// remove some data from internal buffer
		process.nextTick(function () {
			self.read(self.chunkSize);
			self.emit('abort_data', self.chunkSize);
		});
	}
	
	callback(null, chunk);
};

module.exports = AbortStream;