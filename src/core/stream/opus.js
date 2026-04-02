import { spawn } from "child_process";
import { crc32, findOggPage, rewriteOpusPreSkip } from "./ogg-helpers.js";

class OpusEncoder {
  #process = null;
  #stdout = null;
  #stdin = null;
  #cachedIdHeader = null;
  #cachedCommentHeader = null;
  #headerBuffer = Buffer.alloc(0);
  #headersReady = false;
  #headerListeners = [];

  start(mixerStream, config) {
    const { sampleRate, channels, bitrate } = config;

    this.#process = spawn("ffmpeg", [
      "-v",
      "8",
      "-f",
      "s16le",
      "-ac",
      String(channels),
      "-ar",
      String(sampleRate),
      "-i",
      "-",
      "-ab",
      `${bitrate}k`,
      "-acodec",
      "libopus",
      "-f",
      "ogg",
      "-"
    ]);

    this.#stdin = this.#process.stdin;
    this.#stdout = this.#process.stdout;

    this.#stdout.pause();
    this.#stdout.on("data", this.#captureHeaders.bind(this));
    this.#process.stderr.pipe(process.stderr);

    mixerStream.pipe(this.#stdin);

    this.#process.on("error", err => {
      console.error("[Opus Encoder] Process error:", err);
    });

    this.#process.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[Opus Encoder] Process exited with code ${code}, signal ${signal}`);
      }
    });

    return this.#stdout;
  }

  #captureHeaders(data) {
    this.#headerBuffer = Buffer.concat([this.#headerBuffer, data]);

    const idHeaderPos = findOggPage(this.#headerBuffer, 0);
    const commentHeaderPos = findOggPage(this.#headerBuffer, idHeaderPos + 1);
    const firstAudioPos = findOggPage(this.#headerBuffer, commentHeaderPos + 1);

    if (firstAudioPos < 0) {
      return;
    }

    this.#cachedIdHeader = rewriteOpusPreSkip(this.#headerBuffer.subarray(idHeaderPos, commentHeaderPos), 3840, crc32);
    this.#cachedCommentHeader = this.#headerBuffer.subarray(commentHeaderPos, firstAudioPos);

    this.#headersReady = true;
    this.#stdout.off("data", this.#captureHeaders);
    this.#stdout.resume();

    const pending = this.#headerListeners;
    this.#headerListeners = [];
    for (const fn of pending) {
      fn();
    }

    console.log("[Opus Encoder] Headers captured and cached");
  }

  get idHeader() {
    return this.#cachedIdHeader;
  }

  get commentHeader() {
    return this.#cachedCommentHeader;
  }

  get headersReady() {
    return this.#headersReady;
  }

  onHeadersReady(callback) {
    if (this.#headersReady) {
      callback();
    } else {
      this.#headerListeners.push(callback);
    }
  }

  get stream() {
    return this.#stdout;
  }

  stop() {
    if (this.#process) {
      this.#process.kill("SIGTERM");
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
