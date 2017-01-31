const Promise = require('bluebird');
const request = require("request");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; WOW64; rv:50.0) Gecko/20100101 Firefox/50.0";

function getBasicData(url) {
	return new Promise(function (resolve, reject) {
		request.get(url, {
			headers: { 'User-Agent': USER_AGENT }
		}, function (err, res, txt) {
			if (err || res.statusCode !== 200) {
				return reject(err || new Error("unexpect status code " + res.statusCode));
			}
	
			var id = /soundcloud:\/\/sounds:(\d+)/.exec(txt);
			if (id) id = id[1];
			
			var appPath = txt.match(/assets\/app-[0-9a-f\-]+\.js/)[0];
			
			var appVersion = /window\.__sc_version = "(\d+)"/.exec(txt);
			if (appVersion) appVersion = appVersion[1];
	
			if (!id || !appPath || !appVersion) {
				return reject(new Error("unable to extract track info"));
			}
	
			request.get('https://a-v2.sndcdn.com/' + appPath, {
				headers: { 'User-Agent': USER_AGENT }
			}, function (err, res, txt) {
				if (err || res.statusCode !== 200) {
					return reject(err || new Error("unexpect status code " + res.statusCode));
				}
	
				var clientId = /,client_id:"([a-zA-Z0-9]+)",/.exec(txt)
				if (clientId) clientId = clientId[1];
				
				if (!clientId) {
					return reject(new Error("clientId not found"));
				}
				
				resolve({
					id: id,
					appVersion: appVersion,
					clientId: clientId
				});
			})
		})
	})
}

module.exports = {
	shouldHandle: function (url) {
		return /^https?:\/\/soundcloud.com\/[0-9a-zA-Z\-]+\/[0-9a-zA-Z\-]+$/.test(url);
	},
	getInfo: function (url) {
		return getBasicData(url).then(function (info) {
			return new Promise(function (resolve, reject) {
				request.get('http://api.soundcloud.com/tracks/' + info.id + '?client_id=' + info.clientId, {
					headers: { 'User-Agent': USER_AGENT }
				}, function (err, res, txt) {
					if (err || res.statusCode !== 200) {
						return reject(err || new Error("unexpect status code " + res.statusCode));
					}

					try {
						var obj = JSON.parse(txt);
					} catch (err) {
						return reject(err);
					}

					resolve({
						artist: obj.user.full_name || obj.user.username,
						title: obj.title
					});
				});
			});
		});
	},
	getStreamURL: function (url) {
		return getBasicData(url).then(function (info) {
			return new Promise(function (resolve, reject) {
				request.get('https://api.soundcloud.com/i1/tracks/' + info.id + '/streams?client_id=' + info.clientId + '&app_version=' + info.appVersion, {
					headers: { 'User-Agent': USER_AGENT }
				}, function (err, res, txt) {
					if (err || res.statusCode !== 200) {
						return reject(err || new Error("unexpect status code " + res.statusCode));
					}

					try {
						var obj = JSON.parse(txt);
					} catch (err) {
						return reject(err);
					}

					resolve(obj.http_mp3_128_url);
				});
			});
		});
	}
};