const http = require('http');
const icy = require('icy');
const config = require('./config.json');

function createHTTPHelper(distrib) {
	var server = http.createServer(function (req, res) {
		if (req.url == '/live.mp3') {
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
			
			// Client can handle ICY streaming titles, sending metaint
			if (req.headers['icy-metadata'] == '1') {
				headers['icy-metaint'] = config.icy.meta_int;
			}
			
			res.writeHead(200, headers);

			var injector = new icy.Writer(config.icy.meta_int);
			
			// Pipe through the metadata injector if client supports streaming titles
			if (req.headers['icy-metadata'] == '1') {
				distrib.pipe(injector).pipe(res);
			} else {
				distrib.pipe(res);
			}
			
			// Queue the title at the next metaint interval
			var waitforMetadata = function (title) {
				injector.queue(title); 
			};
			
			// Listen on a custom metadata event
			server.on('metadata', waitforMetadata);
			
			res.on('close', function () {
				injector.unpipe(); // Remove the injector if attached
				distrib.unpipe(injector); // Remove the injector from the source if present
				distrib.unpipe(res); // Remove current connection
				distrib.resume(); // Continue to consume input
				server.removeListener('metadata', waitforMetadata); // Remove our metadata listener
			});
		} else if (req.url == '/') {
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

	server.listen(config.ports.http);
	return server;
};

module.exports = createHTTPHelper;