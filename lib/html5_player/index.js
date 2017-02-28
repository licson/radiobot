module.exports = function (bridge) {
	bridge.allOnce(['get_router' ,'mp3_stream', 'queue', 'config', 'configureCORS'], function (getRouter, mp3Stream, queue, config, configureCORS) {
		const router = getRouter();
		const express = require('express');
		const albumArt = require('album-art');
		const path = require('path');
		
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
		
		function keepSSEAlive(res) {
			res.sseKeepAliveTimer = setInterval(function () {
				res.write(': ' + Date.now() + '\r\n\r\n');
			}, 30000);
		}
		
		// Long polling logic
		function waitTimeout(res, list) {
			setTimeout(function() {
				var index = list.indexOf(res);
				
				if (index >= 0) {
					res.jsonp({ change: false, title: currentTitle });
					list.splice(index, 1);
				}
			}, 40000);
		}
		
		queue.on('push', function () {
			serverSentEventConnections.forEach(function (res) {
				writeServerSentEvent(res, 'songList', JSON.stringify(queueToObject(queue)));
			});
		});
		
		queue.on('next', function () {
			serverSentEventConnections.forEach(function (res) {
				writeServerSentEvent(res, 'songList', JSON.stringify(queueToObject(queue)));
			});
		});
		
		bridge.on('metadata', function (title) {
			console.log('[Injector] New title: %s', title);
			currentTitle = title;
			
			pollingInfoConnections.forEach(function (res) {
				res.jsonp({ change: true, title: title });
			});
			pollingInfoConnections.length = 0;
			
			serverSentEventConnections.forEach(function (res) {
				writeServerSentEvent(res, 'title', title);
			});
		});
		
		bridge.on('listeners', function (count) {
			listenersCount = count;
		});
		
		router.get('/status', configureCORS, function (req, res, next) {
			res.header({
				'Content-Type': 'text/plain',
			});
			
			res.end(`active_conn=${listenersCount}
rss=${process.memoryUsage().rss}
uptime=${process.uptime()}`);
		});
		
		router.get('/info', configureCORS, function (req, res, next) {
			res.jsonp({
				'station-name': config.station.name,
				'url': config.station.url,
				'description': config.station.description,
				'bitrate': config.output.bitrate,
				'title': currentTitle
			});
		});
		
		router.get('/title/poll', configureCORS, function (req, res) {
			res.header({
				'Cache-Control': 'no-cache'
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
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache'
			});
			res.write('');
			
			req.on('close', function () {
				var index = serverSentEventConnections.indexOf(res);
				
				clearInterval(res.sseKeepAliveTimer);
				
				if (index >= 0) {
					serverSentEventConnections.splice(index, 1);
				}
			});
			
			serverSentEventConnections.push(res);
			
			res.write('retry: 1000\r\n\r\n');
			
			writeServerSentEvent(res, 'info', JSON.stringify({
				'station-name': config.station.name,
				'url': config.station.url,
				'description': config.station.description,
				'bitrate': config.output.bitrate
			}));
			
			writeServerSentEvent(res, 'title', currentTitle);
			writeServerSentEvent(res, 'songList', JSON.stringify(queueToObject(queue)));
			keepSSEAlive(res);
		});
		
		router.get('/title/cover', function (req, res) {
			if (queue.currentTask != null) {
				var info = queue.currentTask.info.title.split('-');
				albumArt(info[1] || "", function (e, url) {
					if (e) {
						res.redirect('/components/default-artwork.png');
					} else {
						res.redirect(url);
					}
				});
			} else {
				res.redirect('/components/default-artwork.png');
			}
		});
		
		router.use(express.static(path.resolve(__dirname, './public')));
		
		router.get(function (req, res) {
			res.writeHead(404, {
				'Server': 'licson-cast'
			});
			res.end();
		});
	});
};