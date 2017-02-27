const Promise = require('bluebird');
const execFile = require('child_process').execFile;
const fixPathname = require('../utils/fix_pathname');

function parse(url) {
	url = fixPathname(url);
	return new Promise(function (resolve, reject) {
		execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream_tags=title,artist:format_tags=title,artist', url], {timeout: 10000}, function(error, stdout, stderr) {
			if (error) {
				if (error.code === 1) {
					console.log('[MediaInfo] Error: Can\'t parse file ' + url);
					reject(new Error(stderr));
					return;
				} else if (error.code === 130) {
					console.log('[MediaInfo] Error: Fetch timeout ' + url);
					reject(new Error('Fetch timeout'));
					return;
				}
				resolve({});
				return;
			}

			var title,artist;
			if (stdout.match(/TAG:title=(.*)/i) && stdout.match(/TAG:artist=(.*)/i)) {
				title = stdout.match(/TAG:title=(.*)/i)[1];
				artist = stdout.match(/TAG:artist=(.*)/i)[1];
			}

			if (artist && title) {
				resolve({
					title: title,
					artist: artist
				});
			} else {
				resolve({});
			}
		});
	});
}

module.exports = parse;