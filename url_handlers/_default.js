const Promise = require('bluebird');
const MediaInfo = require('../utils/media_info');

module.exports = {
	shouldHandle: function (url) {
		return true;
	},
	getInfo: function (url) {
		return MediaInfo(url);
	},
	getStreamURL: function (url) {
		return Promise.resolve(url);
	}
};