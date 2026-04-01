import { spawn } from 'child_process';

class OpusEncoder {
  #process = null;
  #stdout = null;
  #stdin = null;

  start(mixerStream, config) {
    const { sampleRate, channels, bitrate } = config;

    this.#process = spawn('ffmpeg', [
      '-v',
      '8',
      '-f',
      's16le',
      '-ac',
      String(channels),
      '-ar',
      String(sampleRate),
      '-i',
      '-',
      '-vn',
      '-map',
      '0:a',
      '-acodec',
      'libopus',
      '-f',
      'data',
      '-sample_fmt',
      's16',
      '-vbr',
      'off',
      '-ar',
      String(sampleRate),
      '-ac',
      String(channels),
      '-ab',
      `${bitrate}k`,
      'pipe:1'
    ]);

    this.#stdin = this.#process.stdin;
    this.#stdout = this.#process.stdout;

    this.#stdout.resume();
    this.#process.stderr.pipe(process.stderr);

    mixerStream.pipe(this.#stdin);

    this.#process.on('error', err => {
      console.error('[Opus Encoder] Process error:', err);
    });

    this.#process.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[Opus Encoder] Process exited with code ${code}, signal ${signal}`);
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

export function createOpusStream(mixerStream, config) {
  const encoder = new OpusEncoder();
  return encoder.start(mixerStream, config);
}

export { OpusEncoder };
export default OpusEncoder;
