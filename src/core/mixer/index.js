import { Readable } from 'stream';
import EventEmitter from 'events';

const TABLE_SIZE = 4000;

function generateEasingLookup() {
  const lookup = new Float64Array(TABLE_SIZE);
  for (let i = 0; i < TABLE_SIZE; i++) {
    lookup[i] = Math.pow(i / (TABLE_SIZE - 1), 3);
  }
  return lookup;
}

const readInt24LE = (buf, offset) => {
  const b1 = buf[offset];
  const b2 = buf[offset + 1];
  const b3 = buf[offset + 2];
  return ((b3 & 0x80) << 24) | ((b3 << 16) & 0x7fffff) | ((b2 << 8) & 0xffff) | (b1 & 0xff);
};

const writeInt24LE = (buf, v, offset) => {
  buf[offset] = v & 0xff;
  buf[offset + 1] = (v >> 8) & 0xff;
  buf[offset + 2] = ((v >> 16) & 0xff) | (v < 0 ? 0x80 : 0);
};

const helpers = {
  readValue: {
    8: (buf, offset) => buf.readInt8(offset),
    16: (buf, offset) => buf.readInt16LE(offset),
    24: readInt24LE,
    32: (buf, offset) => buf.readInt32LE(offset)
  },
  writeValue: {
    8: (buf, val, offset) => {
      buf.writeInt8(val, offset);
    },
    16: (buf, val, offset) => {
      buf.writeInt16LE(val, offset);
    },
    24: writeInt24LE,
    32: (buf, val, offset) => {
      buf.writeInt32LE(val, offset);
    }
  }
};

class Source extends EventEmitter {
  constructor(options = {}) {
    super();

    this.labels = options.labels || [];
    this.stream = options.stream || null;
    this.sampleRate = options.sampleRate || 44100;
    this.buffers = [];
    this.length = 0;
    this.total = 0;
    this.volume = options.volume ?? 1;
    this.error = null;
    this.transitionMode = 0;
    this.transitionLength = -1;
    this.transitionCurrent = 0;
    this.transitionFrom = 1;
    this.transitionTo = 1;
    this.ended = false;
  }

  addBuffer(buffer) {
    this.buffers.push(buffer);
    this.length += buffer.length;
    this.total += buffer.length;
  }

  remainingSamples(sampleSize) {
    return Math.floor(this.length / sampleSize);
  }

  setVolume(volume) {
    this.transitionLength = -1;
    this.volume = Math.max(0, Math.min(1, volume));
  }

  fadeTo(volume, durationMs) {
    this.transitionFrom = this.volume;
    this.transitionTo = Math.max(0, Math.min(1, volume));
    this.transitionCurrent = 0;
    this.transitionLength = Math.floor((durationMs / 1000) * this.sampleRate);
  }

  setError(err) {
    if (err) {
      this.error = err;
    }
  }

  is(label) {
    return this.labels.includes(label);
  }
}

class MixerStream extends Readable {
  #easingLookup = generateEasingLookup();
  #loopId = null;
  #nativeMix = null;

  constructor(options = {}) {
    super();

    const bitDepth = options.bitDepth ?? 16;
    const channels = options.channels ?? 2;
    const sampleRate = options.sampleRate ?? 44100;

    if (bitDepth % 8 !== 0) {
      throw new Error('Bit depth must be a multiple of 8');
    }

    this.bitDepth = bitDepth;
    this.channels = channels;
    this.sampleRate = sampleRate;
    this.sampleSize = (bitDepth / 8) * channels;

    this.sources = [];
    this.sampleCount = 0;
    this.started = false;
    this.startTime = null;
    this.paused = true;
    this.fps = options.fps ?? 20;
    this.frame = 0;

    this.segmentLength = Math.floor((sampleRate * this.sampleSize) / this.fps);
    this.segmentLength = Math.floor(this.segmentLength / this.sampleSize) * this.sampleSize;

    this.emptyBuffer = Buffer.alloc(this.segmentLength);
    this.highWaterMark = this.segmentLength * 8;

    this.readValue = helpers.readValue[bitDepth];
    this.writeValue = helpers.writeValue[bitDepth];
    this.maxValue = (1 << (bitDepth - 1)) - 1;

    if (options.useNative !== false) {
      this.#loadNativeMixer();
    }
  }

