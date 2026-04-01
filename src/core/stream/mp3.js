import { spawn } from 'child_process';

class FFmpegEncoder {
  #process = null;
  #stdout = null;
  #stdin = null;
  #config;

  constructor(config) {
    this.#config = config;
  }

  start(mixerStream) {
    const { sampleRate, channels, bitrate, normalize } = this.#config;

    this.#process = spawn('ffmpeg', [
      '-f',
      's16le',
      '-ac',
      String(channels),
      '-ar',
      String(sampleRate),
      '-i',
      '-',
      '-c:a',
      'libmp3lame',
      '-ac',
      String(channels),
      '-ar',
      String(sampleRate),
      '-ab',
      `${bitrate}k`,
      '-af',
      normalize ? 'dynaudnorm=f=250:g=15' : 'anull',
      '-bufsize',
      `${bitrate * 2}k`,
      '-f',
      'mp3',
      '-'
    ]);

    this.#stdin = this.#process.stdin;
    this.#stdout = this.#process.stdout;

    this.#process.stderr.resume();
    this.#stdout.resume();

    mixerStream.pipe(this.#stdin);

    this.#process.on('error', err => {
      console.error('[MP3 Encoder] Process error:', err);
    });

    this.#process.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[MP3 Encoder] Process exited with code ${code}, signal ${signal}`);
      }
    });

    return this.#stdout;
  }

  get stream() {
    return this.#stdout;
  }

  stop() {
    if (this.#process) {
      this.#process.kill('SIGTERM');
      this.#process = null;
    }
  }
}

export function createMP3Stream(mixerStream, config) {
  const encoder = new FFmpegEncoder(config);
  return encoder.start(mixerStream);
}

export { FFmpegEncoder };
export default FFmpegEncoder;
