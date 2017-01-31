const http = require("http");
const express = require("express");
const socketio = require('socket.io');
const icy = require('icy');
const EventEmitter = require('events');
const path = require("path")
const stream = require("stream");
const url = require("url");
const config = require("../config");

// Initialize express and socket.io
const router = express();
const metadata = new EventEmitter();
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

var distrib = null;
var mixer = null;
var queue = null;

var ioUsers = 0;
var microUsers = 0;

var listenersCount = 0;
var pollingInfoConnections = [];
var serverSentEventConnections = [];
var currentTitle = '';

function queueToObject(queue) {
	return {
		current: queue.currentTask.info,
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

metadata.on('queue_ready', function (queue_) {
	queue = queue_;
	
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
});

metadata.on("metadata", function (title) {
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

router.set('x-powered-by', false);

router.use(function (req, res, next) {
	res.header("Server", "licson-cast");
	next();
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
		distrib.pipe(injector).pipe(res);
		injector.queue(currentTitle);
	} else {
		distrib.pipe(res);
	}

	// Queue the title at the next metaint interval
	var waitforMetadata = function (title) {
		if (req.headers['icy-metadata'] == '1' && title != lastTitle) {
			injector.queue(title);
			lastTitle = title;
		}
	};

	// Listen on a custom metadata event
	metadata.on('metadata', waitforMetadata);

	res.on('close', function () {
		injector.unpipe(); // Remove the injector if attached
		distrib.unpipe(injector); // Remove the injector from the source if present
		distrib.unpipe(res); // Remove current connection
		distrib.resume(); // Continue to consume input

		injector = null;

		metadata.removeListener('metadata', waitforMetadata); // Remove our metadata listener

		listenersCount--;
		console.log("[Server] Listener leave, current count: %d", listenersCount);
	});
});

router.get('/', function (req, res, next) {
	if (config.station.url) {
		// Do a redirect to the main page
		return res.redirect(config.station.url)
	}
	next();
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

io.on('connection', function (socket) {
	var source = null;
	ioUsers++;
	
	console.log(`[Socket.io] A user connected, total ${ioUsers} users online, ${microUsers} microphones taken`);
	
	// init the microphone
	socket.emit('info', {
		sampleRate: mixer.sampleRate,
		channel: mixer.channel
	})
	
	socket.on('microphone_take', function () {
		if (source) return;
		
		microUsers++;
		
		console.log(`[Socket.io] A microphone taken, total ${ioUsers} users online, ${microUsers} microphones taken`);
		
		source = new stream.PassThrough();
		mixer.addSource(source, ['microphone']);
		socket.emit('microphone_ready');
	});
	
	socket.on('PCM', function (pcm_s16le, id) {
		if (!source) return;
		if (!pcm_s16le instanceof Buffer) return console.log(pcm_s16le);
	
		source.write(pcm_s16le);
		socket.emit('ACK', id);
	});
	
	socket.on('microphone_drop', function () {
		if (!source) return;
		
		microUsers--;
		
		console.log(`[Socket.io] A microphone dropped, total ${ioUsers} users online, ${microUsers} microphones taken`);
		
		source.end()
		source = null;
		socket.emit('microphone_dropped');
	});
	
	socket.on('disconnect', function () {
		ioUsers--;
		
		if (source) {
			microUsers--;
		}
		
		console.log(`[Socket.io] A user leaved, total ${ioUsers} users online, ${microUsers} microphones taken`);
		
		if (source) {
			source.end()
			socket = null;
		}
	});
});

var __called = false;
module.exports = function (helpers) {
	if (__called) return;
	__called = true;
	helpers = helpers;
	distrib = helpers.mp3Stream;
	mixer = helpers.mixer;
	server.setTimeout(0);
	server.listen(config.ports.http, function () {
		console.log("[Server] Listening on %d waiting for listeners.", config.ports.http);
	});
	
	return metadata;
};