  #loadNativeMixer() {
    try {
      const binding = require('node-gyp-build')(__dirname);
      if (typeof binding === 'function') {
        this.#nativeMix = binding;
        console.log('[Mixer] Using optimized C++ implementation');
      }
    } catch {
      console.warn('[Mixer] Using JavaScript implementation');
    }
  }

  easing(x, from, to) {
    const clampedX = Math.max(0, Math.min(1, x));
    const i = Math.floor(clampedX * (TABLE_SIZE - 1));
    return from + this.#easingLookup[i] * (to - from);
  }

  _read() {
    if (!this.started) {
      this.#startPolling();
      this.#startLoop();
      this.startTime = Date.now();
      this.started = true;
    }
  }

  #startPolling() {
    this.paused = false;
  }

  #startLoop() {
    this.startTime = Date.now();
    this.frame = 0;

    const tick = () => {
      this.frame++;

      for (const source of this.sources) {
        if (source.length < this.highWaterMark && !source.ended) {
          const chunk = source.stream.read(this.segmentLength * 4);
          if (chunk) {
            source.addBuffer(chunk);
          }
        }
      }

      this.#mergeFrame(this.segmentLength);

      const nextTick = this.startTime + (1000 / this.fps) * this.frame - Date.now();
      this.#loopId = setTimeout(tick, Math.max(0, nextTick));
    };

    this.#loopId = setTimeout(tick, 1000 / this.fps);
    tick();
  }

  #stopLoop() {
    if (this.#loopId) {
      clearTimeout(this.#loopId);
      this.#loopId = null;
    }
  }

  #mergeFrame(length) {
    const buffers = [];

    for (const source of this.sources) {
      if (source.length < length && source.ended) {
        source.buffers.push(Buffer.alloc(length - source.length));
        source.length = length;
      }
    }

    const alignedLength = Math.floor(length / this.sampleSize) * this.sampleSize;

    for (const source of this.sources) {
      if (source.length >= alignedLength) {
        let temp;
        if (source.buffers[0].length >= alignedLength) {
          temp = source.buffers[0];
          buffers.push(temp.subarray(0, alignedLength));
          source.buffers[0] = temp.subarray(alignedLength);
        } else {
          temp = Buffer.concat(source.buffers);
          buffers.push(temp.subarray(0, alignedLength));
          source.buffers = [temp.subarray(alignedLength)];
        }
        source.length -= alignedLength;
      } else {
        buffers.push(this.emptyBuffer);
      }
    }

    const output = this.#nativeMix
      ? this.#nativeMix(buffers, this.sources, alignedLength, this.bitDepth, this.channels)
      : this.#mixJavaScript(buffers, this.sources, alignedLength);

    this.sampleCount += alignedLength / this.sampleSize;
    this.push(output);

    for (let i = this.sources.length - 1; i >= 0; i--) {
      const source = this.sources[i];
      if (source.ended && source.remainingSamples(this.sampleSize) === 0) {
        source.emit('remove', source.error);
        this.sources.splice(i, 1);
        this.emit('remove_track', source);
      }
    }
  }

  #mixJavaScript(buffers, sources, length) {
    const output = Buffer.alloc(length);
    const byteSize = this.bitDepth / 8;

    for (let offset = 0; offset < output.length; offset += byteSize) {
      let value = 0;

      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];

        if (offset % this.sampleSize === 0 && source.transitionLength > 0) {
          source.transitionCurrent++;
          source.volume = this.easing(
            source.transitionCurrent / source.transitionLength,
            source.transitionFrom,
            source.transitionTo
          );

          if (source.transitionCurrent >= source.transitionLength) {
            source.volume = source.transitionTo;
            source.transitionLength = -1;
          }
        }

        const sample = (this.readValue(buffers[i], offset) * source.volume) / this.maxValue;
        value = (1 - Math.abs(value * sample)) * (value + sample);
      }

      value = Math.max(-1, Math.min(1, value)) * this.maxValue;
      this.writeValue(output, Math.trunc(value), offset);
    }

    return output;
  }

  addSource(readable, labels = []) {
    console.log('[Mixer] New track');

    const labelArray = Array.isArray(labels) ? labels : [labels];

    const source = new Source({
      stream: readable,
      sampleRate: this.sampleRate,
      labels: labelArray
    });

    this.sources.push(source);
    this.emit('new_track', source);

    readable.on('end', () => {
      source.ended = true;
    });
    readable.on('close', () => {
      source.ended = true;
    });
    readable.on('error', err => {
      source.error = err;
      source.ended = true;
    });

    const initial = readable.read(this.highWaterMark);
    if (initial) {
      source.addBuffer(initial);
    }

    source.on('remove', () => {
      console.log('[Mixer] Removing track...');
    });

    return source;
  }

  getSources(labels) {
    if (!labels) {
      return this.sources.slice();
    }

    const labelArray = Array.isArray(labels) ? labels : [labels];
    return this.sources.filter(source => labelArray.some(label => source.labels.includes(label)));
  }

  count() {
    return this.sources.length;
  }

  destroy() {
    this.#stopLoop();
    this.push(null);
  }
}

export { MixerStream, Source };
export default MixerStream;
