module.exports = function (bridge) {
	bridge.allOnce(['get_router', 'mixer', 'queue', 'config', 'analytics'], function (getRouter, mixer, queue, config, analytics) {
		if (!config.opus.enabled) {
			return;
		}
		
		const spawn = require('child_process').spawn;
		const router = getRouter();
		const oggHeader = require('../../utils/ogg_header');
		const icy = require('icy');
		
		var listenersCount = 0;
		var currentTitle = '';
		
		const streamWrapper = spawn('ffmpeg', [
			'-v', '8',
			'-f', 's16le', // Input is signed 16-bit raw PCM
			'-ac', config.output.channels, // Input channels
			'-ar', config.output.samplerate, // Input sample rate
			'-i', '-',
			'-ab', config.opus.bitrate + 'k',  // Bitrate
			'-acodec', 'libopus',
			'-f', 'ogg',
			'-'
		])
		
		mixer.pipe(streamWrapper.stdin);
		streamWrapper.stderr.pipe(process.stderr);
		
		const oggStream = streamWrapper.stdout;
		
		var opusIdentificationHeader = null;
		var opusCommentHeader = null;
		var temp = Buffer.from([]);
		
		function headerCatcher (data) {
			temp = Buffer.concat([temp, data]);
			
			var opusIdentificationHeaderPos = oggHeader.indexOfHeader(temp);
			var opusCommentHeaderrPos = oggHeader.indexOfHeader(temp, opusIdentificationHeaderPos + 1);
			var firstSoundPacketPos = oggHeader.indexOfHeader(temp, opusCommentHeaderrPos + 1);
			
			if (firstSoundPacketPos < 0) {
				return;
			}
			
			opusIdentificationHeader = temp.slice(opusIdentificationHeaderPos, opusCommentHeaderrPos);
			opusIdentificationHeader = oggHeader.rewriteOpusPreSkip(opusIdentificationHeader, 3840);
			
			opusCommentHeader = temp.slice(opusCommentHeaderrPos, firstSoundPacketPos);
			
			console.log('[HTTP Opus(ogg)] Module initialized')
			router.get(/^\/live\.(?:ogg|opus)(?:\?|$)/, middleware);
			
			oggStream.removeListener('data', headerCatcher);
			oggStream.resume();
		}
		
		oggStream.on('data', headerCatcher)
		
		bridge.on("metadata", function (title) {
			currentTitle = title;
		});
		
		function waitForFrame(cb) {
			oggStream.once('data', function (data) {
				var pos = oggHeader.indexOfHeader(data);
				
				if (pos < 0) {
					waitForFrame(cb);
				}
				
				process.nextTick(cb.bind(null, data.slice(pos)))
			})
		}
		
		function middleware(req, res) {
			listenersCount++;
			analytics.updateListenerCount('opus live stream', listenersCount);

			res.header({
				"Accept-Ranges": "none",
				"Content-Type": "audio/ogg",
				"icy-name": config.station.name,
				"icy-url": config.station.url,
				"icy-description": config.station.description,
				"icy-pub": config.station.public ? '1' : '0',
				"icy-br": config.opus.bitrate
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
				waitForFrame(function (frameHeader) {
					injector.pipe(res);
					injector.write(opusIdentificationHeader);
					injector.write(opusCommentHeader);
					injector.write(frameHeader);
					oggStream.pipe(injector);
					injector.queue(currentTitle);
				})
			} else {
				waitForFrame(function (frameHeader) {
					res.write(opusIdentificationHeader);
					res.write(opusCommentHeader);
					res.write(frameHeader);
					oggStream.pipe(res);
				})
			}
		
			// Queue the title at the next metaint interval
			var waitforMetadata = function (title) {
				if (req.headers['icy-metadata'] == '1' && title != lastTitle) {
					injector.queue(title);
					lastTitle = title;
				}
			};
		
			// Listen on a custom metadata event
			bridge.on('metadata', waitforMetadata);
		
			res.on('close', function () {
				injector.unpipe(); // Remove the injector if attached
				oggStream.unpipe(injector); // Remove the injector from the source if present
				oggStream.unpipe(res); // Remove current connection
				oggStream.resume(); // Continue to consume input
		
				injector = null;

				bridge.removeListener('metadata', waitforMetadata); // Remove our metadata listener

				listenersCount--;
				analytics.updateListenerCount('opus live stream', listenersCount)
			});
		}
	});
};