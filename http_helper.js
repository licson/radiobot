const http = require('http');
const icy = require('icy');
const config = require('./config.json');

function createHTTPHelper(distrib) {
	var server = http.createServer(function (req, res) {
		if (req.url == '/live.mp3') {
			res.writeHead(200, {
				"Accept-Ranges": "none",
				"Content-Type": "audio/mpeg",
				"Server": "licson-cast",
				"icy-name": config.station.name,
				"icy-url": config.station.url,
				"icy-metaint": config.icy.meta_int
			});

			var injector = new icy.Writer(config.icy.meta_int);
			injector.meta_int = config.icy.meta_int;
			
			distrib.pipe(injector).pipe(res);
			
			server.on('metadata', function (title) {
				injector.queue(title);
			});
			
			res.on('close', function () {
				injector.unpipe();
				distrib.unpipe(injector);
				distrib.resume();
			});
		} else if (req.url == '/') {
			res.writeHead(302, {
				"Content-Type": "text/html",
				"Server": "licson-cast",
				"Location": config.station.url
			});

			res.end(`Your browser should redirect you shortly. If not, please click <a href="${config.station.url}">here</a>.`);
		} else {
			res.writeHead(204, {});
			res.end();
		}
	});

	server.listen(config.ports.http);
	return server;
};

module.exports = createHTTPHelper;