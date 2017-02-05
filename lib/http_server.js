module.exports = function (bridge) {
bridge.allOnce(['config'], 
function (config) {
// --------------

const path = require("path");
const http = require("http");
const express = require("express");
const socketio = require('socket.io');
const Router = express.Router;

// Initialize express and socket.io
const router = express();
const server = http.createServer(router);
const io = (function () {
	function normalizeHosts(hosts) {
		hosts = hosts.slice(0);
		
		for (var i = hosts.length - 1; i >= 0; i--) {
			if (!hosts[i].match(/^https?:\/\//)) {
				hosts.splice(i, 1, "http://" + hosts[i], "https://" + hosts[i]);
			}
		}
		
		for (var i = hosts.length - 1; i >= 0; i--) {
			if (hosts[i].match(/:(\d+|\*)$/)) {
				continue;
			} else if (hosts[i].match(/^https/)) {
				hosts[i] += ':443';
			} else {
				hosts[i] += ':80';
			}
		}
		return hosts;
	}
	
	if (!config.http.allowCrossOrigin) {
		var host = normalizeHosts([config.http.host]).join(" ");
		return socketio.listen(server, { origins: host });
	} else if (config.http.allowCrossOrigin && config.http.originWhiteList.length === 0) {
		return socketio.listen(server);
	} else {
		var origins = normalizeHosts([config.http.host].concat(config.http.originWhiteList)).join(" ");
		return socketio.listen(server, { origins: origins });
	}
} ());
const container = new Router;

router.set('x-powered-by', false);

router.use(function (req, res, next) {
	res.header("Server", "licson-cast");
	next();
});

router.get('/', function (req, res, next) {
	if (config.station.url) {
		// Do a redirect to the main page
		return res.redirect(config.station.url)
	}
	next();
});

router.use(container)

router.use(express.static(path.resolve(__dirname, './public')));

bridge.emitSticky('socket.io', io);

bridge.emitSticky('get_router', function () {
	var layer = new Router;
	container.use(layer);
	return layer;
});

bridge.once('config', function (config) {
	server.setTimeout(0);
	server.listen(config.ports.http, function () {
		console.log("[Server] Listening on %d waiting for listeners.", config.ports.http);
	});
});

// --------------
});
};