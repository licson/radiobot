import { Bot, GrammyError } from "grammy";
import { PlatformInterface } from "../interface.js";
import { ChatSource } from "../../utils/chat-source.js";

const AUDIO_EXTENSIONS = /\.(mp3|aac|m4a|ogg|flac|asf|wma|opus)$/i;
const URL_REGEX = /^https?:\/\/[^\s]+$/;

export class TelegramPlatform extends PlatformInterface {
  static name = "telegram";

  constructor(radio, config, logger) {
    super(radio, config, logger);
    this.bot = null;
    this.playListMessage = null;
    this.fileCache = new Map();
    this.cacheTimers = new Map();
  }

  async start() {
    if (!this.config.telegram?.token) {
      this.logger.warn("[Telegram] Missing bot token. Module will not load.");
      return;
    }

    const token = this.config.telegram.token;
    if (!/^\d+:[a-zA-Z0-9\-_]+$/.test(token)) {
      this.logger.warn("[Telegram] Invalid token format. Module will not load.");
      return;
    }

    this.bot = new Bot(token);

    if (this.config.telegram.apiServer) {
      this.bot.api.config.use((prev, method, payload, signal) => {
        const url = new URL(this.config.telegram.apiServer);
        return prev(url.origin + url.pathname, method, payload, signal);
      });
    }

    this.setupHandlers();
    this.setupEventListeners();

    await this.bot.start({
      onStart: () => {
        this.connected = true;
        this.logger.log("[Telegram] Bot started successfully");
      }
    });

    if (this.config.telegram.playList) {
      await this.initPlayList();
    }
  }

  async stop() {
    if (this.bot) {
      this.bot.stop();
      this.connected = false;
    }

    for (const timer of this.cacheTimers.values()) {
      clearTimeout(timer);
    }
    this.cacheTimers.clear();
    this.fileCache.clear();
  }

