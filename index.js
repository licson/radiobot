const Telegram = require('telegram-bot-api');
const Queue = require("./utils/queue");
const MediaInfo = require("./utils/media_info");
const Promise = require('bluebird');
const spawn = require('child_process').spawn;
const urlRegex = require('url-regex');
const retry = require('bluebird-retry');
const fs = require('fs');
const utils = require('util');
const config = require('./config.json');

// Activate the streaming server
const metadataInjector = require('./streaming');

function saveConfig() {
	fs.writeFile('config.json', JSON.stringify(config), function (err) {
		if (err) console.log(err);
	});
}

function log(text) {
	fs.appendFile('radiobot.log', text + '\n', function (err) {
		if (err) console.log(err);
	})
}

function getFile(file) {
	return new Promise(function (resolve, reject) {
		if (urlRegex({ exact: true }).test(file)) {
			resolve(file);
		} else {
			retry(function () {
				return bot.getFile({ file_id: file });
			}, {
				throw_original: true,
				interval: 10000,
				max_tries: 10
			}).then(function (data) {
				var url = 'https://api.telegram.org/file/bot' + config.telegram.token + '/' + data.file_path;
				resolve(url);
			}).catch(function (e) {
				reject(e);
			});
		}
	});
};

function doBroadcast(file, chat_id, msg_id, title) {
	return function (cb) {
		var ffmpeg = null, cancelled = false;
		
		getFile(file).then(function (url) {
			if (cancelled) return;
			
			ffmpeg = spawn('ffmpeg', ['-v', '-8', '-re', '-i', url, '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', '-t', '900', '-f', 's16le', `tcp://127.0.0.1:${config.ports.helper}`]);
			ffmpeg.stdout.resume();
			ffmpeg.stderr.pipe(process.stderr);
	
			if (title) {
				metadataInjector.emit("metadata", title);
			}
	
			ffmpeg.on('error', function (e) {
				cb(e);
				metadataInjector.emit("metadata", config.station.name);
	
				if (chat_id && msg_id) {
					bot.sendMessage({
						chat_id: chat_id,
						reply_to_message_id: msg_id,
						text: "Oops! There are errors and your song isn't played."
					});
				}
			});
	
			ffmpeg.on('exit', function (code) {
				if (code == 0 || cancelled) {
					setTimeout(function () {
						metadataInjector.emit("metadata", config.station.name);
						cb();
					}, 1000);
				} else {
					cb(code);
					if (chat_id && msg_id) {
						bot.sendMessage({
							chat_id: chat_id,
							reply_to_message_id: msg_id,
							text: "Oops! There are errors and your song isn't played."
						});
					}
				}
			});
		}).catch(function (e) {
			bot.sendMessage({
				chat_id: chat_id,
				reply_to_message_id: msg_id,
				text: "Oops! The file size seems larger than 20MB and I can't get it from Telegram."
			});
			
			console.error('[Song Queue] Cannot fetch from Telegram, %s', e.toString());
			cb(e);
		});
		
		return function stop() {
			cancelled = true;
			if (!ffmpeg) {
				cb();
				return; // Don't let stupid users/script kiddies kill the server
			}
			ffmpeg.kill('SIGTERM');
		}
	};
};

function doTTS(text) {
	var url = "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encodeURIComponent(text) + "&tl=en-GB&client=tw-ob";
	return doBroadcast(url);
};

function doQueueSong(file, title, ttsText, chat_id, msg_id) {
	queue.push(Queue.helpers.mergeTask(
		doTTS(ttsText),
		doBroadcast(file, chat_id, msg_id, title)
	))
	queue.start();

	bot.sendMessage({
		chat_id: chat_id,
		reply_to_message_id: msg_id,
		text: "Your music is scheduled to play. Use /queue to see how many songs you need to wait."
	});
};

function isCmd(text, cmd) {
	return text.indexOf('/' + cmd) == 0 ? true : false;
};

var queue = new Queue(config.loopSize);
queue.on('error', function () { });

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
};

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
			text: "Welcome! I'm the DJ of Licson's Internet Radio. Just send me a song or a direct link to get your song played on " + config.station.url + " !"
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

		songList.forEach(function (item, i) {
			output += "/song_" + (i + 1) + " uploaded by " + item.name + ". \n";
		});

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
			text: "The current song will stop and removed shortly."
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
	
	if (queue.length >= config.queueSize) {
		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "I'm quite busy playing songs right now, please find me again after, like, 30 minutes."
		});
		return;
	}

	if (isCmd(text, 'song_')) {
		var index = parseInt(text.replace('/song_', '')) - 1;

		if (!songList[index]) return;

		var ttsText = `Next song is from ${songList[index].name}, picked up by ${name} on Telegram.`;
		var title = `Song picked up by ${name}.`;

		if (songList[index].title && songList[index].artist) {
			log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): (from Song List) [${songList[index].artist} - ${songList[index].title}] (${songList[index].file})`));
			ttsText = `Next song is ${songList[index].title} performed by ${songList[index].artist} from {songList[index].name}, picked up by ${name} on Telegram.`;
			title = `${songList[index].title} - ${songList[index].artist}`;
		}

		log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): (${songList[index].file})`));
		doQueueSong(songList[index].file, title, ttsText, chat_id, msg_id);
	}

	if (data.audio) {
		var title = data.audio.title || null;
		var artist = data.audio.performer || null;
		var ttsText = `Next song is from ${name} on Telegram.`;
		var titleText = `Song from ${name}.`

		if (artist && title) {
			ttsText = `Next is ${title} performed by ${artist} from ${name} on Telegram.`;
			titleText = `${title} - ${artist}`;
			log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): [${artist} - ${title}] (${data.audio.file_id})`));
		} else {
			log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): (${data.audio.file_id})`));
		}

		doQueueSong(data.audio.file_id, titleText, ttsText, chat_id, msg_id);
		addToSongList(data.audio.file_id, name, title, artist);
	} else if (data.document) {
		var regex = /\.(mp3|aac|m4a|ogg|flac|asf|wma|)$/i;
		var ttsText = `Next song is from ${name} on Telegram.`;
		var titleText = `Song from ${name}.`
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
		var ttsText = `Next song is from ${name} on Telegram.`;
		var titleText = `Song from ${name}.`
		log(utils.format(`${new Date().toLocaleTimeString()} ${name}(${data.from.username}): ${text}`));

		doQueueSong(text, titleText, ttsText, chat_id, msg_id);
		addToSongList(text, name);

		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "Your music is scheduled to play. Use /queue to see how many songs you need to wait."
		});
	}
});
