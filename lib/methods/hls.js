module.exports = function (bridge) {
	bridge.allOnce([
		'mixer', 
		'get_router', 
		'config', 
		'configureCORS',
		'analytics'
	], function (distrib, getRouter, config, configureCORS, analytics) {
		if (!config.hls.enabled) return;

		const spawn = require('child_process').spawn;
		const Promise = require('bluebird');
		const mkdirp = require('mkdirp');
		const path = require('path');
		const os = require('os');
		const fs = require('fs');
		const cookie = require('cookie');
		
		const cookieName = 'hls.user';
		const listenerTimeout = 30000;
		const listenerPurgeInterval = 10000;
		const listeners = new Map();
		
		setInterval(function () {
			var leaved = false;
			
			listeners.forEach(function (val, key) {
				if (Date.now() - val > listenerTimeout) {
					listeners.delete(key);
					leaved = true;
				}
			});
			
			if (leaved) {
				analytics.updateListenerCount('hls', listeners.size);
			}
		}, listenerPurgeInterval);
		
		function addListener(id) {
			if (!listeners.get(id)) {
				listeners.set(id, Date.now());
				analytics.updateListenerCount('hls', listeners.size);
			} else {
				listeners.set(id, Date.now());
			}
		}
		
		var router = getRouter();
		var tmpdir = path.join(os.tmpdir(), 'radiobot_hls');
		
		function trackUserMiddleware(req, res, next) {
			const cookies = cookie.parse(req.headers.cookie || '');
			var userId;
			
			if (cookies[cookieName]) {
				userId = cookies[cookieName];
				addListener(userId);
				// console.log(`[HLS] user ${userId} comes back for ${req.path}`);
			} else {
				userId = Math.random().toString(16).slice(2, 10);
				// console.log(`[HLS] new user ${userId} cames for ${req.path}`);
				// console.log(`[HLS] user agent is ${req.headers['user-agent']}`);
			}
			
			res.header('Set-Cookie',  cookie.serialize(cookieName, userId, {
				path: '/',
				httpOnly: true,
				maxAge: 60 * 60 * 24 * 7 // 1 week 
			}));
			
			next();
		}
		
		function doSegmentation(stream) {
			return new Promise(function (resolve, reject) {
				mkdirp(tmpdir, function (e) {
					if (e) {
						reject(e);
					} else {
						resolve();
					}
				});
			}).then(function () {
				var segmenter = spawn('ffmpeg', [
					'-f', 's16le',
					'-ac', config.output.channels,
					'-ar', config.output.samplerate,
					'-i', '-',
					// '-c:a', 'copy',
					'-map', '0:0',
					'-f', 'hls',
					'-hls_flags', 'delete_segments',
					'-hls_time', config.hls.segment_length,
					'-hls_list_size', config.hls.segment_list_length,
					'-hls_wrap', 100,
					'-start_number', 1,
					'-hls_segment_filename', 'seg_%03d.mp3',
					'live.m3u8'
				], {
					cwd: tmpdir
				});

				stream.pipe(segmenter.stdin, { end: false });
				segmenter.stdout.resume();
				segmenter.stderr.resume();

				segmenter.on('exit', function (code) {
					// TODO: Respawn process
				});
			});
		}

		doSegmentation(distrib).catch(function () {
			console.error('[HLS Segmenter] Failed creating directory for HLS segments.');
		});

		router.get('/live.m3u8', configureCORS, trackUserMiddleware, function (req, res) { 
			res.header({
				'Content-Type': 'application/vnd.apple.mpegurl',
				'Cache-Control': 'no-cache'
			});

			res.sendFile('live.m3u8', { root: tmpdir });
		});

		router.get(/\/seg_(\d+)\.mp3/, configureCORS, trackUserMiddleware, function (req, res) {
			res.header({
				'Cache-Control': 'no-cache',
				'Content-Type': 'audio/mpeg'
			});

			var segPath = path.join(tmpdir, 'seg_' + req.params[0] + '.mp3');
			var stream = fs.createReadStream(segPath);
			stream.pipe(res);
		});
	});
};