  setupHandlers() {
    this.bot.command("start", async ctx => {
      const message = this.config.telegram.startMessage || "Welcome to RadioBot!";
      await ctx.reply(message, { reply_parameters: { message_id: ctx.message.message_id } });
    });

    this.bot.command("queue", async ctx => {
      const queueLength = this.radio.queue?.length || 0;
      const busy = queueLength >= (this.config.queueSize || 10);
      const text = `There are ${queueLength} songs in the queue. ${busy ? "I'm quite busy right now, please find me again after, like, 30 minutes." : ""}`;
      await ctx.reply(text, { reply_parameters: { message_id: ctx.message.message_id } });
    });

    this.bot.command("list", async ctx => {
      const songList = this.radio.songList || [];
      const text = this.getSongListText(songList);
      await ctx.reply(text, { reply_parameters: { message_id: ctx.message.message_id } });
    });

    this.bot.command("play_list", async ctx => {
      let text = this.getPlayListText();
      if (text.length >= 3966) {
        text = `${text.substring(0, 3965)}...\nThe playlist is longer than what Telegram is allowed to show.`;
      }
      await ctx.reply(text, { reply_parameters: { message_id: ctx.message.message_id } });
    });

    this.bot.command("skip", async ctx => {
      if (!this.isAdminTelegram(ctx.from?.username)) return;

      const queue = this.radio.queue;
      if (queue?.currentTask) {
        queue.remove(queue.currentTask);
      }
      queue?.signal("stop");
      await ctx.reply("The current song will stop and be removed shortly.", {
        reply_parameters: { message_id: ctx.message.message_id }
      });
    });

    this.bot.command("next", async ctx => {
      if (!this.isAdminTelegram(ctx.from?.username)) return;

      this.radio.queue?.signal("stop");
      await ctx.reply("The next song will start shortly.", {
        reply_parameters: { message_id: ctx.message.message_id }
      });
    });

    this.bot.command("tts", async ctx => {
      if (!this.isAdminTelegram(ctx.from?.username)) return;

      const speech = ctx.message.text.split(/\s/).slice(1)
.join(" ");
      if (speech) {
        this.radio.doTTS?.(speech);
        await ctx.reply("The text will be played shortly.", {
          reply_parameters: { message_id: ctx.message.message_id }
        });
      }
    });

    this.bot.command("volume", async ctx => {
      if (!this.isAdminTelegram(ctx.from?.username)) return;

      const args = ctx.message.text.split(/\s/);
      const volume = this.radio.volume || {};

      if (args.length !== 3 || volume[args[1]] === undefined) {
        return ctx.reply(`usage: /volume ${Object.keys(volume).join("|")} {newVolume}`, {
          reply_parameters: { message_id: ctx.message.message_id }
        });
      }

      const newVolume = parseFloat(args[2]);
      if (isNaN(newVolume) || newVolume > 1 || newVolume < 0) {
        return ctx.reply("Volume must be a number between 0 and 1", {
          reply_parameters: { message_id: ctx.message.message_id }
        });
      }

      this.logger.log(`[Telegram] Volume of ${args[1]}: ${newVolume * 100}%.`);
      volume[args[1]] = newVolume;

      this.radio.mixer?.getSources(args[1])?.forEach(source => {
        source.fadeTo(newVolume, 2000);
      });

      await ctx.reply(`Volume for type ${args[1]} has been set to ${newVolume}.`, {
        reply_parameters: { message_id: ctx.message.message_id }
      });
    });

    this.bot.hears(/\/song_([1-9]\d*)/, async ctx => {
      const index = parseInt(ctx.match[1], 10) - 1;
      const songList = this.radio.songList || [];

      if (!songList[index]) return;

      if (this.isQueueFull()) {
        return ctx.reply("I'm quite busy playing songs right now, please find me again after, like, 30 minutes.", {
          reply_parameters: { message_id: ctx.message.message_id }
        });
      }

      const song = songList[index];
      const name = ctx.from.first_name;
      const username = ctx.from.username;

      let ttsText = `Next song is from ${song.name}, picked up by ${name} on Telegram.`;
      let title = `Song picked up by ${name}.`;

      if (song.title && song.artist) {
        this.logger.log(
          `${new Date().toLocaleTimeString()} ${name}(${username}): (from Song List) [${song.artist} - ${song.title}] (${song.file})`
        );
        ttsText = `Next song is ${song.title} performed by ${song.artist} from ${song.name}, picked up by ${name} on Telegram.`;
        title = `${song.title} - ${song.artist}`;
      } else {
        this.logger.log(`${new Date().toLocaleTimeString()} ${name}(${username}): (${song.file})`);
      }

      const chatOrigin = ChatSource.create({
        type: "telegram",
        generalName: `${name} on Telegram`,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id
      });

      if (song.chatOrigin?.original) {
        chatOrigin.original = song.chatOrigin.original;
      } else if (song.chatOrigin) {
        chatOrigin.original = song.chatOrigin;
      }

      this.radio.doQueueSong?.("telegram:" + song.file, title, ttsText, chatOrigin);
    });

    this.bot.on("message:audio", async ctx => {
      if (this.isQueueFull()) {
        return ctx.reply("I'm quite busy playing songs right now, please find me again after, like, 30 minutes.", {
          reply_parameters: { message_id: ctx.message.message_id }
        });
      }

      const audio = ctx.message.audio;
      const name = ctx.from.first_name;
      const username = ctx.from.username;

      const title = audio.title || ctx.message.caption || null;
      const artist = audio.performer || null;

      let ttsText = `Next song is from ${name} on Telegram.`;
      let titleText = `Song from ${name}.`;

      if (artist && title) {
        ttsText = `Next is ${title} performed by ${artist} from ${name} on Telegram.`;
        titleText = `${title} - ${artist}`;
        this.logger.log(
          `${new Date().toLocaleTimeString()} ${name}(${username}): [${artist} - ${title}] (${audio.file_id})`
        );
      } else if (title) {
        titleText = `Song: ${title}`;
        this.logger.log(`${new Date().toLocaleTimeString()} ${name}(${username}): [${title}] (${audio.file_id})`);
      } else {
        this.logger.log(`${new Date().toLocaleTimeString()} ${name}(${username}): (${audio.file_id})`);
      }

      const chatOrigin = ChatSource.create({
        type: "telegram",
        generalName: `${name} on Telegram`,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id
      });

      this.radio.doQueueSong?.("telegram:" + audio.file_id, titleText, ttsText, chatOrigin);
      this.radio.addToSongList?.("telegram:" + audio.file_id, name, title, artist, chatOrigin);
    });

    this.bot.on("message:document", async ctx => {
      const doc = ctx.message.document;
      if (!AUDIO_EXTENSIONS.test(doc.file_name)) {
        return ctx.reply("I don't know these formats.", { reply_parameters: { message_id: ctx.message.message_id } });
      }

      if (this.isQueueFull()) {
        return ctx.reply("I'm quite busy playing songs right now, please find me again after, like, 30 minutes.", {
          reply_parameters: { message_id: ctx.message.message_id }
        });
      }

      const name = ctx.from.first_name;
      const username = ctx.from.username;

      this.logger.log(`${new Date().toLocaleTimeString()} ${name}(${username}): [${doc.file_name}](${doc.file_id})`);

      try {
        const url = await this.getFileUrl(doc.file_id);
        const info = await this.getMediaInfo(url);

        let ttsText = `Next song is from ${name} on Telegram.`;
        let titleText = `Song from ${name}.`;

        if (info.title && info.artist) {
          ttsText = `Next is ${info.title} performed by ${info.artist} from ${name} on Telegram.`;
          titleText = `${info.title} - ${info.artist}`;
        } else if (info.title) {
          ttsText = `Next is ${info.title} from ${name} on Telegram.`;
          titleText = `${info.title}`;
        } else if (ctx.message.caption) {
          titleText = `Song: ${ctx.message.caption}`;
        }

        const chatOrigin = ChatSource.create({
          type: "telegram",
          generalName: `${name} on Telegram`,
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id
        });

        if (this.isQueueFull()) {
          return ctx.reply("I'm quite busy playing songs right now, please find me again after, like, 30 minutes.", {
            reply_parameters: { message_id: ctx.message.message_id }
          });
        }

        this.radio.doQueueSong?.("telegram:" + doc.file_id, titleText, ttsText, chatOrigin);
        this.radio.addToSongList?.(
          "telegram:" + doc.file_id,
          name,
          info.title || null,
          info.artist || null,
          chatOrigin
        );
      } catch (err) {
        this.logger.error(`[Telegram] Error processing document: ${err.message}`);
        await ctx.reply("Oops! I couldn't process that file.", {
          reply_parameters: { message_id: ctx.message.message_id }
        });
      }
    });

    this.bot.hears(URL_REGEX, async ctx => {
      const url = ctx.message.text;

      if (this.isQueueFull()) {
        return ctx.reply("I'm quite busy playing songs right now, please find me again after, like, 30 minutes.", {
          reply_parameters: { message_id: ctx.message.message_id }
        });
      }

      const name = ctx.from.first_name;
      const username = ctx.from.username;

      try {
        const handler = this.radio.urlHandlers?.find(url);
        if (!handler) {
          return ctx.reply("I can't handle this URL.", { reply_parameters: { message_id: ctx.message.message_id } });
        }

        const info = await handler.getInfo();

        let ttsText = `Next song is from ${name} on Telegram.`;
        let titleText = `Song from ${name}.`;

        if (info.title && info.artist) {
          this.logger.log(
            `${new Date().toLocaleTimeString()} ${name}(${username}): [${info.artist} - ${info.title}] ${url}`
          );
          ttsText = `Next is ${info.title} performed by ${info.artist} from ${name} on Telegram.`;
          titleText = info.title;
        } else {
          this.logger.log(`${new Date().toLocaleTimeString()} ${name}(${username}): ${url}`);
        }

        const chatOrigin = ChatSource.create({
          type: "telegram",
          generalName: `${name} on Telegram`,
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id
        });

        if (this.isQueueFull()) {
          return ctx.reply("I'm quite busy playing songs right now, please find me again after, like, 30 minutes.", {
            reply_parameters: { message_id: ctx.message.message_id }
          });
        }

        this.radio.doQueueSong?.(url, titleText, ttsText, chatOrigin);
        this.radio.addToSongList?.(url, name, info.title || null, info.artist || null, chatOrigin);
      } catch (err) {
        this.logger.error(`[Telegram] Error fetching URL: ${err.message}`);
        await ctx.reply("Problems encountered when trying to fetch your song. Please try again later.", {
          reply_parameters: { message_id: ctx.message.message_id }
        });
      }
    });
  }

