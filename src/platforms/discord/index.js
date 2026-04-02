import { Client, GatewayIntentBits, Events, ActivityType, Partials, ChannelType } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType
} from "@discordjs/voice";
import { PlatformInterface } from "../interface.js";
import { ChatSource } from "../../utils/chat-source.js";

const URL_REGEX = /^https?:\/\/[^\s]+$/;

export class DiscordPlatform extends PlatformInterface {
  static name = "discord";

  constructor(radio, config, logger) {
    super(radio, config, logger);
    this.client = null;
    this.audioPlayer = null;
    this.voiceConnections = new Map();
    this.logChannels = [];
    this.playListChannels = [];
    this.playListMessages = [];
  }

  async start() {
    if (!this.config.discord?.token || !this.config.discord?.enabled) {
      this.logger.warn("[Discord] Missing bot token or module not enabled. Module will not load.");
      return;
    }

    const sampleRate = this.config.mixer?.sampleRate || 44100;
    const channels = this.config.mixer?.channels || 2;

    if (sampleRate !== 48000) {
      this.logger.warn(
        `[Discord] Discord requires 48000Hz sample rate, got ${sampleRate}Hz. Voice streaming disabled.`
      );
    }

    if (channels !== 2) {
      this.logger.warn(`[Discord] Discord requires stereo output, got ${channels} channels. Voice streaming disabled.`);
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
      ],
      partials: [Partials.Channel]
    });

    this.audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: "play"
      }
    });

    this.setupHandlers();
    this.setupEventListeners();

    await this.client.login(this.config.discord.token);
    this.connected = true;
  }

  async stop() {
    for (const connection of this.voiceConnections.values()) {
      connection.destroy();
    }
    this.voiceConnections.clear();

    if (this.audioPlayer) {
      this.audioPlayer.stop();
    }

    if (this.client) {
      this.client.destroy();
      this.connected = false;
    }
  }

  setupHandlers() {
    this.client.once(Events.ClientReady, () => {
      this.logger.log(`[Discord] Connected as ${this.client.user.tag}`);
      this.initGuilds();
    });

    this.client.on(Events.MessageCreate, async message => {
      if (message.channel.type !== ChannelType.DM) return;
      if (message.author.bot) return;

      if (message.content === "ping") {
        return message.reply("pong");
      }

      await this.handleDMCommand(message);
    });
  }

  async handleDMCommand(message) {
    const content = message.content.trim();
    const name = message.author.username;
    const userId = message.author.id;

    if (content === "queue" || content.startsWith("queue ")) {
      const queueLength = this.radio.queue?.length || 0;
      const busy = queueLength >= (this.config.queueSize || 10);
      const text = `There are ${queueLength} songs in the queue. ${busy ? "I'm quite busy right now, please find me again after, like, 30 minutes." : ""}`;
      return this.sendDM(userId, text);
    }

    if (content === "list" || content.startsWith("list ")) {
      const songList = this.radio.songList || [];
      return this.sendDM(userId, this.getSongListText(songList));
    }

    if (content === "play_list" || content.startsWith("play_list ")) {
      return this.sendDM(userId, this.getPlayListText());
    }

    if (content === "skip" || content.startsWith("skip ")) {
      if (!this.isAdminDiscord(userId)) return;

      const queue = this.radio.queue;
      if (queue?.currentTask) {
        queue.remove(queue.currentTask);
      }
      queue?.signal("stop");
      return this.sendDM(userId, "The current song will stop and be removed shortly.");
    }

    if (content === "next" || content.startsWith("next ")) {
      if (!this.isAdminDiscord(userId)) return;

      this.radio.queue?.signal("stop");
      return this.sendDM(userId, "The next song will start shortly.");
    }

    if (content === "tts" || content.startsWith("tts ")) {
      if (!this.isAdminDiscord(userId)) return;

      const speech = content.split(/\s/).slice(1)
.join(" ");
      if (speech) {
        this.radio.doTTS?.(speech);
        return this.sendDM(userId, "The text will be played shortly.");
      }
      return;
    }

    if (content.startsWith("volume ")) {
      if (!this.isAdminDiscord(userId)) return;

      const args = content.split(/\s/);
      const volume = this.radio.volume || {};

      if (args.length !== 3 || volume[args[1]] === undefined) {
        return this.sendDM(userId, `usage: volume ${Object.keys(volume).join("|")} {newVolume}`);
      }

      const newVolume = parseFloat(args[2]);
      if (isNaN(newVolume) || newVolume > 1 || newVolume < 0) {
        return this.sendDM(userId, "Volume must be a number between 0 and 1");
      }

      this.logger.log(`[Discord] Volume of ${args[1]}: ${newVolume * 100}%.`);
      volume[args[1]] = newVolume;

      this.radio.mixer?.getSources(args[1])?.forEach(source => {
        source.fadeTo(newVolume, 2000);
      });

      return this.sendDM(userId, `Volume for type ${args[1]} has been set to ${newVolume}.`);
    }

    if (/^song_([1-9]\d*)$/.test(content.split(/\s/)[0])) {
      const match = content.match(/^song_([1-9]\d*)/);
      const index = parseInt(match[1], 10) - 1;
      const songList = this.radio.songList || [];

      if (!songList[index]) return;

      if (this.isQueueFull()) {
        return this.sendDM(
          userId,
          "I'm quite busy playing songs right now, please find me again after, like, 30 minutes."
        );
      }

      const song = songList[index];
      let ttsText = `Next song is from ${song.name}, picked up by ${name} (${userId}) on Discord.`;
      let title = `Song picked up by ${name}.`;

      if (song.title && song.artist) {
        this.logger.log(
          `${new Date().toLocaleString()} ${name}(${userId}): (from song list) [${song.artist} - ${song.title}] ${song.file}`
        );
        ttsText = `Next song is ${song.title} performed by ${song.artist} from ${song.name}, picked up by ${name} (${userId}) on Discord.`;
        title = `${song.title} - ${song.artist}`;
      } else {
        this.logger.log(`${new Date().toLocaleString()} ${name}(${userId}): (from song list) ${song.file}`);
      }

      const chatOrigin = ChatSource.create({
        type: "discord",
        generalName: `${name} (${userId}) on Discord`,
        userId
      });

      if (song.chatOrigin?.original) {
        chatOrigin.original = song.chatOrigin.original;
      } else if (song.chatOrigin) {
        chatOrigin.original = song.chatOrigin;
      }

      this.radio.doQueueSong?.(song.file, title, ttsText, chatOrigin);
      return;
    }

    if (URL_REGEX.test(content)) {
      await this.handleURL(message, content);
      return;
    }

    if (message.attachments.size > 0) {
      await this.handleAttachments(message);
      return;
    }

    const messages = await message.channel.messages.fetch({ before: message.id, limit: 1 });
    if (messages.size === 0) {
      const startMessage =
        this.config.discord.startMessage || "Welcome to RadioBot! Send me a URL or audio file to queue a song.";
      await this.sendDM(userId, startMessage);
    }
  }

  async handleURL(message, url) {
    const name = message.author.username;
    const userId = message.author.id;

    if (this.isQueueFull()) {
      return this.sendDM(
        userId,
        "I'm quite busy playing songs right now, please find me again after, like, 30 minutes."
      );
    }

    try {
      const handler = this.radio.urlHandlers?.find(url);
      if (!handler) {
        return this.sendDM(userId, "I can't handle this URL.");
      }

      const info = await handler.getInfo();

      let ttsText = `Next song is from ${name} on Discord.`;
      let titleText = `Song from ${name}.`;

      if (info.title && info.artist) {
        this.logger.log(`${new Date().toLocaleString()} ${name}(${userId}): [${info.artist} - ${info.title}] ${url}`);
        ttsText = `Next is ${info.title} performed by ${info.artist} from ${name} on Discord.`;
        titleText = info.title;
      } else {
        this.logger.log(`${new Date().toLocaleString()} ${name}(${userId}): ${url}`);
      }

      const chatOrigin = ChatSource.create({
        type: "discord",
        generalName: `${name} (${userId}) on Discord`,
        userId
      });

      this.radio.doQueueSong?.(url, titleText, ttsText, chatOrigin);
      this.radio.addToSongList?.(url, name, info.title || null, info.artist || null, chatOrigin);
    } catch (err) {
      this.logger.error(`[Discord] Error fetching URL: ${err.message}`);
      await this.sendDM(userId, "Problems encountered when trying to fetch your song. Please try again later.");
    }
  }

  async handleAttachments(message) {
    const name = message.author.username;
    const userId = message.author.id;

    if (this.isQueueFull()) {
      return this.sendDM(
        userId,
        "I'm quite busy playing songs right now, please find me again after, like, 30 minutes."
      );
    }

    for (const attachment of message.attachments.values()) {
      const url = attachment.url;

      try {
        const handler = this.radio.urlHandlers?.find(url);
        if (!handler) continue;

        const info = await handler.getInfo();

        let ttsText = `Next song is from ${name} on Discord.`;
        let titleText = `Song from ${name}.`;

        if (info.title && info.artist) {
          this.logger.log(`${new Date().toLocaleString()} ${name}(${userId}): [${info.artist} - ${info.title}] ${url}`);
          ttsText = `Next is ${info.title} performed by ${info.artist} from ${name} on Discord.`;
          titleText = info.title;
        } else {
          this.logger.log(`${new Date().toLocaleString()} ${name}(${userId}): ${url}`);
        }

        const chatOrigin = ChatSource.create({
          type: "discord",
          generalName: `${name} (${userId}) on Discord`,
          userId
        });

        this.radio.doQueueSong?.(url, titleText, ttsText, chatOrigin);
        this.radio.addToSongList?.(url, name, info.title || null, info.artist || null, chatOrigin);
      } catch (err) {
        this.logger.error(`[Discord] Error processing attachment: ${err.message}`);
      }
    }
  }

  async initGuilds() {
    this.logChannels = [];
    this.playListChannels = [];

    const guildConfig = this.config.discord?.guild || {};

    for (const guild of this.client.guilds.cache.values()) {
      const config = guildConfig[guild.id];
      if (!config) continue;

      for (const channel of guild.channels.cache.values()) {
        if (config.logForward === channel.id && channel.type === ChannelType.GuildText) {
          this.logChannels.push(channel);
        }

        if (config.playList === channel.id && channel.type === ChannelType.GuildText) {
          this.playListChannels.push(channel);
        }

        if (config.audioChannel === channel.id && channel.type === ChannelType.GuildVoice) {
          if (this.config.mixer?.sampleRate === 48000 && this.config.mixer?.channels === 2) {
            this.joinVoiceChannel(channel);
          }
        }
      }
    }

    await this.initPlayLists();

    if (this.radio.events) {
      this.radio.events.on("queue_push", () => this.updatePlayLists());
      this.radio.events.on("queue_next", () => this.updatePlayLists());
    }
  }

  joinVoiceChannel(channel) {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
      this.logger.log(`[Discord] Connected to voice channel ${channel.name} (${channel.id})`);
      connection.subscribe(this.audioPlayer);

      if (this.radio.opusStream) {
        this.playOpusStream(this.radio.opusStream);
        this.logger.log(`[Discord] Started streaming to voice channel ${channel.name}`);
      }
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      this.logger.log(`[Discord] Disconnected from voice channel ${channel.name}`);
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch {
        connection.destroy();
        setTimeout(() => this.joinVoiceChannel(channel), 5000);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.logger.log(`[Discord] Voice connection destroyed for ${channel.name}`);
      this.voiceConnections.delete(channel.id);
    });

    this.voiceConnections.set(channel.id, connection);
    return connection;
  }

  playOpusStream(opusStream) {
    const resource = createAudioResource(opusStream, {
      inputType: StreamType.OggOpus,
      inlineVolume: false
    });

    this.audioPlayer.play(resource);
  }

  async initPlayLists() {
    this.playListMessages = [];

    for (const channel of this.playListChannels) {
      try {
        const messages = await channel.messages.fetch({ limit: 1 });
        const lastMessage = messages.first();

        if (!lastMessage || lastMessage.author.id !== this.client.user.id) {
          const message = await channel.send(this.getPlayListText());
          this.playListMessages.push(message);
        } else {
          this.playListMessages.push(lastMessage);
        }
      } catch (err) {
        this.logger.error(`[Discord] Failed to init playlist in ${channel.name}: ${err.message}`);
      }
    }
  }

  async updatePlayLists() {
    const text = `${this.getPlayListText()}\n\n* Updated at ${new Date().toLocaleTimeString()}.`;

    for (const message of this.playListMessages) {
      try {
        await message.edit(text);
      } catch (err) {
        this.logger.error(`[Discord] Failed to update playlist: ${err.message}`);
      }
    }
  }

  async setNowPlaying(title) {
    if (this.client?.user) {
      this.client.user.setActivity(title, { type: ActivityType.Listening });
    }
  }

  setupEventListeners() {
    if (!this.radio.events) return;

    this.radio.events.on("metadata", async title => {
      await this.setNowPlaying(title);
    });

    this.radio.events.on("text_message", async (chatOrigin, text) => {
      if (chatOrigin?.type === "discord") {
        await this.sendDM(chatOrigin.userId, text);
      }
    });

    this.radio.events.on("song_order_success", async chatOrigin => {
      if (chatOrigin?.type === "discord") {
        await this.sendDM(
          chatOrigin.userId,
          "Your music is scheduled to play. Send `queue` to see how many songs you need to wait."
        );
      }
    });

    this.radio.events.on("do_queue_song", async (chatOrigin, file, title) => {
      for (const channel of this.logChannels) {
        try {
          const text = `${file.startsWith("http") ? file + "\n" : ""}Title: ${title}\nOrdered by ${chatOrigin?.generalName || "Unknown"}`;
          await channel.send(text);
        } catch (err) {
          this.logger.error(`[Discord] Failed to send log message: ${err.message}`);
        }
      }
    });
  }

  isAdminDiscord(userId) {
    const admins = this.config.discord?.admin || [];
    return admins.includes(userId);
  }

  isAdmin(chatOrigin) {
    if (chatOrigin?.type !== "discord") return false;
    return this.isAdminDiscord(chatOrigin.userId);
  }

  async sendDM(userId, text) {
    try {
      const user = await this.client.users.fetch(userId);
      await user.send(text);
    } catch (err) {
      this.logger.error(`[Discord] Failed to send DM to ${userId}: ${err.message}`);
    }
  }

  async sendMessage(chatOrigin, text) {
    if (chatOrigin?.userId) {
      await this.sendDM(chatOrigin.userId, text);
    }
  }

  async sendReply(chatOrigin, text) {
    await this.sendMessage(chatOrigin, text);
  }
}

async function entersState(connection, status, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for state"));
    }, timeout);

    const cleanup = () => {
      clearTimeout(timer);
      connection.off("stateChange", onStateChange);
    };

    const onStateChange = (_, newState) => {
      if (newState.status === status) {
        cleanup();
        resolve();
      }
    };

    connection.on("stateChange", onStateChange);
  });
}

export default DiscordPlatform;
