module.exports = function (bridge) {
bridge.allOnce(['config', 'makeLog', 'URLHandlers', 'queue', 'doQueueSong', 'songList', 'addToSongList', 'doTTS', 'mixer', 'volume'], 
function (config, makeLog, URLHandlers, queue, doQueueSong, songList, addToSongList, doTTS, mixer, volume) {
// --------------

const Telegram = require('telegram-bot-api');
const log = makeLog('telegram.log');
const retry = require('bluebird-retry');
const ChatSource = require('../utils/chat_source');
const MediaInfo = require("../utils/media_info");
const urlRegex = require('url-regex');
const Promise = require('bluebird');
const fixPathname = require("../utils/fix_pathname");

if (!/^\d+:[a-zA-Z0-9\-_]+$/.test(config.telegram.token)) {
	console.warn('[Telegram Bot] [Error] Telegram front end does not init because the auth token was missing.');
	return;
}

var bot = new Telegram({
	token: config.telegram.token,
	updates: { enabled: true }
});


function getFile(file) {
	return retry(function () {
		return bot.getFile({ file_id: file })
		.then(function (data) {
			return 'https://api.telegram.org/file/bot' + config.telegram.token + '/' + data.file_path;
		});
	}, {
		throw_original: true,
		interval: 10000,
		max_tries: 10
	});
}

bot.on('message', function (data) {
	if (!data) {
		console.log(data);
		return;
	}
	if (data.chat.type != 'private') {
		return;
	}
	textHandlers.forEach(function (handler) {
		if (!handler.regex) {
			return handler.cb(data);
		}
		if (!data.text) {
			return;
		}
		var result = handler.regex.exec(data.text);
		
		if (result) {
			handler.cb(data, result);
		}
	});
});

var textHandlers = [];

function handle(regex, cb) {
	if ('function' === typeof regex) {
		cb = regex;
		regex = null;
	}
	textHandlers.push({
		regex: regex,
		cb: cb
	});
}

handle(/\/start(\s|@|$)/, function (message) {
	bot.sendMessage({
		chat_id: message.chat.id,
		reply_to_message_id: message.message_id,
		text: config.telegram.startMessage
	});
});


handle(/\/queue(\s|@|$)/, function (message) {
	var realQueueLength = queue.length;

	bot.sendMessage({
		chat_id: message.chat.id,
		reply_to_message_id: message.message_id,
		text: "There are " + realQueueLength + " songs in the queue. " + (realQueueLength >= config.queueSize ? "I'm quite busy right now, please find me again after, like, 30 minutes." : "")
	});
});

handle(/\/list(\s|@|$)/, function (message) {
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
		chat_id: message.chat.id,
		reply_to_message_id: message.message_id,
		text: output
	});
});

handle(/\/play_list(\s|@|$)/, function (message) {
	var output = 'Playing:\n';
	output += `-> ${queue.currentTask.info.title}\n`;
	output += 'Music To Play:\n';
	output += queue.getAllTasks().map(function (task) {
		return `-- ${task.info.title} ${task.execCount > 0 ? '( played ' + task.execCount + ' time )' : ''}`;
	}).join('\n');
	
	bot.sendMessage({
		chat_id: message.chat.id,
		reply_to_message_id: message.message_id,
		text: output
	});
	
	return;
});

handle(/\/skip(\s|@|$)/, function (message) {
	if (!message.from.username || config.telegram.admin.indexOf(message.chat.username) < 0) return;
	
	// remove the song
	queue.remove(queue.currentTask);
	queue.signal('stop');
	bot.sendMessage({
		chat_id: message.chat.id,
		reply_to_message_id: message.message_id,
		text: "The current song will stop and be removed shortly."
	});
});

handle(/\/next(\s|@|$)/, function (message) {
	if (!message.from.username || config.telegram.admin.indexOf(message.chat.username) < 0) return;
	
	queue.signal('stop');
	bot.sendMessage({
		chat_id: message.chat.id,
		reply_to_message_id: message.message_id,
		text: "The current song will stop and be removed shortly."
	});
});

handle(/\/tts(\s|@|$)/, function (message) {
	if (!message.from.username || config.telegram.admin.indexOf(message.chat.username) < 0) return;
	
	var speech = message.text.split(/\s/).slice(1).join(' ');
	if (speech) {
		doTTS(speech)(function () {});
		bot.sendMessage({
			chat_id: message.chat.id,
			reply_to_message_id: message.message_id,
			text: "The text will be played shortly."
		});
	}
});

handle(/\/volume(\s|@|$)/, function (message) {
	if (!message.from.username || config.telegram.admin.indexOf(message.chat.username) < 0) return;
	
	var temp = message.text.split(/\s/);
	
	if (temp.length !== 3 || null == volume[temp[1]]) {
		return bot.sendMessage({
			chat_id: message.chat.id,
			reply_to_message_id: message.message_id,
			text: `usage: /volume ${ Object.keys(volume).join('|') } {newVolume}`
		});
	}
	
	var newVolume = parseFloat(temp[2]);
	
	if (isNaN(newVolume) || newVolume > 1 || newVolume < 0) {
		return bot.sendMessage({
			chat_id: message.chat.id,
			reply_to_message_id: message.message_id,
			text: "volume must be a number between 0 and 1"
		});
	}
	
	console.log(`[Telegram Bot] New volume ${newVolume} for type [${temp[1]}] set by ${message.from.first_name}`);

	volume[temp[1]] = newVolume;

	mixer.getSources(temp[1]).forEach(function (source) {
		source.fadeTo(newVolume, 2000);
	});

	bot.sendMessage({
		chat_id: message.chat.id,
		reply_to_message_id: message.message_id,
		text: `volume for type [${temp[1]}] has been set to ${newVolume}`
	});
});

handle(/\/song_([1-9]\d*)(?:\s|@|$)/, function (message, match) {
	var index = parseInt(match[1], 10) - 1;

	if (!songList[index]) return;

	var ttsText = `Next song is from ${songList[index].name}, picked up by ${message.from.first_name} on Telegram.`;
	var title = `Song picked up by ${message.from.first_name}.`;

	if (songList[index].title && songList[index].artist) {
		log(`${new Date().toLocaleTimeString()} ${message.from.first_name}(${message.from.username}): (from Song List) [${songList[index].artist} - ${songList[index].title}] (${songList[index].file})`);
		ttsText = `Next song is ${songList[index].title} performed by ${songList[index].artist} from ${songList[index].name}, picked up by ${message.from.first_name} on Telegram.`;
		title = `${songList[index].title} - ${songList[index].artist}`;
	}

	log(`${new Date().toLocaleTimeString()} ${message.from.first_name}(${message.from.username}): (${songList[index].file})`);
	
	doQueueSong(songList[index].file, title, ttsText, ChatSource({
		type: 'telegram',
		generalName: `${message.from.first_name} on telegram`,
		chat_id: message.chat.id,
		message_id: message.message_id
	}));
});

handle(function (message) {
	if (!message.audio) {
		return;
	}
	
	var name = message.from.first_name;
	
	var title = message.audio.title || null;
	var artist = message.audio.performer || null;
	var ttsText = `Next song is from ${name} on Telegram.`;
	var titleText = `Song from ${name}.`;

	if (artist && title) {
		ttsText = `Next is ${title} performed by ${artist} from ${name} on Telegram.`;
		titleText = `${title} - ${artist}`;
		log(`${new Date().toLocaleTimeString()} ${name}(${message.from.username}): [${artist} - ${title}] (${message.audio.file_id})`);
	} else {
		log(`${new Date().toLocaleTimeString()} ${name}(${message.from.username}): (${message.audio.file_id})`);
	}

	doQueueSong('telegram:' + message.audio.file_id, titleText, ttsText, ChatSource({
		type: 'telegram',
		generalName: `${message.from.first_name} on telegram`,
		chat_id: message.chat.id,
		message_id: message.message_id
	}));
	
	addToSongList(message.audio.file_id, name, title, artist);
});

handle(function (message) {
	if (!message.document) {
		return;
	}
	
	var name = message.from.first_name;
	
	var regex = /\.(mp3|aac|m4a|ogg|flac|asf|wma|opus)$/i;
	var ttsText = `Next song is from ${name} on Telegram.`;
	var titleText = `Song from ${name}.`;
	log(`${new Date().toLocaleTimeString()} ${name}(${message.from.username}): [${message.document.file_name}](${message.document.file_id})`);

	if (regex.test(message.document.file_name)) {
		getFile(message.document.file_id).then(function (url) {
			MediaInfo(url).then(function (info) {
				if (info.title && info.artist) {
					ttsText = `Next is ${info.title} performed by ${info.artist} from ${name} on Telegram.`;
					titleText = `${info.title} - ${info.artist}`;
				}

				doQueueSong('telegram:' + message.document.file_id, titleText, ttsText, ChatSource({
					type: 'telegram',
					generalName: `${message.from.first_name} on telegram`,
					chat_id: message.chat.id,
					message_id: message.message_id
				}));
				
				addToSongList(message.document.file_id, name, info.title || null, info.artist || null);

				// if (config.logForward) {
				// 	forwardChat(config.logForward, chat_id, msg_id, `Song ordered by ${name} ( ${message.from.username ? '@' + message.from.username : data.from.id} )`);
				// }
			});
		}).catch(function (e) {
			bot.sendMessage({
				chat_id: message.chat.id,
				reply_to_message_id: message.message_id,
				text: "Oops! The file size seems larger than 20MB and I can't get it from Telegram."
			});
			
			console.error('[Song Queue] Cannot fetch from Telegram, %s', e.toString());
		});
	} else {
		bot.sendMessage({
			chat_id: message.chat.id,
			reply_to_message_id: message.message_id,
			text: "I don't know these formats."
		});
	}
});

handle(urlRegex({ exact: true }), function (message) {
	var text = message.text;
	var chat_id = message.chat.id;
	var msg_id = message.message_id;
	var name = message.from.first_name;
	
	text = fixPathname(text);
	URLHandlers.find(text).getInfo().then(function (info) {
		var ttsText = `Next song is from ${name} on Telegram.`;
		var titleText = `Song from ${name}.`;
		
		if (info.title && info.artist) {
			log(`${new Date().toLocaleTimeString()} ${name}(${message.from.username}): [${info.artist} - ${info.title}] ${text}`);
			ttsText = `Next is ${info.title} performed by ${info.artist} from ${name} on Telegram.`;
			titleText = info.title;
		} else {
			log(`${new Date().toLocaleTimeString()} ${name}(${message.from.username}): ${text}`);
		}
		
		doQueueSong(text, titleText, ttsText, ChatSource({
			type: 'telegram',
			generalName: `${message.from.first_name} on telegram`,
			chat_id: message.chat.id,
			message_id: message.message_id
		}));
		
		addToSongList(text, name);
		
		// if (config.logForward) {
		// 	forwardChat(config.logForward, chat_id, msg_id, `Song ordered by ${name} ( ${data.from.username ? '@' + data.from.username : data.from.id} )`);
		// }
	}).catch(function (err) {
		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: `Sorry, there is some error with your url, and it isn't scheduled.\n${err.toString()}`
		});
		console.log('[Song Queue] Cannot fetch from url, %s', err.toString());
	});
});

bridge.on('text_message', function (chatOrigin, text) {
	if (chatOrigin.type !== 'telegram') {
		return;
	}
	
	bot.sendMessage({
		chat_id: chatOrigin.chat_id,
		reply_to_message_id: chatOrigin.message_id,
		text: text
	});
});

URLHandlers.unshift({
	shouldHandle: function (url) {
		return url.match(/^telegram:/);
	},
	getInfo: function (url) {
		return Promise.reject(new Error("not implement"));
	},
	getStreamURL: function (url) {
		return getFile(url.replace(/^telegram:/, ''));
	}
});

// --------------
});
};