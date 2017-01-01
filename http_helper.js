const http = require('http');
const net = require('net');
const icy = require('icy');
const Passthrough = require('stream').PassThrough;
const config = require('./config.json');

function createHTTPHelper(distrib) {
	var injector = new icy.Writer(config.icy.meta_int);
	injector.meta_int = config.icy.meta_int;

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

			net.connect(5001).pipe(injector).pipe(res);
		} else if (req.url == '/') {
			res.writeHead(302, {
				"Content-Type": "text/html",
				"Server": "licson-cast",
				"Location": config.station.url
			});

			res.end(`Your browser should redirect you shortly. If not, please click <a href="${config.station.url}">here</a>.`);
		} else {
			res.end();
		}
	});

	server.listen(config.ports.http);
	return injector;
};

module.exports = createHTTPHelper;