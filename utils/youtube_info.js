var Promise = require('bluebird');
var ytdl = require('ytdl-core');

function parse(url) {
	return new Promise(function (resolve, reject) {
		ytdl.getInfo(url, function (err, res) {
			if (err) {
				return reject(err);
			}
			
			if (res.live_playback) {
				return reject(new Error('Bad format: is a live stream'));
			}
			
			var selected = res.formats.filter(function (i) {
				return i.bitrate == null && i.audioBitrate;
			});
			
			let opusFilter = res.formats.filter(function (i) {
				return i.audioEncoding === 'opus';
			});

			if (opusFilter.length !== 0) {
				selected = opusFilter
			}

			if (selected.length === 0) {
				return reject(new Error('This video does not have any audio only format.'));
			}
			
			selected = selected.sort(function (a, b) {
				return b.audioBitrate - a.audioBitrate;
			})[0];
			
			resolve({
				title: res.title,
				artist: res.author,
				selected: selected,
				url: selected.url
			});
		});
	});
}

module.exports = parse;
