import { spawn } from 'child_process';
import { request } from 'undici';
import { SourceInterface } from '../interface.js';

const AUDIO_EXTENSIONS = /\.(mp3|aac|m4a|ogg|flac|opus|wav|webm)$/i;
const HTTP_REGEX = /^https?:\/\//;

export class HTTPSource extends SourceInterface {
  static name = 'http';

  constructor(config, logger) {
    super(config, logger);
    this.ffprobePath = config?.ffprobePath || 'ffprobe';
    this.timeout = config?.timeout || 10000;
  }

  canHandle(url) {
    if (!url || typeof url !== 'string') return false;
    return HTTP_REGEX.test(url);
  }

  async execFFprobe(url) {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.ffprobePath,
        [
          '-v',
          'error',
          '-of',
          'default=nw=1',
          '-show_entries',
          'stream_tags=title,artist:format_tags=title,artist:format=duration',
          url
        ],
        {
          timeout: this.timeout,
          windowsHide: true
        }
      );

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', data => {
        stdout += data.toString();
      });

      proc.stderr.on('data', data => {
        stderr += data.toString();
      });

      proc.on('error', err => {
        if (err.code === 'ENOENT') {
          reject(new Error('ffprobe not found. Please install ffmpeg.'));
        } else {
          reject(new Error(`ffprobe failed: ${err.message}`));
        }
      });

      proc.on('close', code => {
        if (code === 0) {
          resolve(stdout);
        } else if (code === 1) {
          reject(new Error(`Cannot parse file: ${stderr}`));
        } else if (code === 130) {
          reject(new Error('Fetch timeout'));
        } else {
          resolve('');
        }
      });
    });
  }

  async getInfo(url) {
    try {
      const output = await this.execFFprobe(url);

      if (!output) {
        return {};
      }

      const durationMatch = output.match(/duration=([^\n]+)/i);
      if (durationMatch && durationMatch[1].trim() === 'N/A') {
        throw new Error('Streaming source is not supported');
      }

      const titleMatch = output.match(/TAG:title=([^\n]+)/i);
      const artistMatch = output.match(/TAG:artist=([^\n]+)/i);

      const title = titleMatch?.[1]?.trim();
      const artist = artistMatch?.[1]?.trim();

      if (title && artist) {
        return { title, artist };
      } else if (title) {
        return { title };
      }

      return {};
    } catch (err) {
      this.logger.error(`[HTTP] Failed to get info for ${url}: ${err.message}`);
      throw err;
    }
  }

  async getStream(url) {
    try {
      const response = await request(url, {
        method: 'GET',
        throwOnError: true
      });

      return response.body;
    } catch (err) {
      this.logger.error(`[HTTP] Failed to get stream for ${url}: ${err.message}`);
      throw err;
    }
  }

  async getStreamURL(url) {
    return { url, format: 'audio/mpeg' };
  }
}

export default HTTPSource;
