import { spawn } from "child_process";
import { mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

class HLSSegmenter {
  #process = null;
  #stdin = null;
  #segmentDir;
  #config;

  constructor(config) {
    this.#config = config;
    this.#segmentDir = join(tmpdir(), "radiobot_hls");
  }

  async start(mixerStream) {
    await mkdir(this.#segmentDir, { recursive: true });

    const { sampleRate, channels, segmentLength, segmentListLength } = this.#config;

    this.#process = spawn(
      "ffmpeg",
      [
        "-f",
        "s16le",
        "-ac",
        String(channels),
        "-ar",
        String(sampleRate),
        "-i",
        "-",
        "-map",
        "0:0",
        "-f",
        "hls",
        "-hls_flags",
        "delete_segments",
        "-hls_time",
        String(segmentLength),
        "-hls_list_size",
        String(segmentListLength),
        "-hls_wrap",
        "100",
        "-start_number",
        "1",
        "-hls_segment_filename",
        "seg_%03d.mp3",
        "live.m3u8"
      ],
      {
        cwd: this.#segmentDir
      }
    );

    this.#stdin = this.#process.stdin;

    mixerStream.pipe(this.#stdin, { end: false });

    this.#process.stdout.resume();
    this.#process.stderr.resume();

    this.#process.on("error", err => {
      console.error("[HLS Segmenter] Process error:", err);
    });

    this.#process.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[HLS Segmenter] Process exited with code ${code}, signal ${signal}`);
      }
    });

    return this.#segmentDir;
  }

  get segmentDir() {
    return this.#segmentDir;
  }

  stop() {
    if (this.#process) {
      this.#process.kill("SIGTERM");
      this.#process = null;
    }
  }
}

export { HLSSegmenter };
export default HLSSegmenter;
