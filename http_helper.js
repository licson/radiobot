const http = require('http');
const icy = require('icy');
const EventEmitter = require('events');
const url = require('url');
const config = require('./config.json');

const metadata = new EventEmitter();
var listenersCount = 0;

metadata.on("metadata", function (title) {
	console.log("[Injector] New title: %s", title);
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
				if (req.headers['icy-metadata'] == '1') {
					clearInterval(titleTimer);
	
					titleTimer = setInterval(function () {
						injector.queue(title);
					}, config.icy.meta_int / (config.output.bitrate / 8 * 1024) * 2000);
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