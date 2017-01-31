var Promise = require('bluebird');
var ytdl = require('ytdl-core');

function parse(url) {
	return new Promise(function (resolve, reject) {
		ytdl.getInfo(url, function (err, res) {
			if (err) {
				return reject(err);
			}
			
			var selected = res.formats.filter(function (i) {
				return i.bitrate == null && i.audioBitrate;
			});
			
			if (selected.length === 0) {
				return reject(new Error("This video does not have any audio only format."));
			}
			
			selected = selected.sort(function (a, b) {
				return a.audioBitrate >= b.audioBitrate ? 1 : -1;
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