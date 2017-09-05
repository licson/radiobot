module.exports = function(bridge) {
	bridge.allOnce(['config', 'mixer', 'get_router', 'analytics'], function(config, mixer, getRouter, analytics) {
		var router = getRouter();
		
		var listenersCount = 0
		
		router.get('/live.raw', function(req, res) {
			listenersCount++;
			analytics.updateListenerCount('raw pcm', listenersCount);
			
			res.header('Content-Type', 'application/octet-stream');
			res.header('X-Radio-SampleSize', 16);
			res.header('X-Radio-SampleRate', config.output.samplerate);
			res.header('X-Radio-Channels', config.output.channels);
			mixer.pipe(res, { end: false });

			res.on('close', function() {
				mixer.unpipe(res);
				
				listenersCount--;
				analytics.updateListenerCount('raw pcm', listenersCount);
			})
		});
	});
};