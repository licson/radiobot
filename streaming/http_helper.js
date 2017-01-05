const http = require('http');
const icy = require('icy');
const EventEmitter = require('events');
const url = require('url');
const config = require('../config.json');

const metadata = new EventEmitter();

function writeServerSentEvent(res, eventName, data) {
	res.write(`event: ${eventName}\r\ndata: ${data}\r\n\r\n`);
}

var listenersCount = 0;
var pollingInfoConnections = [];
var serverSentEventConnections = [];
var currentTitle = '';

// return null if the polling wait too long
function waitTimeout(res, list) {
	setTimeout(function() {
		var index = list.indexOf(res);
		if (index >= 0) {
			res.end('{}');
			list.splice(index, 1);
		}
	}, 40 * 1000);
}

metadata.on("metadata", function (title) {
	console.log("[Injector] New title: %s", title);
	currentTitle = title;
	pollingInfoConnections.forEach(function (res) {
		res.end(JSON.stringify({ title: title }));
	})
	pollingInfoConnections.length = 0;
	serverSentEventConnections.forEach(function (res) {
		writeServerSentEvent(res, "title", title);
	})
});


function createHTTPHelper(distrib) {
	var server = http.createServer(function (req, res) {
		var obj = url.parse(req.url);

		if (obj.pathname == '/live.mp3' || obj.pathname == '/;' || obj.pathname == '/stream') {
			listenersCount++;
			console.log("[Server] New listener, current count: %d", listenersCount);

			// HTTP and ICY headers
			var headers = {
				"Accept-Ranges": "none",
				"Content-Type": "audio/mpeg",
				"Server": "licson-cast",
				"icy-name": config.station.name,
				"icy-url": config.station.url,
				"icy-description": config.station.description,
				"icy-pub": config.station.public ? '1' : '0',
				"icy-br": config.output.bitrate
			};

			// Timer for sending streaming title continuously
			var titleTimer = 0;
			
			// Holds last title message
			var lastTitle = null;

			// Client can handle ICY streaming titles, sending metaint
			if (req.headers['icy-metadata'] == '1') {
				console.log("[Server] Client supports ICY streaming title. Sending metaint.");
				headers['icy-metaint'] = config.icy.meta_int;
			}

			res.writeHead(200, headers);

			var injector = new icy.Writer(config.icy.meta_int);

			// Pipe through the metadata injector if client supports streaming titles
			if (req.headers['icy-metadata'] == '1') {
				console.log("[Server] Client supports ICY streaming title. Attaching to injector.");
				distrib.pipe(injector).pipe(res);
			} else {
				distrib.pipe(res);
			}

			// Queue the title at the next metaint interval
			var waitforMetadata = function (title) {
				if (req.headers['icy-metadata'] == '1' && title != lastTitle) {
					clearInterval(titleTimer);
	
					titleTimer = setInterval(function () {
						injector.queue(title);
					}, config.icy.meta_int / (config.output.bitrate / 8 * 1024) * 2000);
					
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

				clearInterval(titleTimer); // Remove timer
				metadata.removeListener('metadata', waitforMetadata); // Remove our metadata listener

				listenersCount--;
				console.log("[Server] Listener leave, current count: %d", listenersCount);
			});
		} else if (obj.pathname == '/') {
			// Do a redirect to the main page
			res.writeHead(302, {
				"Content-Type": "text/html",
				"Server": "licson-cast",
				"Location": config.station.url
			});

			res.end(`Your browser should redirect you shortly. If not, please click <a href="${config.station.url}">here</a>.`);
		} else if (obj.pathname == '/status') {
			res.writeHead(200, {
				"Content-Type": "text/plain",
				"Server": "licson-cast"
			});
			
			res.end(`active_conn=${listenersCount}
rss=${process.memoryUsage().rss}
uptime=${process.uptime()}`);
		} else if (obj.pathname == '/info') {
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
				"Server": "licson-cast"
			});
			
			res.end(JSON.stringify({
				"station-name": config.station.name,
				"url": config.station.url,
				"description": config.station.description,
				"bitrate": config.output.bitrate,
				"title": currentTitle
			}));
		} else if (obj.pathname == '/title/poll') {
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
				"Cache-Control": "no-cache",
				"Server": "licson-cast"
			});
			
			req.on('close', function () {
				var index = pollingInfoConnections.indexOf(res);
				if (index >= 0) {
					pollingInfoConnections.splice(index, 1)
				}
			})
			
			pollingInfoConnections.push(res);
			waitTimeout(res, pollingInfoConnections);
			
		} else if (obj.pathname == '/title/sse') {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Access-Control-Allow-Origin": "*",
				"Cache-Control": "no-cache",
				"Server": "licson-cast"
			});
			
			req.on('close', function () {
				var index = serverSentEventConnections.indexOf(res);
				if (index >= 0) {
					serverSentEventConnections.splice(index, 1)
				}
			})
			
			serverSentEventConnections.push(res);
			
			res.write("retry: 1000\r\n\r\n");
			
			writeServerSentEvent(res, "info", JSON.stringify({
				"station-name": config.station.name,
				"url": config.station.url,
				"description": config.station.description,
				"bitrate": config.output.bitrate
			}));
			writeServerSentEvent(res, "title", currentTitle);
		} else {
			// We don't recognize the URL
			res.writeHead(204, {
				"Server": "licson-cast"
			});
			res.end();
		}
	});

	server.listen(config.ports.http, function () {
		console.log("[Server] Listening on %d waiting for listeners.", config.ports.http);
	});
	return metadata;
};

module.exports = createHTTPHelper;