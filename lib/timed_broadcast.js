module.exports = function (bridge) {
bridge.allOnce(['queue', 'doTTS', 'doBroadcast', 'config'], 
function (queue, doTTS, doBroadcast, config) {
// ------------

const cron = require('node-cron');
const moment = require('moment');

if(!config.timed_broadcast.enabled) return;

cron.schedule('* * * * *', function () {
	queue.start();
});

// Broadcast time
cron.schedule('0 * * * *', function () {
	doTTS('The time now is ' + moment().format(config.timed_broadcast.timeFormat) + '.')(function () {});
});

// Advertisment
cron.schedule('*/15 * * * *', function () {
	queue.unshift(function (cb) {
		bridge.emit("metadata", 'Advertisment Time');
		return doTTS(config.timed_broadcast.advertisment)(cb);
	}, {
		uid: "tts://" + config.timed_broadcast.advertisment,
		type: "Advertisment",
		title: "Advertisment Time",
		text: config.timed_broadcast.advertisment
	});
	queue.start();
});

// ------------
})
}
