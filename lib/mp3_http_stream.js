module.exports = function (bridge) {
	bridge.allOnce(['get_router' ,'mp3_stream', 'queue', 'config'], 
	function (getRouter, mp3Stream, queue, config) {
		const router = getRouter();
		const icy = require('icy');
		
		var listenersCount = 0;
		var currentTitle = '';
		
		bridge.on("metadata", function (title) {
			currentTitle = title;
		});
		
		router.get(/^(?:\/live.mp3|\/stream|\/;)(?:\?|$)/, function (req, res) {
			listenersCount++;
			console.log("[Server] New listener, current count: %d", listenersCount);
		
			// HTTP and ICY headers
			res.header({
				"Accept-Ranges": "none",
				"Content-Type": "audio/mpeg",
				"icy-name": config.station.name,
				"icy-url": config.station.url,
				"icy-description": config.station.description,
				"icy-pub": config.station.public ? '1' : '0',
				"icy-br": config.output.bitrate
			});
			
			// Holds last title message
			var lastTitle = null;
		
			// Client can handle ICY streaming titles, sending metaint
			if (req.headers['icy-metadata'] == '1') {
				console.log("[Server] Client supports ICY streaming title. Sending metaint.");
				res.header("icy-metaint", config.icy.meta_int);
			}
			
			res.write('');
		
			var injector = new icy.Writer(config.icy.meta_int);
		
			// Pipe through the metadata injector if client supports streaming titles
			if (req.headers['icy-metadata'] == '1') {
				console.log("[Server] Client supports ICY streaming title. Attaching to injector.");
				mp3Stream.pipe(injector).pipe(res);
				injector.queue(currentTitle);
			} else {
				mp3Stream.pipe(res);
			}
		
			// Queue the title at the next metaint interval
			var waitforMetadata = function (title) {
				if (req.headers['icy-metadata'] == '1' && title != lastTitle) {
					injector.queue(title);
					lastTitle = title;
				}
			};
		
			// Listen on a custom metadata event
			mp3Stream.on('metadata', waitforMetadata);
		
			res.on('close', function () {
				injector.unpipe(); // Remove the injector if attached
				mp3Stream.unpipe(injector); // Remove the injector from the source if present
				mp3Stream.unpipe(res); // Remove current connection
				mp3Stream.resume(); // Continue to consume input
		
				injector = null;
		
				mp3Stream.removeListener('metadata', waitforMetadata); // Remove our metadata listener
		
				listenersCount--;
				console.log("[Server] Listener leave, current count: %d", listenersCount);
			});
		});
	})
}