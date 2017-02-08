module.exports = function (bridge) {
	bridge.allOnce(['config', 'makeLog', 'URLHandlers', 'queue', 'doQueueSong', 'songList', 'addToSongList', 'doTTS', 'mixer', 'volume'], function (config, makeLog, URLHandlers, queue, doQueueSong, songList, addToSongList, doTTS, mixer, volume) {
		if (!config.discord.token) {
			console.warn('[Discord Bot] Missing bot token! The discord module will not load.');
			return;
		}
		
		const Discord = require('discord.js');
		const urlRegex = require('url-regex');
		const fixPathname = require("../utils/fix_pathname");
		const Promise = require('bluebird');
		const log = makeLog('discord.log');
		const ChatSource = require('../utils/chat_source');
		
		var client = new Discord.Client();
		var logChannels = [];
		
		client.once('ready', function () {
			var message = "[Discord Bot] connected!\r\n";
			
			client.guilds.array().forEach(function (guild) {
				message += `\tGuild ${guild.name} ( ${guild.id} )\r\n`;
				
				message += `\tChannels:\r\n`;
				guild.channels.array().forEach(function (channel) {
					message += `\t${channel.name} ( ${channel.id}, ${channel.type} )\r\n`;
				});
				
				message += `\tUsers:\r\n`;
				guild.members.array().forEach(function (user) {
					message += `\t${user.displayName || user.nickname} ( ${user.id} )\r\n`;
				});
			});
			
			message.replace(/\r\n$/, '');
			
			console.log(message);
			
			startAudioAndLog(client, config.discord);
		});
		
		function startAudioAndLog(clinet, config) {
			logChannels = [];
			client.guilds.array().forEach(function (guild) {
				if (!config.guild[guild.id]) {
					return;
				}
				
				var guildConfig = config.guild[guild.id];
				
				guild.channels.array().forEach(function (channel) {
					if (guildConfig.logForward === channel.id && channel.type === "text") {
						logChannels.push(channel);
					}
					
					if (guildConfig.audioChannel === channel.id && channel.type === "voice") {
						if (mixer.sampleRate !== 48000) {
							console.log(`[Discord Bot] Discord requires output sample rate to be 48000, but actually got ${mixer.sampleRate}.`);
							return;
						}
						
						if (mixer.channel !== 2) {
							console.log(`[Discord Bot] Discord requires output to be stereo , but actually got ${mixer.channel} channel.`);
							return;
						}
						
						channel.join().then(function (connection) {
							var dispatcher = connection.playConvertedStream(mixer, config.streamOptions);
							
							if (config.debug) {
								dispatcher.on('debug', function (str) {
									console.log(`[Discord bot] debug: ${str}`);
								});
							}
						}).catch(function (err) {
							console.error('[Discord bot] fail to connect to audio channel', err);
						});
					}
				});
				
			});
		}
		
		client.on('message', function (message) {
			if (message.channel.type !== 'dm') return;
			
			if (message.content === 'ping') {
				return message.reply('pong');
			}
			
			textHandlers.forEach(function (handler) {
				if (!handler.regex) {
					return handler.cb(message);
				}
				
				var result = handler.regex.exec(message.content);
				
				if (result) {
					handler.cb(message, result);
				}
			})
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
		
		handle(urlRegex({ exact: true }), function (message) {
			var text = message.content;
			var name = message.author.username;
			var userId = message.author.id;
			
			if (queue.length >= config.queueSize) {
				message.author.sendMessage("I'm quite busy playing songs right now, please find me again after, like, 30 minutes.")
				.catch(function (err) {
					console.log(`[Discord bot] cannot send message to ${name} ( ${userId} ) due to ${err.toString()}`);
				});
				return;
			}
			
			text = fixPathname(text);
			URLHandlers.find(text).getInfo().then(function (info) {
				var ttsText = `Next song is from ${name} on Telegram.`;
				var titleText = `Song from ${name}.`;
				
				if (info.title && info.artist) {
					log(`${new Date().toLocaleTimeString()} ${name}(${userId}): [${info.artist} - ${info.title}] ${text}`);
					ttsText = `Next is ${info.title} performed by ${info.artist} from ${name} on Telegram.`;
					titleText = info.title;
				} else {
					log(`${new Date().toLocaleTimeString()} ${name}(${userId}): ${text}`);
				}
				
				var chatOrigin = ChatSource({
					type: 'discord',
					generalName: `${ name } on Discord`,
					user_id: userId
				});
				
				doQueueSong(text, titleText, ttsText, chatOrigin);
				addToSongList(text, name, info.title || null, info.artist || null, chatOrigin);
			}).catch(function (err) {
				message.author.sendMessage(`Sorry, there is some error with your url, and it isn't scheduled.\n${ err.toString() }`)
				.catch(function (err) {
					console.log(`[Discord bot] cannot send message to ${ name } ( ${ userId } ) due to ${ err.toString() }`);
				});
				
				console.log('[Song Queue] Cannot fetch from url, %s', err.toString());
			});
		});
		
		bridge.on('text_message', function (chatOrigin, text) {
			if (!chatOrigin) return;
			
			if (chatOrigin.type !== 'discord') {
				return;
			}
			
			client.fetchUser(chatOrigin.user_id).then(function (user) {
				return user.sendMessage(text);
			}).catch(function (err) {
				console.log(`[Discord bot] cannot send message to ${ chatOrigin.user_id } due to ${ err.toString() }`);
			});
		});
		
		bridge.on('do_queue_song', function(chatOrigin, file, title, ttsText) {
			if (!chatOrigin) return;
			
			logChannels.forEach(function (channel) {
				if (config.discord.debug) {
					console.log(`[Discord bot] debug: sending message to ${ channel.id }`);
				}
				channel.sendMessage(`${ file.slice(0,4) === 'http' ? file + '\r\n' : '' }Title: ${title} \r\nOrdered by ${chatOrigin.generalName}`)
				.catch(function (e) {
					console.warn('[Discord Bot] Failed sending message! %s', e);
				});
			});
		});
		
		client.login(config.discord.token);
	});
};