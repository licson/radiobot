module.exports = function (bridge) {
	bridge.allOnce(['mp3_stream', 'get_router', 'config', 'configureCORS'], function (distrib, getRouter, config, configureCORS) {
		if (!config.hls.enabled) return;
		
		const spawn = require('child_process').spawn;
		const Promise = require('bluebird');
		const mkdirp = require('mkdirp');
		const path = require('path');
		const os = require('os');
		
		var router = getRouter();
		var tmpdir = path.join(os.tmpdir(), 'radiobot_hls');
		
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
					'-re', '-i', '-',
					'-c:a', 'copy',
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
		
		router.get('/live.m3u8', configureCORS, function (req, res) {
			res.header({
				"Content-Type": "application/vnd.apple.mpegurl",
				"Cache-Control": "no-cache"
			});
			
			res.sendFile('live.m3u8', { root: tmpdir });
		});
		
		router.get(/\/seg_(\d+)\.mp3/, function (req, res) {
			res.header({
				"Cache-Control": "no-cache"
			});
			
			res.sendFile(path.join(tmpdir, 'seg_' + req.params[0] + '.mp3'));
		});
	});
};