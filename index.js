const Telegram = require('telegram-bot-api');
const Queue = require("./utils/queue");
const MediaInfo = require("./utils/media_info");
// const Promise = require('bluebird');
const spawn = require('child_process').spawn;
const urlRegex = require('url-regex');
const retry = require('bluebird-retry');
const fs = require('fs-extra');
const utils = require('util');
const fixPathname = require("./utils/fix_pathname");
const config = require('./config.json');
const URLHandlers = require('./url_handlers')(config.url_handles);

// Activate the streaming server
const helpers =  require('./streaming');
const metadataInjector = helpers.metadataInjector;
const mixer = helpers.mixer;

var volume = {
	song: 1,
	tcp: 1,
	microphone: 1
};

mixer.on('new_track', function (track) {
	track.setVolume(0);
	if (track.is('song')) {
		track.fadeTo(volume.song, 400);
	} else if (track.is('tcp')) {
		track.fadeTo(volume.tcp, 400);
	} else if (track.is('microphone')) {
		track.fadeTo(volume.microphone, 400);
	} else {
		track.setVolume(1);
		console.warn('unknown tpye ' + track.labels);
	}
});

function makeLog(filename) {
	return function log(text) {
		fs.appendFile(filename, text + '\n', function (err) {
			if (err) console.log(err);
		});
	};
}

var log = makeLog('radiobot.log');
var playerLog = makeLog('player.log');

function getFile(file) {
	if (urlRegex({ exact: true }).test(file)) {
		return URLHandlers.find(file).getStreamURL();
	} else {
		return retry(function () {
			return bot.getFile({ file_id: file });
		}, {
			throw_original: true,
			interval: 10000,
			max_tries: 10
		}).then(function (data) {
			return 'https://api.telegram.org/file/bot' + config.telegram.token + '/' + data.file_path;
		});
	}
}

