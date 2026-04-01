import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { request } from 'undici';
import { SourceInterface } from '../interface.js';

const TELEGRAM_REGEX = /^telegram:(.+)$/;

export class TelegramSource extends SourceInterface {
  static name = 'telegram';

  constructor(config, logger, bot) {
    super(config, logger);
    this.bot = bot;
    this.fileCache = new Map();
    this.cacheTimers = new Map();
    this.cacheTimeout = 3600000;
  }

  canHandle(url) {
    if (!url || typeof url !== 'string') return false;
    return TELEGRAM_REGEX.test(url);
  }

  extractFileId(url) {
    const match = TELEGRAM_REGEX.exec(url);
    return match ? match[1] : null;
  }

  async getFileURL(fileId) {
    if (!this.bot) {
      throw new Error('Telegram bot not configured');
    }

    try {
      const file = await this.bot.api.getFile(fileId);
      const basePath = this.config.telegram?.apiServer || 'https://api.telegram.org';
      return `${basePath}/file/bot${this.config.telegram.token}/${file.file_path}`;
    } catch (err) {
      this.logger.error(`[Telegram] Failed to get file URL: ${err.message}`);
      throw err;
    }
  }

  async getInfo(url) {
    const fileId = this.extractFileId(url);
    if (!fileId) {
      throw new Error('Invalid Telegram file URL');
    }

    return {
      title: `Telegram file: ${fileId}`,
      fileId
    };
  }

  async getStream(url) {
    const cachePath = await this.getCachePath(url);
    const { createReadStream } = await import('fs');
    return createReadStream(cachePath);
  }

  async getStreamURL(url) {
    const fileId = this.extractFileId(url);
    if (!fileId) {
      throw new Error('Invalid Telegram file URL');
    }

    const fileUrl = await this.getFileURL(fileId);
    return { url: fileUrl, format: 'audio/mpeg' };
  }

  async getCachePath(url) {
    const fileId = this.extractFileId(url);
    if (!fileId) {
      throw new Error('Invalid Telegram file URL');
    }

    if (this.fileCache.has(fileId)) {
      return this.fileCache.get(fileId);
    }

    const fileUrl = await this.getFileURL(fileId);
    const cachePath = join(tmpdir(), `${fileId}.cached`);

    try {
      const response = await request(fileUrl);
      const chunks = [];

      for await (const chunk of response.body) {
        chunks.push(chunk);
      }

      await writeFile(cachePath, Buffer.concat(chunks));

      this.fileCache.set(fileId, cachePath);

      if (this.cacheTimers.has(fileId)) {
        clearTimeout(this.cacheTimers.get(fileId));
      }

      this.cacheTimers.set(
        fileId,
        setTimeout(() => {
          unlink(cachePath).catch(() => {});
          this.fileCache.delete(fileId);
          this.cacheTimers.delete(fileId);
        }, this.cacheTimeout)
      );

      return cachePath;
    } catch (err) {
      this.logger.error(`[Telegram] Failed to cache file: ${err.message}`);
      throw new Error(`Failed to download Telegram file: ${err.message}`);
    }
  }

  clearCache() {
    for (const timer of this.cacheTimers.values()) {
      clearTimeout(timer);
    }
    this.cacheTimers.clear();

    const clearPromises = [];
    for (const path of this.fileCache.values()) {
      clearPromises.push(unlink(path).catch(() => {}));
    }
    this.fileCache.clear();

    return Promise.all(clearPromises);
  }
}

export default TelegramSource;
