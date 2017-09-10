module.exports = function (bridge) {
	bridge.allOnce(['queue', 'config', 'get_router', 'doQueueSong', 'addToSongList'], function (queue, config, getRouter, doQueueSong, addToSongList) {
		const path = require('path');
		const os = require('os');
		const fs = require('fs');
		const crypto = require('crypto');
		const mkdirp = require('mkdirp');
		const mediaInfo = require('../utils/media_info');
		const ChatSource = require('../utils/chat_source');
		
		const router = getRouter();
		const tmpdir = path.join(os.tmpdir(), 'http_api');
		
		queue.on('remove', function (factory, info, error) {
			// delete the file when it is removed from the queue
			if (info.uid.match(/^file:/)) {
				// in case it is removed due to the same song is added
				process.nextTick(function () {
					if (queue.findTask(info).length === 0) {
						console.log(`[HTTP API] Prurging file: ${info.uid.replace(/^file:/, '')}`);
						fs.unlink(info.uid.replace(/^file:/, ''), function(err) {
							if (err) {
								console.error(`[HTTP API] Error during delete file: ${err.stack}`);
							}
						})
					}
				})
			}
		})
		
		function makeTemp() {
			return new Promise(function (resolve, reject) {
				mkdirp(tmpdir, function (e) {
					if (e) {
						reject(e);
					} else {
						resolve();
					}
				});
			})
			.then(function () {
				return new Promise(function (resolve, reject) {
					fs.readdir(tmpdir, function (err, res) {
						if (err) {
							reject(err);
						} else {
							resolve(res);
						}
					});
				});
			})
			.then(function (files) {
				return Promise.all(
					files.filter(function (file) {
						return !!file.match(/\.part$/);
					})
					.map(function (file) {
						return new Promise(function (resolve, reject) {
							fs.unlink(path.resolve(tmpdir, file), function (err) {
								if (err) {
									reject(err);
								}
								resolve();
							});
						});
					})
				);
			});
		}
		
		function rawBodyStream(req, res, next) {
			if (!req.get('content-length') || !req.get('content-length').match(/^[1-9]\d*$/)) {
				return res.status(400).json({
					error: `unknown length: ${req.headers['content-length']}`
				});
			}
			
			const length = parseInt(req.get('content-length'), 10);
			
			console.log(`[HTTP API] ${req.ip} wish to upload a file with length ${length}`);
			
			var receivedLength = 0;
			var tempfileName = Math.random().toString(36).slice(2) + '.part';
			var tempFilePath = path.resolve(tmpdir, tempfileName);
			var writable = fs.createWriteStream(tempFilePath);
			
			req.pipe(writable);
			
			// var i = 0;
			
			req.on('data', function (data) {
				receivedLength += data.length;
				
				// if (receivedLength / 100 / 1000 > i) {
				// 	i++
				// 	console.log(`[HTTP API] ${req.ip} current ${receivedLength} / ${length}`)
				// }
				if (receivedLength > length) {
					req.destroy(new Error('body is too long'));
				}
			});
			
			req.on('close', function () {
				fs.unlink(tempFilePath, function (err) {
					if (err) {
						console.error(`[HTTP API] Error during delete temp file: ${err.stack}`);
					}
				});
			});
			
			req.on('error', function(err) {
				fs.unlink(tempFilePath, function (err) {
					if (err) {
						console.error(`[HTTP API] Error during delete temp file: ${err.stack}`);
					}
				});
				
				if (!res.headersSent) {
					res.status(500).json({
						error: err.message
					});
				}
			});
			
			req.on('end', function() {
				if (receivedLength < length) {
					fs.unlink(tempFilePath, function (err) {
						if (err) {
							console.error(`[HTTP API] Error during delete temp file: ${err.stack}`);
						}
					});
					
					if (!res.headersSent) {
						res.status(400).json({
							error: `trucated body, expect to get length ${length} but actully got ${receivedLength}`
						});
					}
					return;
				}
				
				const hash = crypto.createHash('sha256');
				fs.createReadStream(tempFilePath).pipe(hash);
				
				hash.on('readable', function () {
					const data = hash.read();
					if (data) {
						const hex = data.toString('hex');
						const targetPath = path.resolve(tmpdir, hex);
						
						console.log(`[HTTP API] ${req.ip} done uploading a file {${hex}}`);
						
						fs.stat(targetPath, function (err, stat) {
							req.filepath = targetPath;
							req.filehash = hex;
							
							if (err || !stat) {
								// file does not exist
								return fs.rename(tempFilePath, targetPath, function (err) {
									if (err) {
										return res.status(400).json({
											error: `error upload file: ${err.message}`
										});
									}
									next();
								});
							}
							// file does exist
							fs.unlink(tempFilePath, function (err) {
								if (err) {
									console.error(`[HTTP API] Error delete temp file: ${err.stack}`);
								}
								next();
							});
						});
					}
				});
			});
		}
		
		makeTemp().then(function () {
			console.log('[HTTP API] starting to listen for incoming requests');
		
			router.get('/api/songs/', function (req, res, next) {
				res.json(queue.getAllTasks().map(function (task) {
					return task.info;
				}));
			});
			
			router.get('/api/songs/:id', function (req, res, next) {
				if (!req.params.id.match(/^(0|[1-9]\d*)$/)) {
					res.status(400).json({
						error: `malformated index: ${req.params.id}`
					});
				}
				
				const index = parseInt(req.params.id, 10);
				const songs = queue.getAllTasks();
				
				if (!songs[index]) {
					res.status(404).json({
						error: `index out of bound: ${req.params.id}`
					});
				}
				
				res.json(songs[index].info);
			});
			
			router.put('/api/songs', rawBodyStream, function (req, res, next) {
				const xTitle = req.headers['x-title'];
				const xArtist = req.headers['x-artist'];
				const filepath = req.filepath;
				const hash = req.filehash;
				
				mediaInfo('file:' + filepath)
				.then(function (info) {
					const title = xTitle || info.title || 'unknown song';
					const artist = xArtist || info.artist;
					
					var ttsText = `Next song is ${title} from ${req.ip}`;
					var titleText = title;
					
					if (artist) {
						ttsText = `Next is ${title} performed by ${artist} from ${req.ip}`;
						titleText = `${title} - ${artist}`;
					}
					
					var chatOrigin = ChatSource({
						type: 'nuzz',
						generalName: `${req.ip} from http api`,
					});
					
					doQueueSong('file:' + filepath, titleText, ttsText, chatOrigin);
					addToSongList('file:' + filepath, 'ip:' + req.ip, info.title || null, info.artist || null, chatOrigin);
				})
				.catch(function (err) {
					console.log(err.stack);
					
					// not a valid media file
					fs.unlink(filepath, function () {
						if (err) {
							console.error(`[HTTP API] Error during delete file: ${err.stack}`);
						}
					});
					
					res.status(400).json({
						error: err.message
					});
				});
			});
			
			router.delete('/api/songs/:id', function (req, res, next) {
				if (!req.params.id.match(/^(0|[1-9]\d*)$/)) {
					res.status(400).json({
						error: `malformated index: ${req.params.id}`
					});
				}
				
				const index = parseInt(req.params.id, 10);
				const songs = queue.getAllTasks();
				
				if (!songs[index]) {
					res.status(404).json({
						error: `index out of bound: ${req.params.id}`
					});
				}
				
				var task = queue.findTask(songs[index].info);
				
				if (task.length === 0) {
					return res.status(500).json({
						err: 'fail to delete task due to task not found'
					});
				}
				
				queue.remove(task[0]);
				
				res.json({
					ok: true,
					original: task[0].info
				});
			});
		})
		.catch(function (err) {
			console.error(`[HTTP API] Fail to initiate due to: ${err.stack}`);
		});
	});
};