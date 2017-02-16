module.exports = function (bridge) {
	const Queue = require("../utils/queue");
	const spawn = require('child_process').spawn;
	const retry = require('bluebird-retry');
	const fs = require('fs-extra');
	const config = require('../config.json');
	const URLHandlers = require('../url_handlers')(config.url_handles);
	const MixerStream = require('../streaming/mixer');
	const mixer = new MixerStream(16, config.output.channels, config.output.samplerate);
	
	var volume = {
		song: 1,
		tcp: 1,
		microphone: 1
	};
	
	mixer.on('new_track', function (track) {
		track.setVolume(0);
		if (track.is('song')) {
			track.fadeTo(volume.song, 1000);
		} else if (track.is('tcp')) {
			track.fadeTo(volume.tcp, 1000);
		} else if (track.is('microphone')) {
			track.fadeTo(volume.microphone, 1000);
		} else {
			track.setVolume(1);
			console.warn('[Mixer] Unknown track type %s.', track.labels);
		}
	});
	
	function makeLog(filename) {
		return function log(text) {
			fs.appendFile(filename, text + '\n', function (err) {
				if (err) console.log(err);
			});
		};
	}
	
	var playerLog = makeLog('player.log');
	
	function getFile(file) {
		return retry(function () {
			return URLHandlers.find(file).getStreamURL();
		}, {
			throw_original: true,
			interval: 10000,
			max_tries: 10
		});
	}
	
	function doBroadcast(file, chatOrigin, title) {
		return function (cb) {
			var ffmpeg = null, cancelled = false;
	
			getFile(file).then(function (url) {
				if (cancelled) return;
	
				ffmpeg = spawn('ffmpeg', [
					'-v', '-8',
					'-re',
					'-i', url,
					'-ac', config.output.channels,
					'-ar', config.output.samplerate,
					'-c:a', 'pcm_s16le',
					'-t', '900',
					'-f', 's16le',
					'-'
				]);
				
				ffmpeg.stderr.pipe(process.stderr, { end: false });
	
				var source = mixer.addSource(ffmpeg.stdout, ['song']);
				
				if (title) {
					bridge.emitSticky("metadata", title);
				}
	
				source.on('remove', function remove(err) {
					if (err && chatOrigin) {
						bridge.emit('text_message', chatOrigin, "Oops! There are errors and your song isn't played.");
					}
	
					process.nextTick(function () {
						if (title) {
							bridge.emitSticky("metadata", config.station.name);
						}
	
						cb(err);
					});
				});
	
				ffmpeg.on('error', function (e) {
					ffmpeg.stderr.unpipe(process.stderr);
					source.setError(e);
				});
	
				ffmpeg.on('exit', function (code) {
					ffmpeg.stderr.unpipe(process.stderr);
					if(code != 0 && !cancelled) {
						source.setError(new Error(`ffmpeg exited with bad exit code ${code}`));
						console.log(`ffmpeg exited with bad exit code ${code} and original parameters are`, [
							'-v', '-8',
							'-re',
							'-i', url,
							'-ac', config.output.channels,
							'-ar', config.output.samplerate,
							'-c:a', 'pcm_s16le',
							'-t', '900',
							'-f', 's16le',
							'-'
						]);
					}
				});
			}).catch(function (e) {
				if (chatOrigin) {
					bridge.emit('text_message', chatOrigin, "Oops! I can't get the file from origin.");
				}
				
				console.error('[Song Queue] Cannot fetch from Telegram, %s', e.toString());
				cb(e);
			});
	
			return function stop() {
				cancelled = true;
				
				if (!ffmpeg) {
					cb();
					return; // Since ffmpeg hasn't lived, it can't be killed.
				}
				
				ffmpeg.kill('SIGTERM');
			};
		};
	}
	
	function doTTS(text) {
		var url = "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encodeURIComponent(text) + "&tl=en-GB&client=tw-ob";
		return doBroadcast(url);
	}
	
	function doQueueSong(file, title, ttsText, chatOrigin) {
		queue.push(Queue.helpers.mergeTask(
			doTTS(ttsText),
			doBroadcast(file, chatOrigin, title)
		), {
			uid: file,
			type: "doQueueSong",
			file: file,
			title: title,
			ttsText: ttsText,
			chatOrigin: chatOrigin
		});
		
		queue.start();
		
		bridge.emit('do_queue_song', chatOrigin, file, title, ttsText);
		// bridge.emit('text_message', chatOrigin, "Your music is scheduled to play. Use /queue to see how many songs you need to wait.");
		bridge.emit('song_order_success', chatOrigin, file, title, ttsText)
	}
	
	var songList = [];
	function addToSongList(file, name, title, artist, chatOrigin) {
		if (songList.length >= config.queueSize) songList.splice(0, 1);
		songList.push({
			file: file,
			name: name,
			title: title || null,
			artist: artist || null,
			chatOrigin: chatOrigin || null
		});
	}
	
	var queue = new Queue(config.loopSize, {
		JSONToTask: function (info) {
			if (info.type === "doQueueSong") {
				return {
					task: Queue.helpers.mergeTask(
						doTTS(info.ttsText),
						doBroadcast(info.file, info.chatOrigin, info.title)
					), 
					info: info
				};
			}
	
			if (info.type === "Advertisment") {
				return {
					task: function (cb) {
						bridge.emitSticky("metadata", info.title);
						return doTTS(info.text)(cb);
					}, 
					info: info
				};
			}
	
			return {
				task: function (cb) { throw new Error(`not_implemented_type_${info.type}`); }, 
				info: info
			};
		},
		taskToJSON: function (task, info) {
			return info;
		}
	});
	
	queue.on('error', function (err, task, info) {
		console.log(`[Song Queue] item '${info.title}' removed due to:`);
		console.log(err.stack || err.message || err.toString());
	});
	
	queue.on('next', function (task, info) {
		fs.writeJsonSync("song_queue.json", queue, { space: 4 });
		playerLog(`${new Date().toLocaleTimeString()}: playing ${info.title}`);
	});
	
	queue.on('remove', function (task, info, error) {
		if (error) {
			playerLog(`${new Date().toLocaleTimeString()}: removing ${info.title} due to ${error.toString()}`);
		}
	});
	
	queue.on('push', function (task, info) {
		fs.writeJsonSync("song_queue.json", queue, { space: 4 });
		playerLog(`${new Date().toLocaleTimeString()}: adding ${info.title}`);
	});
	
	queue.on('unshift', function () {
		fs.writeJsonSync("song_queue.json", queue, { space: 4 });
	});
	
	fs.readJson("song_queue.json", function (err, savedQueue) {
		if (err) {
			console.log('[Save] Queue record wasn\'t loaded due to');
			console.log(err.message, err.stack);
		} else {
			console.log('[Save] Queue record loaded');
			queue.loadFromObject(savedQueue);
		}
		
		bridge.emitSticky('queue', queue);
		
		bridge.once('all_load', function () {
			queue.start();
		});
	});
	
	bridge.once('queue', function () {
		bridge.emitSticky('doBroadcast', doBroadcast);
		bridge.emitSticky('doTTS', doTTS);
		bridge.emitSticky('doQueueSong', doQueueSong);
	});
	
	bridge.emitSticky('volume', volume);
	bridge.emitSticky('mixer', mixer);
	bridge.emitSticky('config', config);
	bridge.emitSticky('makeLog', makeLog);
	bridge.emitSticky('URLHandlers', URLHandlers);
	bridge.emitSticky('songList', songList);
	bridge.emitSticky('addToSongList', addToSongList);
};