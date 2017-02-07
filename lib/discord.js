module.exports = function (bridge) {
	bridge.allOnce(['config', 'makeLog', 'URLHandlers', 'queue', 'doQueueSong', 'songList', 'addToSongList', 'doTTS', 'mixer', 'volume'], function (config, makeLog, URLHandlers, queue, doQueueSong, songList, addToSongList, doTTS, mixer, volume) {
		if (!config.discord.token) {
			console.warn('[Discord Bot] [Error] Missing bot token! The discord module will not load.');
			return;
		}
		
		const Discord = require('discord.js');
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
							var dispatcher = connection.playConvertedStream(mixer);
							
							if (config.debug) {
								dispatcher.on('debug', function (str) {
									console.log(`[Discord bot] debug: ${str}`);
								});
							}
						});
					}
				});
				
			});
		}
		
		client.on('message', function (message) {
			if (message.channel.type !== 'dm') return;
			if (message.content === 'ping') {
				message.reply('pong');
			}
		});
		
		client.login(config.discord.token);
	});
};