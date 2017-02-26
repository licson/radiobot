module.exports = function (bridge) {
	bridge.allOnce(['config', 'makeLog', 'URLHandlers', 'queue', 'doQueueSong', 'songList', 'addToSongList', 'doTTS', 'mixer', 'volume'], 
	function (config, makeLog, URLHandlers, queue, doQueueSong, songList, addToSongList, doTTS, mixer, volume) {
		const Telegram = require('node-telegram-bot-api');
		const log = makeLog('telegram.log');
		const retry = require('bluebird-retry');
		const ChatSource = require('../utils/chat_source');
		const MediaInfo = require("../utils/media_info");
		const urlRegex = require('url-regex');
		const Promise = require('bluebird');
		const fixPathname = require("../utils/fix_pathname");
		
		if (!/^\d+:[a-zA-Z0-9\-_]+$/.test(config.telegram.token)) {
			console.warn('[Telegram] [Error] Telegram front end does not init because the auth token was missing.');
			return;
		}
		
		var playList = null;
		
		function getPlayListText() {
			var output = '';
			
			if (queue.currentTask) {
				output += 'Playing:\n';
				output += `-> ${queue.currentTask.info.title}\n`;
			}
			
			output += 'Music To Play:\n';
			
			output += queue.getAllTasks().map(function (task) {
				return `-- ${task.info.title} ${task.execCount > 0 ? '( played ' + task.execCount + ' time )' : ''}`;
			}).join('\n');
			
			return output;
		}
		
		function getFile(file) {
			return retry(function () {
				return bot.getFileLink(file);
			}, {
				throw_original: true,
				interval: 10000,
				max_tries: 10
			});
		}
		
		function startPlayList() {
			return bot.sendMessage(config.telegram.playList, getPlayListText()).then(function (message) {playList = message});
		}
		
		function updatePlayList() {
			bot.editMessageText(`${getPlayListText()}\r\n\r\n* Updated at ${(new Date).toLocaleTimeString()}.`, {
				chat_id: playList.chat.id,
				message_id: playList.message_id
			}).catch(function (e) {
				return bot.sendMessage(config.telegram.playList, getPlayListText()).then(function (message) {playList = message});
			}).catch(function (e) {});
		}
		
		var bot = new Telegram(config.telegram.token);
		
		if (config.telegram.playList) {
			startPlayList().then(function () {
				if (queue.currentTask) {
					// Force an update if the queue updates before everything happened.
					updatePlayList();
				}
				
				queue.on('push', updatePlayList);
				queue.on('next', updatePlayList);
			}).catch(function (e) {});
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
			bot.sendMessage(message.chat.id, config.telegram.startMessage, {reply_to_message_id: message.message_id});
		});
		
		handle(/\/queue(\s|@|$)/, function (message) {
			var realQueueLength = queue.length;
		
			bot.sendMessage(
				message.chat.id,
				"There are " + realQueueLength + " songs in the queue. " + (realQueueLength >= config.queueSize ? "I'm quite busy right now, please find me again after, like, 30 minutes." : ""),
				{reply_to_message_id: message.message_id}
			);
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
			
			bot.sendMessage(message.chat.id, output, {reply_to_message_id: message.message_id});
		});
		
		handle(/\/play_list(\s|@|$)/, function (message) {
			var output = getPlayListText();
			
			bot.sendMessage(message.chat.id, output, {reply_to_message_id: message.message_id});
			
			return;
		});
		
		handle(/\/skip(\s|@|$)/, function (message) {
			if (!message.from.username || config.telegram.admin.indexOf(message.chat.username) < 0) return;
			
			// remove the song
			queue.remove(queue.currentTask);
			queue.signal('stop');
			bot.sendMessage(message.chat.id, "The current song will stop and be removed shortly.", {reply_to_message_id: message.message_id});
		});
		
		handle(/\/next(\s|@|$)/, function (message) {
			if (!message.from.username || config.telegram.admin.indexOf(message.chat.username) < 0) return;
			
			queue.signal('stop');
			bot.sendMessage(message.chat.id, "The next song will start shortly.", {reply_to_message_id: message.message_id});
		});
		
		handle(/\/tts(\s|@|$)/, function (message) {
			if (!message.from.username || config.telegram.admin.indexOf(message.chat.username) < 0) return;
			
			var speech = message.text.split(/\s/).slice(1).join(' ');
			if (speech) {
				doTTS(speech)(function () {});
				bot.sendMessage(message.chat.id, "The text will be played shortly.", {reply_to_message_id: message.message_id});
			}
		});
		
		handle(/\/volume(\s|@|$)/, function (message) {
			if (!message.from.username || config.telegram.admin.indexOf(message.chat.username) < 0) return;
			
			var temp = message.text.split(/\s/);
			
			if (temp.length !== 3 || null == volume[temp[1]]) {
				return bot.sendMessage(message.chat.id, `usage: /volume ${ Object.keys(volume).join('|') } {newVolume}`, {reply_to_message_id: message.message_id});
			}
			
			var newVolume = parseFloat(temp[2]);
			
			if (isNaN(newVolume) || newVolume > 1 || newVolume < 0) {
				return bot.sendMessage(message.chat.id, "Volume must be a number between 0 and 1", {reply_to_message_id: message.message_id});
			}
			
			console.log(`[Telegram] Volume of ${temp[1]}: ${newVolume * 100}%.`);
		
			volume[temp[1]] = newVolume;
		
			mixer.getSources(temp[1]).forEach(function (source) {
				source.fadeTo(newVolume, 2000);
			});
		
			bot.sendMessage(message.chat.id, `Volume for type ${temp[1]} has been set to ${newVolume}.`, {reply_to_message_id: message.message_id});
		});
		
		handle(/\/song_([1-9]\d*)(?:\s|@|$)/, function (message, match) {
			var index = parseInt(match[1], 10) - 1;
		
			if (!songList[index]) return;
			
			if (queue.length >= config.queueSize) {
				bot.sendMessage(
					message.chat.id,
					"I'm quite busy playing songs right now, please find me again after, like, 30 minutes.",
					{reply_to_message_id: message.message_id}
				);
				return;
			}
			
			var ttsText = `Next song is from ${songList[index].name}, picked up by ${message.from.first_name} on Telegram.`;
			var title = `Song picked up by ${message.from.first_name}.`;
		
			if (songList[index].title && songList[index].artist) {
				log(`${new Date().toLocaleTimeString()} ${message.from.first_name}(${message.from.username}): (from Song List) [${songList[index].artist} - ${songList[index].title}] (${songList[index].file})`);
				ttsText = `Next song is ${songList[index].title} performed by ${songList[index].artist} from ${songList[index].name}, picked up by ${message.from.first_name} on Telegram.`;
				title = `${songList[index].title} - ${songList[index].artist}`;
			}
		
			log(`${new Date().toLocaleTimeString()} ${message.from.first_name}(${message.from.username}): (${songList[index].file})`);
			
			var chatOrigin = ChatSource({
				type: 'telegram',
				generalName: `${message.from.first_name} on telegram`,
				chat_id: message.chat.id,
				message_id: message.message_id
			});
			
			if (songList[index].chatOrigin && songList[index].chatOrigin.original) {
				chatOrigin.original = songList[index].chatOrigin.original;
			} else if (songList[index].chatOrigin) {
				chatOrigin.original = songList[index].chatOrigin;
			}
			
			doQueueSong(songList[index].file, title, ttsText, chatOrigin);
		});
		
		handle(function (message) {
			if (!message.audio) {
				return;
			}
			
			if (queue.length >= config.queueSize) {
				bot.sendMessage(
					message.chat.id,
					"I'm quite busy playing songs right now, please find me again after, like, 30 minutes.",
					{reply_to_message_id: message.message_id}
				);
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
			
			var chatOrigin = ChatSource({
				type: 'telegram',
				generalName: `${message.from.first_name} on telegram`,
				chat_id: message.chat.id,
				message_id: message.message_id
			});
			
			doQueueSong('telegram:' + message.audio.file_id, titleText, ttsText, chatOrigin);
			addToSongList(message.audio.file_id, name, title, artist, chatOrigin);
		});
		
		handle(function (message) {
			if (!message.document) {
				return;
			}
			
			if (queue.length >= config.queueSize) {
				bot.sendMessage(
					message.chat.id,
					"I'm quite busy playing songs right now, please find me again after, like, 30 minutes.",
					{reply_to_message_id: message.message_id}
				);
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
						
						var chatOrigin = ChatSource({
							type: 'telegram',
							generalName: `${message.from.first_name} on telegram`,
							chat_id: message.chat.id,
							message_id: message.message_id
						});

						doQueueSong('telegram:' + message.document.file_id, titleText, ttsText, chatOrigin);
						addToSongList(message.document.file_id, name, info.title || null, info.artist || null, chatOrigin);

						// if (config.logForward) {
						// 	forwardChat(config.logForward, chat_id, msg_id, `Song ordered by ${name} ( ${message.from.username ? '@' + message.from.username : data.from.id} )`);
						// }
					});
				}).catch(function (e) {
					bot.sendMessage(
						message.chat.id,
						"Oops! The file size seems larger than 20MB and I can't get it from Telegram.",
						{reply_to_message_id: message.message_id}
					);
					
					console.error('[Song Queue] Cannot fetch from Telegram, %s', e.toString());
				});
			} else {
				bot.sendMessage(message.chat.id, "I don't know these formats.", {reply_to_message_id: message.message_id});
			}
		});
		
		handle(urlRegex({ exact: true }), function (message) {
			var text = message.text;
			var name = message.from.first_name;
			
			if (queue.length >= config.queueSize) {
				bot.sendMessage(
					message.chat.id,
					"I'm quite busy playing songs right now, please find me again after, like, 30 minutes.",
					{reply_to_message_id: message.message_id}
				);
				return;
			}
			
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
				
				var chatOrigin = ChatSource({
					type: 'telegram',
					generalName: `${name} on telegram`,
					chat_id: message.chat.id,
					message_id: message.message_id
				});
				
				doQueueSong(text, titleText, ttsText, chatOrigin);
				addToSongList(text, name, info.title || null, info.artist || null, chatOrigin);
				
				// if (config.logForward) {
				// 	forwardChat(config.logForward, chat_id, msg_id, `Song ordered by ${name} ( ${data.from.username ? '@' + data.from.username : data.from.id} )`);
				// }
			}).catch(function (err) {
				bot.sendMessage(
					message.chat.id,
					"Problems encountered when trying to fetch your song. Please try again later.",
					{reply_to_message_id: message.message_id}
				);
				console.log('[Song Queue] Cannot fetch from link: %s', err.toString());
			});
		});
		
		if (config.telegram.logForward) {
			bridge.on('do_queue_song', function(chatOrigin, file, title, ttsText) {
				if (!chatOrigin) return;
				
				var originalChat = chatOrigin.original || chatOrigin;
				
				if (originalChat.type === 'telegram') {
					bot.forwardMessage(config.telegram.logForward, originalChat.chat_id, originalChat.message_id, {disable_notification: true})
					.then(function (res) {
						return bot.sendMessage(config.telegram.logForward, `Song from ${chatOrigin.generalName}`, {reply_to_message_id: res.message_id});
					}).catch(function (e) {
						console.warn('[Telegram] Failed forwarding message! %s', e);
					});
				} else {
					bot.sendMessage(
						config.telegram.logForward,
						`${ file.slice(0,4) === 'http' ? file + '\r\n' : '' }${title} \r\nOrdered by ${chatOrigin.generalName}`
					).catch(function (e) {
						console.warn('[Telegram] Failed sending message! %s', e);
					});
				}
			});
		}
		
		bridge.on('text_message', function (chatOrigin, text) {
			if (!chatOrigin) return;
			
			if (chatOrigin.type !== 'telegram') {
				return;
			}
			
			bot.sendMessage(chatOrigin.chat_id, text, {reply_to_message_id: chatOrigin.message_id});
		});
		
		bridge.on('song_order_success', function (chatOrigin, text) {
			if (!chatOrigin) return;
			
			if (chatOrigin.type !== 'telegram') {
				return;
			}
			
			bot.sendMessage(
				chatOrigin.chat_id,
				"Your music is scheduled to play. Use /queue to see how many songs you need to wait.",
				{reply_to_message_id: chatOrigin.message_id}
			);
		});
		
		URLHandlers.unshift({
			shouldHandle: function (url) {
				return url.match(/^telegram:/);
			},
			getInfo: function (url) {
				return Promise.reject(new Error("Not implemented."));
			},
			getStreamURL: function (url) {
				return getFile(url.replace(/^telegram:/, ''));
			}
		});
	});
};