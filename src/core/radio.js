import { spawn } from 'child_process';
import EventEmitter from 'events';
import { MixerStream } from './mixer/index.js';
import { Queue, mergeTasks } from './queue/index.js';
import { SourceManager } from '../sources/manager.js';
import { saveQueue, loadQueue, createFileAppender } from './persistence.js';

const MAX_RETRIES = 10;
const RETRY_INTERVAL = 10000;
const MAX_SONG_DURATION = 900;

class RadioBot {
  #mixer;
  #queue;
  #events;
  #sourceManager;
  #config;
  #logger;
  #volume;
  #songList;
  #playerLog;
  #opusStream;

  constructor(config, logger) {
    this.#config = config;
    this.#logger = logger;

    this.#mixer = new MixerStream({
      bitDepth: config.mixer.bitDepth,
      channels: config.mixer.channels,
      sampleRate: config.mixer.sampleRate,
      useNative: config.mixer.useNative
    });

    this.#queue = new Queue(config.loopSize || 20, {
      JSONToTask: info => this.#jsonToTask(info),
      taskToJSON: (_, info) => info
    });

    this.#events = new EventEmitter();
    this.#events.setMaxListeners(50);

    this.#sourceManager = new SourceManager(config, logger, null);

    this.#volume = {
      song: 1,
      tcp: 1,
      microphone: 1
    };

    this.#songList = [];

    this.#playerLog = createFileAppender('player.log');

    this.#setupMixerHandlers();
    this.#setupQueueHandlers();
  }

  #setupMixerHandlers() {
    this.#mixer.on('new_track', track => {
      track.setVolume(0);

      if (track.is('song')) {
        track.fadeTo(this.#volume.song, 1000);
      } else if (track.is('tcp')) {
        track.fadeTo(this.#volume.tcp, 1000);
      } else if (track.is('microphone')) {
        track.fadeTo(this.#volume.microphone, 1000);
      } else {
        track.setVolume(1);
        this.#logger.warn(`[Mixer] Unknown track type: ${track.labels.join(', ')}`);
      }
    });
  }

  #setupQueueHandlers() {
    this.#queue.on('error', (err, task, info) => {
      this.#logger.error(`[Queue] Item '${info?.title}' removed:`, err.message || err);
    });

    this.#queue.on('next', (task, info) => {
      saveQueue(this.#queue);
      this.#playerLog(`${new Date().toLocaleTimeString()}: playing ${info?.title || 'unknown'}`);
      this.#events.emit('queue_next', info);
    });

    this.#queue.on('remove', (task, info, error) => {
      if (error) {
        this.#playerLog(
          `${new Date().toLocaleTimeString()}: removing ${info?.title || 'unknown'} due to ${error.toString()}`
        );
      }
      this.#events.emit('queue_remove', info, error);
    });

    this.#queue.on('push', (task, info) => {
      saveQueue(this.#queue);
      this.#playerLog(`${new Date().toLocaleTimeString()}: adding ${info?.title || 'unknown'}`);
      this.#events.emit('queue_push', info);
    });

    this.#queue.on('unshift', () => {
      saveQueue(this.#queue);
      this.#events.emit('queue_unshift');
    });
  }

  #jsonToTask(info) {
    if (info.type === 'doQueueSong') {
      return {
        task: mergeTasks(this.#doTTS(info.ttsText), this.#doBroadcast(info.file, info.chatOrigin, info.title)),
        info
      };
    }

    if (info.type === 'Advertisment') {
      return {
        task: async cb => {
          this.#events.emit('metadata', info.title);
          return this.#doTTS(info.text)(cb);
        },
        info
      };
    }

    return {
      task: async () => {
        throw new Error(`not_implemented_type_${info.type}`);
      },
      info
    };
  }

  async #getFileWithRetry(file) {
    let lastError;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const handler = this.#sourceManager.find(file);
        if (!handler) {
          throw new Error('No handler found for file');
        }
        return await handler.getStreamURL();
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
        }
      }
    }

    throw lastError;
  }

  #doBroadcast(file, chatOrigin, title) {
    return async cb => {
      let ffmpeg = null;
      let cancelled = false;
      let source = null;

      const cleanup = () => {
        if (ffmpeg) {
          ffmpeg.stderr.unpipe(process.stderr);
        }
      };

      this.#getFileWithRetry(file)
        .then(url => {
          if (cancelled) {
            cleanup();
            cb(null);
            return;
          }

          ffmpeg = spawn('ffmpeg', [
            '-v',
            '-8',
            '-re',
            '-i',
            url,
            '-ac',
            String(this.#config.mixer.channels),
            '-ar',
            String(this.#config.mixer.sampleRate),
            '-c:a',
            'pcm_s16le',
            '-t',
            String(MAX_SONG_DURATION),
            '-f',
            's16le',
            '-'
          ]);

          ffmpeg.stderr.pipe(process.stderr, { end: false });

          source = this.#mixer.addSource(ffmpeg.stdout, ['song']);

          if (title) {
            this.#events.emit('metadata', title);
          }

          source.on('remove', err => {
            if (err && chatOrigin) {
              this.#events.emit('text_message', chatOrigin, "Oops! There are errors and your song isn't played.");
            }

            process.nextTick(() => {
              if (title) {
                this.#events.emit('metadata', this.#config.station?.name || 'RadioBot');
              }
              cleanup();
              cb(err);
            });
          });

          ffmpeg.on('error', e => {
            cleanup();
            source.setError(e);
          });

          ffmpeg.on('exit', code => {
            cleanup();
            if (code !== 0 && !cancelled) {
              source.setError(new Error(`ffmpeg exited with code ${code}`));
            }
          });
        })
        .catch(e => {
          cleanup();

          if (e?.message?.includes('ENOMEM')) {
            this.#logger.error('[Fatal error] Potential memory leak, suiciding...');
            process.exit(1);
          }

          if (chatOrigin) {
            this.#events.emit('text_message', chatOrigin, "Oops! I can't get the file from origin.");
          }

          this.#logger.error(`[Queue] Cannot fetch file: ${e.message}`);
          cb(e);
        });

      return function stop() {
        cancelled = true;

        if (!ffmpeg) {
          cb(null);
          return;
        }

        ffmpeg.kill('SIGTERM');
      };
    };
  }

  #doTTS(text) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en-GB&client=tw-ob`;
    return this.#doBroadcast(url);
  }

  doQueueSong(file, title, ttsText, chatOrigin) {
    this.#queue.push(mergeTasks(this.#doTTS(ttsText), this.#doBroadcast(file, chatOrigin, title)), {
      uid: file,
      type: 'doQueueSong',
      file,
      title,
      ttsText,
      chatOrigin
    });

    this.#queue.start();

    this.#events.emit('do_queue_song', chatOrigin, file, title, ttsText);
    this.#events.emit('song_order_success', chatOrigin, file, title, ttsText);
  }

  doTTS(text) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en-GB&client=tw-ob`;
    this.#queue.push(this.#doBroadcast(url), {
      uid: `tts_${Date.now()}`,
      type: 'tts',
      text
    });
    this.#queue.start();
  }

  addToSongList(file, name, title, artist, chatOrigin) {
    const maxSize = this.#config.queueSize || 10;

    if (this.#songList.length >= maxSize) {
      this.#songList.splice(0, 1);
    }

    this.#songList.push({
      file,
      name,
      title: title || null,
      artist: artist || null,
      chatOrigin: chatOrigin || null
    });
  }

  async getMediaInfo(url) {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', url]);

      let stdout = '';
      let stderr = '';

      ffprobe.stdout.on('data', data => {
        stdout += data;
      });

      ffprobe.stderr.on('data', data => {
        stderr += data;
      });

      ffprobe.on('close', code => {
        if (code !== 0) {
          reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const info = JSON.parse(stdout);
          resolve(info);
        } catch (err) {
          reject(err);
        }
      });

      ffprobe.on('error', reject);
    });
  }

  async initSources() {
    return this.#sourceManager.init();
  }

  async loadPersistedQueue() {
    return loadQueue(this.#queue);
  }

  startQueue() {
    return this.#queue.start();
  }

  get mixer() {
    return this.#mixer;
  }

  get queue() {
    return this.#queue;
  }

  get events() {
    return this.#events;
  }

  get sourceManager() {
    return this.#sourceManager;
  }

  get urlHandlers() {
    return this.#sourceManager;
  }

  get volume() {
    return this.#volume;
  }

  get songList() {
    return this.#songList;
  }

  setOpusStream(stream) {
    this.#opusStream = stream;
  }

  getRadioContext() {
    return {
      queue: this.#queue,
      mixer: this.#mixer,
      events: this.#events,
      urlHandlers: this.#sourceManager,
      songList: this.#songList,
      volume: this.#volume,
      opusStream: this.#opusStream,
      doQueueSong: (file, title, ttsText, chatOrigin) => this.doQueueSong(file, title, ttsText, chatOrigin),
      doTTS: text => this.doTTS(text),
      addToSongList: (file, name, title, artist, chatOrigin) =>
        this.addToSongList(file, name, title, artist, chatOrigin),
      getMediaInfo: url => this.getMediaInfo(url)
    };
  }
}

export { RadioBot };
export default RadioBot;
