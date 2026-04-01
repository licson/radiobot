import { Innertube } from 'youtubei.js';
import { SourceInterface } from '../interface.js';

const YOUTUBE_REGEX =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const YOUTUBE_SHORTS_REGEX = /^(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/;

export class YouTubeSource extends SourceInterface {
  static name = 'youtube';

  constructor(config, logger) {
    super(config, logger);
    this.yt = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    try {
      this.yt = await Innertube.create({
        lang: 'en',
        location: 'US',
        retrieve_player: false
      });
      this.initialized = true;
    } catch (err) {
      this.logger.error('[YouTube] Failed to initialize Innertube:', err.message);
      throw err;
    }
  }

  canHandle(url) {
    if (!url || typeof url !== 'string') return false;
    return YOUTUBE_REGEX.test(url) || YOUTUBE_SHORTS_REGEX.test(url);
  }

  extractVideoId(url) {
    let match = YOUTUBE_REGEX.exec(url);
    if (match) return match[1];

    match = YOUTUBE_SHORTS_REGEX.exec(url);
    if (match) return match[1];

    return null;
  }

  async getInfo(url) {
    await this.init();

    const videoId = this.extractVideoId(url);
    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    try {
      const info = await this.yt.getInfo(videoId);

      if (info.basic_info?.is_live) {
        throw new Error('Live streams are not supported');
      }

      const title = info.basic_info?.title || 'Unknown Title';
      const artist = info.basic_info?.author || 'Unknown Artist';

      return {
        title,
        artist,
        duration: info.basic_info?.duration,
        videoId
      };
    } catch (err) {
      this.logger.error(`[YouTube] Failed to get info for ${videoId}:`, err.message);
      throw err;
    }
  }

  async getStream(url) {
    await this.init();

    const videoId = this.extractVideoId(url);
    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    try {
      const stream = await this.yt.download(videoId, {
        type: 'audio',
        quality: 'best',
        format: 'mp4'
      });

      return stream;
    } catch (err) {
      this.logger.error(`[YouTube] Failed to get stream for ${videoId}:`, err.message);
      throw err;
    }
  }

  async getStreamURL(url) {
    await this.init();

    const videoId = this.extractVideoId(url);
    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    try {
      const info = await this.yt.getInfo(videoId);

      const audioFormats =
        info.streaming_data?.adaptive_formats?.filter(f => {
          return f.has_audio && !f.has_video;
        }) || [];

      if (audioFormats.length === 0) {
        throw new Error('No audio-only formats available');
      }

      audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      const format = audioFormats[0];
      const streamUrl = format.decipher(this.yt.session.player);

      return {
        url: streamUrl,
        format: format.mime_type,
        bitrate: format.bitrate
      };
    } catch (err) {
      this.logger.error(`[YouTube] Failed to get stream URL for ${videoId}:`, err.message);
      throw err;
    }
  }
}

export default YouTubeSource;
