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
			return doTTS("Licson's Radio, the first interactive internet radio, ever. Please enjoy!")(cb);
		}, {
			uid: "tts://" + "Licson's Radio, the first interactive internet radio, ever. Please enjoy!",
			type: "Advertisment",
			title: "Advertisment Time",
			text: "Licson's Radio, the first interactive internet radio, ever. Please enjoy!"
		});
		queue.start();
	});
};