function doBroadcast(file, chat_id, msg_id, title) {
	return function (cb) {
		var ffmpeg = null, cancelled = false;

		getFile(file).then(function (url) {
			if (cancelled) return;

			ffmpeg = spawn('ffmpeg', ['-v', '-8', '-re', '-i', url, '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', '-t', '900', '-f', 's16le', '-']);
			ffmpeg.stderr.pipe(process.stderr, { end: false });

			var source = mixer.addSource(ffmpeg.stdout, ['song']);

			if (title) {
				metadataInjector.emit("metadata", title);
			}

			source.on('remove', function remove(err) {
				if (err && chat_id && msg_id) {
					bot.sendMessage({
						chat_id: chat_id,
						reply_to_message_id: msg_id,
						text: "Oops! There are errors and your song isn't played."
					});
				}

				process.nextTick(function () {
					if (title) {
						metadataInjector.emit("metadata", config.station.name);
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
				if(code != 0 && !cancelled) source.setError(new Error(`ffmpeg exited with bad exit code ${code}`));
			});
		}).catch(function (e) {
			if (chat_id && msg_id) {
				bot.sendMessage({
					chat_id: chat_id,
					reply_to_message_id: msg_id,
					text: "Oops! The file size seems larger than 20MB and I can't get it from Telegram."
				});
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

function doQueueSong(file, title, ttsText, chat_id, msg_id) {
	queue.push(Queue.helpers.mergeTask(
		doTTS(ttsText),
		doBroadcast(file, chat_id, msg_id, title)
	), {
		uid: file,
		type: "doQueueSong",
		file: file,
		title: title,
		ttsText: ttsText,
		chat_id: chat_id,
		msg_id: msg_id
	});
	
	queue.start();

	bot.sendMessage({
		chat_id: chat_id,
		reply_to_message_id: msg_id,
		text: "Your music is scheduled to play. Use /queue to see how many songs you need to wait."
	});
}

function isCmd(text, cmd) {
	return text.indexOf('/' + cmd) == 0 ? true : false;
}

var queue = new Queue(config.loopSize, {
	JSONToTask: function (info) {
		if (info.type === "doQueueSong") {
			return {
				task: Queue.helpers.mergeTask(
					doTTS(info.ttsText),
					doBroadcast(info.file, info.chat_id, info.msg_id, info.title)
				), 
				info: info
			};
		}

		if (info.type === "Advertisment") {
			return {
				task: function (cb) {
					metadataInjector.emit("metadata", 'Advertisment Time');
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

try {
	var savedQueue = fs.readJsonSync("song_queue.json");
	queue.loadFromObject(savedQueue);
	queue.start();
	console.log('[Save] Queue record loaded');
} catch (e) {
	console.log('[Save] Queue record wasn\'t loaded due to');
	console.log(e.message, e.stack);
}

metadataInjector.emit('queue_ready', queue);

var songList = [];
function addToSongList(file, name, title, artist) {
	if (songList.length >= config.queueSize) songList.splice(0, 1);
	songList.push({
		file: file,
		name: name,
		isURL: urlRegex({ exact: true }).test(file),
		title: title || null,
		artist: artist || null
	});
}

function forwardChat(chat_id, form_chat_id, message_id, label) {
	bot.forwardMessage({
		chat_id: chat_id,
		from_chat_id: form_chat_id,
		disable_notification: true,
		message_id: message_id
	}).then(function (res) {
		if (res && label) {
			bot.sendMessage({
				chat_id: chat_id,
				text: label,
				reply_to_message_id: res.message_id
			});
		}
	});
}

// Timed shows
require('./timed_broadcast')(queue, doTTS, doBroadcast, metadataInjector);

var bot = new Telegram({
	token: config.telegram.token,
	updates: { enabled: true }
});

bot.on('message', function (data) {
	var chat_id = data.chat.id;
	var msg_id = data.message_id;
	var name = data.chat.first_name;
	var text = data.text || "";

	if (data.chat.type != 'private') {
		return;
	}

	if (isCmd(text, 'start')) {
		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: config.telegram.startMessage
		});
		return;
	}

	if (isCmd(text, 'queue')) {
		var realQueueLength = queue.length;

		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "There are " + realQueueLength + " songs in the queue. " + (realQueueLength >= config.queueSize ? "I'm quite busy right now, please find me again after, like, 30 minutes." : "")
		});
		return;
	}

	if (isCmd(text, 'list')) {
		var output = "Recent songs: \n";
		if (songList.length > 0) {
			songList.forEach(function (item, i) {
				output += "/song_" + (i + 1) + " uploaded by " + item.name;
				if (item.title) {
					output += ' ( ' + item.title;
					if (item.artist) {
						output += ' performed by ' + item.artist;
					}
					output += ' )';
				}
				output += '\n';
			});
		} else {
			output = "There are no songs in the list.";
		}
		
		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: output
		});
		return;
	}

	if (isCmd(text, 'play_list')) {
		var output = 'Playing:\n';
		output += `-> ${queue.currentTask.info.title}\n`;
		output += 'Music To Play:\n';
		output += queue.getAllTasks().map(function (task) {
			return `-- ${task.info.title} ${task.execCount > 0 ? '( played ' + task.execCount + ' time )' : ''}`;
		}).join('\n');
		
		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: output
		});
		
		return;
	}

	if (isCmd(text, 'skip') && data.chat.username && config.admin.indexOf(data.chat.username) > -1) {
		// remove the song
		queue.remove(queue.currentTask);
		queue.signal('stop');
		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "The current song will stop and be removed shortly."
		});
	}

	if (isCmd(text, 'next') && data.chat.username && config.admin.indexOf(data.chat.username) > -1) {
		queue.signal('stop');
		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "The next song will start shortly."
		});
	}

	if (isCmd(text, 'tts') && data.chat.username && config.admin.indexOf(data.chat.username) > -1) {
		var speech = text.split(/\s/).slice(1).join(' ');
		if (speech) {
			doTTS(speech)(function () {});
			bot.sendMessage({
				chat_id: chat_id,
				reply_to_message_id: msg_id,
				text: "The text will be played shortly."
			});
		}
	}

	if (isCmd(text, 'volume') && data.chat.username && config.admin.indexOf(data.chat.username) > -1) {
		var temp = text.split(/\s/);
		
		if (temp.length !== 3 || null == volume[temp[1]]) {
			return bot.sendMessage({
				chat_id: chat_id,
				reply_to_message_id: msg_id,
				text: `usage: /volume ${ Object.keys(volume).join('|') } {newVolume}`
			});
		}
		
		var newVolume = parseFloat(temp[2]);
		
		if (isNaN(newVolume) || newVolume > 1 || newVolume < 0) {
			return bot.sendMessage({
				chat_id: chat_id,
				reply_to_message_id: msg_id,
				text: "volume must be a number between 0 and 1"
			});
		}
		
		console.log(`[Bot] New volume ${newVolume} for type [${temp[1]}] set by ${name}`);

		volume[temp[1]] = newVolume;

		mixer.getSources(temp[1]).forEach(function (source) {
			source.fadeTo(newVolume, 800);
		});

		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: `volume for type [${temp[1]}] has been set to ${newVolume}`
		});
	}

	if (queue.length >= config.queueSize) {
		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "I'm quite busy playing songs right now, please find me again after, like, 30 minutes."
		});
		return;
	}

	if (isCmd(text, 'song_')) {
		var index = parseInt(text.replace('/song_', ''), 10) - 1;

		if (!songList[index]) return;

		var ttsText = `Next song is from ${songList[index].name}, picked up by ${name} on Telegram.`;
		var title = `Song picked up by ${name}.`;

		if (songList[index].title && songList[index].artist) {
			log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): (from Song List) [${songList[index].artist} - ${songList[index].title}] (${songList[index].file})`));
			ttsText = `Next song is ${songList[index].title} performed by ${songList[index].artist} from ${songList[index].name}, picked up by ${name} on Telegram.`;
			title = `${songList[index].title} - ${songList[index].artist}`;
		}

		log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): (${songList[index].file})`));
		doQueueSong(songList[index].file, title, ttsText, chat_id, msg_id);
	}

	if (data.audio) {
		var title = data.audio.title || null;
		var artist = data.audio.performer || null;
		var ttsText = `Next song is from ${name} on Telegram.`;
		var titleText = `Song from ${name}.`;

		if (artist && title) {
			ttsText = `Next is ${title} performed by ${artist} from ${name} on Telegram.`;
			titleText = `${title} - ${artist}`;
			log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): [${artist} - ${title}] (${data.audio.file_id})`));
		} else {
			log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): (${data.audio.file_id})`));
		}

		doQueueSong(data.audio.file_id, titleText, ttsText, chat_id, msg_id);
		addToSongList(data.audio.file_id, name, title, artist);
		
		if (config.logForward) {
			forwardChat(config.logForward, chat_id, msg_id, `Song ordered by ${name} ( ${data.from.username ? '@' + data.from.username : data.from.id} )`);
		}
	} else if (data.document) {
		var regex = /\.(mp3|aac|m4a|ogg|flac|asf|wma|opus)$/i;
		var ttsText = `Next song is from ${name} on Telegram.`;
		var titleText = `Song from ${name}.`;
		log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): [${data.document.file_name}](${data.document.file_id})`));

		if (regex.test(data.document.file_name)) {
			getFile(data.document.file_id).then(function (url) {
				MediaInfo(url).then(function (info) {
					if (info.title && info.artist) {
						ttsText = `Next is ${info.title} performed by ${info.artist} from ${name} on Telegram.`;
						titleText = `${info.title} - ${info.artist}`;
					}

					doQueueSong(url, titleText, ttsText, chat_id, msg_id);
					addToSongList(data.document.file_id, name, info.title || null, info.artist || null);

					if (config.logForward) {
						forwardChat(config.logForward, chat_id, msg_id, `Song ordered by ${name} ( ${data.from.username ? '@' + data.from.username : data.from.id} )`);
					}
				});
			}).catch(function (e) {
				bot.sendMessage({
					chat_id: chat_id,
					reply_to_message_id: msg_id,
					text: "Oops! The file size seems larger than 20MB and I can't get it from Telegram."
				});
				
				console.error('[Song Queue] Cannot fetch from Telegram, %s', e.toString());
			});
		} else {
			bot.sendMessage({
				chat_id: chat_id,
				reply_to_message_id: msg_id,
				text: "I don't know these formats."
			});
		}
	} else if (urlRegex({ exact: true }).test(text)) {
		text = fixPathname(text);
		URLHandlers.find(text).getInfo().then(function (info) {
			var ttsText = `Next song is from ${name} on Telegram.`;
			var titleText = `Song from ${name}.`;
			
			if (info.title && info.artist) {
				log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): [${info.artist} - ${info.title}] ${text}`));
				ttsText = `Next is ${info.title} performed by ${info.artist} from ${name} on Telegram.`;
				titleText = info.title;
			} else {
				log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): ${text}`));
			}
			
			doQueueSong(text, titleText, ttsText, chat_id, msg_id);
			addToSongList(text, name);
			
			if (config.logForward) {
				forwardChat(config.logForward, chat_id, msg_id, `Song ordered by ${name} ( ${data.from.username ? '@' + data.from.username : data.from.id} )`);
			}
		}).catch(function (err) {
			bot.sendMessage({
				chat_id: chat_id,
				reply_to_message_id: msg_id,
				text: `Sorry, there is some error with your url, and it isn't scheduled.\n${err.toString()}`
			});
			console.log('[Song Queue] Cannot fetch from url, %s', err.toString());
		});
	}
});