  setupEventListeners() {
    if (this.radio.events) {
      this.radio.events.on("metadata", async title => {
        // Update playlist on metadata change if needed
      });

      this.radio.events.on("text_message", async (chatOrigin, text) => {
        if (chatOrigin?.type === "telegram") {
          await this.sendMessage(chatOrigin, text);
        }
      });

      this.radio.events.on("song_order_success", async chatOrigin => {
        if (chatOrigin?.type === "telegram") {
          await this.sendReply(
            chatOrigin,
            "Your music is scheduled to play. Use /queue to see how many songs you need to wait."
          );
        }
      });

      this.radio.events.on("do_queue_song", async (chatOrigin, file, title) => {
        if (this.config.telegram.logForward && chatOrigin) {
          const original = chatOrigin.original || chatOrigin;
          if (original.type === "telegram") {
            try {
              await this.bot.api.forwardMessage(this.config.telegram.logForward, original.chatId, original.messageId, {
                disable_notification: true
              });
              await this.bot.api.sendMessage(this.config.telegram.logForward, `Song from ${chatOrigin.generalName}`);
            } catch (err) {
              this.logger.error(`[Telegram] Failed forwarding message: ${err.message}`);
            }
          } else {
            const text = `${file.startsWith("http") ? file + "\n" : ""}${title}\nOrdered by ${chatOrigin.generalName}`;
            await this.bot.api.sendMessage(this.config.telegram.logForward, text);
          }
        }
      });

      if (this.config.telegram.playList) {
        this.radio.events.on("queue_push", () => this.updatePlayList());
        this.radio.events.on("queue_next", () => this.updatePlayList());
      }
    }
  }

