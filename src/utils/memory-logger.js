import { appendFile } from 'fs/promises';

class MemoryLogger {
  #enabled = false;
  #interval = 60000;
  #filename = 'memory-usage.log';
  #timer = null;
  #logger = null;

  constructor(config, logger) {
    this.#enabled = config?.debug?.logMemoryUsage || false;
    this.#logger = logger;
  }

  start() {
    if (!this.#enabled) {
      return;
    }

    this.#logger.log(`[MemoryLogger] Starting memory usage logging to ${this.#filename}`);

    // Log initial state
    this.#logMemoryUsage();

    // Set up interval
    this.#timer = setInterval(() => {
      this.#logMemoryUsage();
    }, this.#interval);
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
      this.#logger.log('[MemoryLogger] Stopped memory usage logging');
    }
  }

  async #logMemoryUsage() {
    try {
      const usage = process.memoryUsage();
      const timestamp = new Date().toLocaleString();
      const entries = Object.entries(usage)
        .map(([key, value]) => `${key}: ${this.#formatBytes(value)}`)
        .join(', ');

      const logLine = `${timestamp} - ${entries}\n`;

      await appendFile(this.#filename, logLine, 'utf-8');
    } catch (err) {
      this.#logger.error(`[MemoryLogger] Failed to log memory usage: ${err.message}`);
    }
  }

  #formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

export { MemoryLogger };
export default MemoryLogger;
