const getYouTubeID = require('get-youtube-id');
const YoutubeInfo = require('../utils/youtube_info');

module.exports = {
	shouldHandle: function (url) {
		return getYouTubeID(url, { fuzzy: false }) != null;
	},
	getInfo: function (url) {
		return YoutubeInfo(url);
	},
	getStreamURL: function (url) {
		return YoutubeInfo(url).then(function (res) {
			return res.url;
		});
	}
};