const Promise = require('bluebird');
const url = require('url');
const Parser = require('musicmetadata');
const request = require('request');
const fixPathname = require("../utils/fix_pathname");
const MAX_SIZE = 100 * 1000 * 1000;

const streamWhiteList = [
	"ak.cdn.licson.net"
];

function isStreamWhiteListed (str) {
	var parsed = url.parse(str);
	return streamWhiteList.indexOf(parsed.hostname) >= 0;
}

function arrayToString(arr) {
	if (Array.isArray(arr)) return arr.join(', ');
	return arr;
}

function parse(url) {
	url = fixPathname(url);
	return new Promise(function (resolve, reject) {
		var urlStream = request(url);
		var all = 0
		
		urlStream.on('error', function() {
			resolve({});
		});
		
		urlStream.on('response', function(response) {
			if (response.statusCode !== 200) {
				urlStream.abort();
				return reject(new Error(`unexpect status code ${response.statusCode}`));
			}
			
			if (
				!response.headers['content-type'] ||
				(!response.headers['content-type'].match(/(^audio)|(flac$)/) && response.headers['content-type'] != 'application/octet-stream')
			) {
				urlStream.abort();
				return reject(new Error(`unexpected content-type: ${response.headers['content-type']}`));
			}
			
			if (!response.headers['content-length'] && !isStreamWhiteListed(url)) {
				urlStream.abort();
				return reject(new Error("streaming source is not supported"));
			}
			
			if (parseInt(response.headers['content-length'], 10) > MAX_SIZE) {
				urlStream.abort();
				return resolve({});
			}
		});
		
		urlStream.on('data', function (data) {
			all += data.length;
			if (all > MAX_SIZE) {
				urlStream.abort();
				resolve({});
			}
		});
		
		Parser(urlStream, function (e, metadata) {
			urlStream.resume();
			urlStream.abort();
			
			if (e) {
				if (e.message === "Could not find metadata header") {
					resolve({});
				} else {
					reject(e);
				}
			} else if (metadata.artist && metadata.title) {
				resolve({
					title: arrayToString(metadata.title),
					artist: arrayToString(metadata.artist)
				});
			} else {
				resolve({});
			}
		});
	});
};

module.exports = parse;