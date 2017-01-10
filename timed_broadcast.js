var Queue = require("./utils/queue");
var cron = require('node-cron');
var moment = require('moment');

module.exports = function (queue, doTTS, doBroadcast, injector) {
	cron.schedule('* * * * *', function () {
		queue.start();
	});
	
	// Broadcast time
	cron.schedule('0 * * * *', function () {
		doTTS('The time now is ' + moment().format('h A') + ', Singapore Time.')(function () {});
	});

	// Advertisment
	cron.schedule('*/15 * * * *', function () {
		queue.unshift(function (cb) {
			injector.emit("metadata", 'Advertisment Time');
			doTTS("Licson's Radio, the first interactive internet radio, ever. Please enjoy!")(cb);
		});
		queue.start();
	});
};
