module.exports = function (bridge) {
	bridge.allOnce(['queue', 'URLHandlers', 'doTTS', 'doBroadcast', 'config'], function (queue, URLHandlers, doTTS, doBroadcast, config) {
		const cron = require('node-cron');
		const moment = require('moment');
		
		if (!config.timed_broadcast.enabled) return;
		
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
				bridge.emitSticky('metadata', 'Advertisment Time');
				
				if (!!config.timed_broadcast.advertisment_track) {
					URLHandlers.find(config.timed_broadcast.advertisment_track).getStreamURL().then(function (url) {
						doBroadcast(url)(cb);
					}).catch(function () {
						doTTS(config.timed_broadcast.advertisment)(cb);
					});
				}				else {
					return doTTS(config.timed_broadcast.advertisment)(cb);
				}
			}, {
				uid: 'tts://' + config.timed_broadcast.advertisment,
				type: 'Advertisment',
				title: 'Advertisment Time',
				text: config.timed_broadcast.advertisment
			});
			
			queue.start();
		});
	});
};
