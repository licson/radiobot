import { spawn } from "child_process";
import { SourceInterface } from "../interface.js";

const SOUNDCLOUD_REGEX = /^https?:\/\/(?:www\.)?soundcloud\.com\/[\w-]+\/[\w-]+/;

export class SoundCloudSource extends SourceInterface {
  static name = "soundcloud";

  constructor(config, logger) {
    super(config, logger);
    this.ytdlpPath = config?.ytdlpPath || "yt-dlp";
  }

  canHandle(url) {
    if (!url || typeof url !== "string") return false;
    return SOUNDCLOUD_REGEX.test(url);
  }

  async execYtdlp(args, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ytdlpPath, args, {
        timeout,
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", data => {
        stdout += data.toString();
      });

      proc.stderr.on("data", data => {
        stderr += data.toString();
      });

      proc.on("error", err => {
        reject(new Error(`yt-dlp failed: ${err.message}`));
      });

      proc.on("close", code => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
        }
      });
    });
  }

  async getInfo(url) {
    try {
      const output = await this.execYtdlp(["--dump-json", "--no-download", "--no-playlist", url]);

      const info = JSON.parse(output);

      return {
        title: info.title || "Unknown Title",
        artist: info.uploader || info.artist || "Unknown Artist",
        duration: info.duration,
        thumbnail: info.thumbnail
      };
    } catch (err) {
      this.logger.error(`[SoundCloud] Failed to get info: ${err.message}`);
      throw new Error(`Failed to get SoundCloud info: ${err.message}`);
    }
  }

  async getStream(url) {
    try {
      const streamUrl = await this.getStreamURL(url);

      const { request } = await import("undici");
      const response = await request(streamUrl.url);

      return response.body;
    } catch (err) {
      this.logger.error(`[SoundCloud] Failed to get stream: ${err.message}`);
      throw err;
    }
  }

  async getStreamURL(url) {
    try {
      const output = await this.execYtdlp(["--get-url", "--no-playlist", "-f", "bestaudio/best", url]);

      const streamUrl = output.trim();

      if (!streamUrl) {
        throw new Error("No stream URL returned");
      }

      return {
        url: streamUrl,
        format: "audio/mpeg"
      };
    } catch (err) {
      this.logger.error(`[SoundCloud] Failed to get stream URL: ${err.message}`);
      throw new Error(`Failed to get SoundCloud stream URL: ${err.message}`);
    }
  }
}

export default SoundCloudSource;