  isAdminTelegram(username) {
    if (!username) return false;
    const admins = this.config.telegram?.admin || [];
    return admins.includes(username);
  }

  isAdmin(chatOrigin) {
    return false;
  }

  async getFileUrl(fileId) {
    const file = await this.bot.api.getFile(fileId);
    const basePath = this.config.telegram.apiServer || "https://api.telegram.org";
    return `${basePath}/file/bot${this.config.telegram.token}/${file.file_path}`;
  }

  async getMediaInfo(url) {
    if (this.radio.getMediaInfo) {
      return this.radio.getMediaInfo(url);
    }
    return { title: null, artist: null };
  }

  async initPlayList() {
    try {
      const text = this.getPlayListText();
      const message = await this.bot.api.sendMessage(this.config.telegram.playList, text);
      this.playListMessage = message;
    } catch (err) {
      this.logger.error(`[Telegram] Failed to initialize playlist: ${err.message}`);
    }
  }

  async updatePlayList() {
    if (!this.playListMessage) return;

    try {
      const text = `${this.getPlayListText()}\n\n* Updated at ${new Date().toLocaleTimeString()}.`;
      await this.bot.api.editMessageText(this.playListMessage.chat.id, this.playListMessage.message_id, text);
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 400) {
        try {
          const message = await this.bot.api.sendMessage(this.config.telegram.playList, this.getPlayListText());
          this.playListMessage = message;
        } catch (e) {
          this.logger.error(`[Telegram] Failed to recreate playlist: ${e.message}`);
        }
      }
    }
  }

  async sendMessage(chatOrigin, text) {
    if (!chatOrigin?.chatId) return;

    try {
      await this.bot.api.sendMessage(chatOrigin.chatId, text);
    } catch (err) {
      this.logger.error(`[Telegram] Failed to send message: ${err.message}`);
    }
  }

  async sendReply(chatOrigin, text) {
    if (!chatOrigin?.chatId || !chatOrigin?.messageId) return;

    try {
      await this.bot.api.sendMessage(chatOrigin.chatId, text, {
        reply_parameters: { message_id: chatOrigin.messageId }
      });
    } catch (err) {
      this.logger.error(`[Telegram] Failed to send reply: ${err.message}`);
    }
  }

  async getTelegramFileStream(fileId) {
    const tmpdir = await import("os").then(m => m.tmpdir());
    const { createWriteStream } = await import("fs");
    const { pipeline } = await import("stream/promises");

    const cachePath = `${tmpdir()}/${fileId}.cached`;

    if (this.fileCache.has(fileId)) {
      return cachePath;
    }

    const url = await this.getFileUrl(fileId);

    const { request } = await import("undici");
    const response = await request(url);

    await pipeline(response.body, createWriteStream(cachePath));

    this.fileCache.set(fileId, cachePath);

    if (this.cacheTimers.has(fileId)) {
      clearTimeout(this.cacheTimers.get(fileId));
    }

    this.cacheTimers.set(
      fileId,
      setTimeout(() => {
        import("fs").then(fs => fs.unlink(cachePath, () => {}));
        this.fileCache.delete(fileId);
        this.cacheTimers.delete(fileId);
      }, 3600000)
    );

    return cachePath;
  }
}

export default TelegramPlatform;
