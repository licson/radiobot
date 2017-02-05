module.exports = function (bridge) {
bridge.allOnce(['get_router' ,'mp3_stream', 'mixer', 'queue', 'config', 'socket.io'], function (getRouter, mp3Stream, mixer, queue, config, io) {
// --------------

console.log('[HTML5 Player] initing');

const url = require("url");
const router = getRouter();
const icy = require('icy');
const express = require("express");
const path = require("path");

var listenersCount = 0;
var pollingInfoConnections = [];
var serverSentEventConnections = [];
var currentTitle = '';

function queueToObject(queue) {
	return {
		current: queue.currentTask ? queue.currentTask.info : null,
		nexts: queue.getAllTasks().map(function (task) {
			return task.info;
		})
	};
}

// Server-sent events logic
function writeServerSentEvent(res, eventName, data) {
	res.write(`event: ${eventName}\r\ndata: ${data.replace(/\r?\n/g, '\r\ndata: ')}\r\n\r\n`);
}

// Long polling logic
function waitTimeout(res, list) {
	setTimeout(function() {
		var index = list.indexOf(res);
		if (index >= 0) {
			res.jsonp({change: false, title: currentTitle});
			list.splice(index, 1);
		}
	}, 40 * 1000);
}

function configureCORS(req, res, next) {
	if (config.http.allowCrossOrigin) {
		if (config.http.originWhiteList.length === 0) {
			res.header({
				"Access-Control-Allow-Origin": "*"
			});
		} else {
			var ref = req.get("Origin");
			var parsedRef = url.parse("ref");
			if (config.http.originWhiteList.indexOf(ref) >= 0) {
				res.header({
					"Access-Control-Allow-Origin": ref
				});
			}
		}
	}
	next();
}

queue.on('push', function () {
	serverSentEventConnections.forEach(function (res) {
		writeServerSentEvent(res, "songList", JSON.stringify(queueToObject(queue)));
	});
});

queue.on('next', function () {
	serverSentEventConnections.forEach(function (res) {
		writeServerSentEvent(res, "songList", JSON.stringify(queueToObject(queue)));
	});
});

bridge.on("metadata", function (title) {
	console.log("[Injector] New title: %s", title);
	currentTitle = title;
	
	pollingInfoConnections.forEach(function (res) {
		res.jsonp({ change: true, title: title });
	});
	pollingInfoConnections.length = 0;
	
	serverSentEventConnections.forEach(function (res) {
		writeServerSentEvent(res, "title", title);
	});
});

router.get(/^(?:\/live.mp3|\/stream|\/;)(?:\?|$)/, function (req, res) {
	listenersCount++;
	console.log("[Server] New listener, current count: %d", listenersCount);

	// HTTP and ICY headers
	res.header({
		"Accept-Ranges": "none",
		"Content-Type": "audio/mpeg",
		"icy-name": config.station.name,
		"icy-url": config.station.url,
		"icy-description": config.station.description,
		"icy-pub": config.station.public ? '1' : '0',
		"icy-br": config.output.bitrate
	});
	
	// Holds last title message
	var lastTitle = null;

	// Client can handle ICY streaming titles, sending metaint
	if (req.headers['icy-metadata'] == '1') {
		console.log("[Server] Client supports ICY streaming title. Sending metaint.");
		res.header("icy-metaint", config.icy.meta_int);
	}
	res.write('');

	var injector = new icy.Writer(config.icy.meta_int);

	// Pipe through the metadata injector if client supports streaming titles
	if (req.headers['icy-metadata'] == '1') {
		console.log("[Server] Client supports ICY streaming title. Attaching to injector.");
		mp3Stream.pipe(injector).pipe(res);
		injector.queue(currentTitle);
	} else {
		mp3Stream.pipe(res);
	}

	// Queue the title at the next metaint interval
	var waitforMetadata = function (title) {
		if (req.headers['icy-metadata'] == '1' && title != lastTitle) {
			injector.queue(title);
			lastTitle = title;
		}
	};

	// Listen on a custom metadata event
	mp3Stream.on('metadata', waitforMetadata);

	res.on('close', function () {
		injector.unpipe(); // Remove the injector if attached
		mp3Stream.unpipe(injector); // Remove the injector from the source if present
		mp3Stream.unpipe(res); // Remove current connection
		mp3Stream.resume(); // Continue to consume input

		injector = null;

		mp3Stream.removeListener('metadata', waitforMetadata); // Remove our metadata listener

		listenersCount--;
		console.log("[Server] Listener leave, current count: %d", listenersCount);
	});
});

router.get('/status', configureCORS, function (req, res, next) {
	res.header({
		"Content-Type": "text/plain",
	});
	
	res.end(`active_conn=${listenersCount}
rss=${process.memoryUsage().rss}
uptime=${process.uptime()}`);
});

router.get('/info', configureCORS, function (req, res, next) {
	res.jsonp({
		"station-name": config.station.name,
		"url": config.station.url,
		"description": config.station.description,
		"bitrate": config.output.bitrate,
		"title": currentTitle
	});
});

router.get('/title/poll', configureCORS, function (req, res) {
	res.header({
		"Cache-Control": "no-cache"
	});
	
	req.on('close', function () {
		var index = pollingInfoConnections.indexOf(res);
		if (index >= 0) {
			pollingInfoConnections.splice(index, 1);
		}
	});
	
	pollingInfoConnections.push(res);
	waitTimeout(res, pollingInfoConnections);
});

router.get('/title/sse', configureCORS, function (req, res) {
	res.header({
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache"
	});
	res.write('');
	
	req.on('close', function () {
		var index = serverSentEventConnections.indexOf(res);
		if (index >= 0) {
			serverSentEventConnections.splice(index, 1);
		}
	});
	
	serverSentEventConnections.push(res);
	
	res.write("retry: 1000\r\n\r\n");
	
	writeServerSentEvent(res, "info", JSON.stringify({
		"station-name": config.station.name,
		"url": config.station.url,
		"description": config.station.description,
		"bitrate": config.output.bitrate
	}));
	
	writeServerSentEvent(res, "title", currentTitle);
	writeServerSentEvent(res, "songList", JSON.stringify(queueToObject(queue)));
});

router.use(express.static(path.resolve(__dirname, './public')));

router.get(function (req, res) {
	res.writeHead(404, {
		"Server": "licson-cast"
	});
	res.end();
});


// ------------
})
}