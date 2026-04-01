import { SourceInterface } from '../interface.js';

const HTTP_REGEX = /^https?:\/\//;

export class DefaultSource extends SourceInterface {
  static name = 'default';

  constructor(config, logger) {
    super(config, logger);
  }

  canHandle(url) {
    if (!url || typeof url !== 'string') return false;
    return HTTP_REGEX.test(url);
  }

  async getInfo(url) {
    // Default handler returns minimal info
    return {
      title: 'Unknown Track',
      artist: 'Unknown Artist',
      url: url
    };
  }

  async getStream(url) {
    const { request } = await import('undici');
    const response = await request(url, {
      method: 'GET',
      throwOnError: false
    });

    if (response.statusCode >= 400) {
      throw new Error(`HTTP ${response.statusCode}: Failed to fetch stream`);
    }

    return response.body;
  }

  async getStreamURL(url) {
    return { url, format: 'audio/mpeg' };
  }
}

export default DefaultSource;
