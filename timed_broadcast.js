var cron = require('node-cron');
var moment = require('moment');

module.exports = function (queue, doTTS, doBroadcast) {
	// Broadcast time
	cron.schedule('0 * * * *', function () {
		queue.unshift(doTTS('The time now is ' + moment().format('h A') + ', Singapore Time.'));
		queue.start();
	});

	// Advertisment
	cron.schedule('*/15 * * * *', function () {
		queue.unshift(doTTS("Licson's Radio, the first interactive internet radio, ever. Please enjoy!"));
		queue.start();
	});
};
