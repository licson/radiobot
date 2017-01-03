var Promise = require('bluebird');
var Parser = require('music-metadata');
var request = require('request');

function parse(url) {
	return new Promise(function (resolve, reject) {
		var urlStream = request(url);
		Parser.parseStream(urlStream, {
			native: true,
			duration: false
		}, function (e, metadata) {
			urlStream.resume(); // Allow the stream to flow until EOF (as node.js read streams cannot be stopped)
			if (e) {
				reject(e);
			} else if (metadata.common.title && metadata.common.artist) {
				resolve({
					title: metadata.common.title,
					artist: metadata.common.artist
				});
			} else {
				resolve({});
			}
		});
	});
};

module.exports = parse;