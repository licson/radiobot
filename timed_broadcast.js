var Queue = require("./utils/queue");
var cron = require('node-cron');
var moment = require('moment');

module.exports = function (queue, doTTS, doBroadcast, injector) {
	// Broadcast time
	cron.schedule('0 * * * *', function () {
		queue.unshift(function (cb) {
			injector.emit("metadata", 'Time Broadcast'); 
			doTTS('The time now is ' + moment().format('h A') + ', Singapore Time.')(cb);
		});
		queue.signal('stop');
		queue.start();
	});

	// Advertisment
	cron.schedule('*/15 * * * *', function () {
		queue.unshift(function (cb) {
			injector.emit("metadata", 'Advertisment Time');
			doTTS("Licson's Radio, the first interactive internet radio, ever. Please enjoy!")(cb);
		});
		// queue.signal('stop');
		queue.start();
	});
};
