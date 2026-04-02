import { YouTubeSource } from "./youtube/index.js";
import { SoundCloudSource } from "./soundcloud/index.js";
import { HTTPSource } from "./http/index.js";
import { TelegramSource } from "./telegram/index.js";
import { DefaultSource } from "./default/index.js";

const BUILTIN_SOURCES = {
  youtube: YouTubeSource,
  soundcloud: SoundCloudSource,
  http: HTTPSource,
  telegram: TelegramSource,
  default: DefaultSource
};

const DEFAULT_ORDER = ["telegram", "youtube", "soundcloud", "http"];

export class SourceManager {
  constructor(config, logger, bot = null) {
    this.config = config;
    this.logger = logger;
    this.bot = bot;
    this.sources = [];
    this.customSources = new Map();
    this.order = config?.sourceOrder || DEFAULT_ORDER;
  }

  register(name, SourceClass) {
    if (this.customSources.has(name)) {
      throw new Error(`Source "${name}" is already registered`);
    }
    this.customSources.set(name, SourceClass);
    this.logger.log(`[SourceManager] Registered custom source: ${name}`);
  }

  setOrder(order) {
    this.order = order;
  }

  async init() {
    this.sources = [];

    for (const name of this.order) {
      const SourceClass = this.customSources.get(name) || BUILTIN_SOURCES[name];

      if (!SourceClass) {
        this.logger.warn(`[SourceManager] Unknown source: ${name}`);
        continue;
      }

      try {
        const source = new SourceClass(this.config, this.logger, this.bot);
        this.sources.push({ name, instance: source });
        this.logger.log(`[SourceManager] Initialized source: ${name}`);
      } catch (err) {
        this.logger.error(`[SourceManager] Failed to init source "${name}": ${err.message}`);
      }
    }

    return this.sources.length;
  }

  find(url) {
    // First try all configured sources
    for (const { name, instance } of this.sources) {
      try {
        if (instance.canHandle(url)) {
          this.logger.debug(`[SourceManager] Matched ${name} for ${url}`);
          return {
            name,
            getInfo: () => instance.getInfo(url),
            getStream: () => instance.getStream(url),
            getStreamURL: () => instance.getStreamURL(url)
          };
        }
      } catch (err) {
        this.logger.warn(`[SourceManager] Error checking ${name}: ${err.message}`);
      }
    }

    // Fallback to default handler for HTTP URLs
    try {
      const defaultSource = new DefaultSource(this.config, this.logger);
      if (defaultSource.canHandle(url)) {
        this.logger.debug(`[SourceManager] Using default handler for ${url}`);
        return {
          name: "default",
          getInfo: () => defaultSource.getInfo(url),
          getStream: () => defaultSource.getStream(url),
          getStreamURL: () => defaultSource.getStreamURL(url)
        };
      }
    } catch (err) {
      this.logger.warn(`[SourceManager] Error with default handler: ${err.message}`);
    }

    return null;
  }

  getSource(name) {
    const found = this.sources.find(s => s.name === name);
    return found?.instance || null;
  }

  setBot(bot) {
    this.bot = bot;
    // Update bot reference for already initialized sources that need it
    for (const { name, instance } of this.sources) {
      if (instance.setBot) {
        instance.setBot(bot);
      }
    }
  }

  getLoadedSources() {
    return this.sources.map(s => s.name);
  }

  async getInfo(url) {
    const handler = this.find(url);
    if (!handler) {
      throw new Error(`No handler found for URL: ${url}`);
    }
    return handler.getInfo();
  }

  async getStream(url) {
    const handler = this.find(url);
    if (!handler) {
      throw new Error(`No handler found for URL: ${url}`);
    }
    return handler.getStream();
  }

  async getStreamURL(url) {
    const handler = this.find(url);
    if (!handler) {
      throw new Error(`No handler found for URL: ${url}`);
    }
    return handler.getStreamURL();
  }
}

export { BUILTIN_SOURCES, DEFAULT_ORDER };
export default SourceManager;
