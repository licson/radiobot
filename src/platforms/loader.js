import { TelegramPlatform } from './telegram/index.js';
import { DiscordPlatform } from './discord/index.js';

const BUILTIN_PLATFORMS = {
  telegram: TelegramPlatform,
  discord: DiscordPlatform
};

export class PlatformLoader {
  constructor(radio, config, logger) {
    this.radio = radio;
    this.config = config;
    this.logger = logger;
    this.platforms = new Map();
    this.customPlatforms = new Map();
  }

  register(name, PlatformClass) {
    if (this.customPlatforms.has(name)) {
      throw new Error(`Platform "${name}" is already registered`);
    }
    this.customPlatforms.set(name, PlatformClass);
    this.logger.log(`[PlatformLoader] Registered custom platform: ${name}`);
  }

  async loadPlatform(name) {
    const PlatformClass = this.customPlatforms.get(name) || BUILTIN_PLATFORMS[name];

    if (!PlatformClass) {
      throw new Error(`Unknown platform: ${name}`);
    }

    if (this.platforms.has(name)) {
      this.logger.warn(`[PlatformLoader] Platform "${name}" is already loaded`);
      return this.platforms.get(name);
    }

    const platform = new PlatformClass(this.radio, this.config, this.logger);
    this.platforms.set(name, platform);

    return platform;
  }

  async loadEnabledPlatforms() {
    const enabled = [];

    if (this.config.telegram?.enabled) {
      enabled.push('telegram');
    }

    if (this.config.discord?.enabled) {
      enabled.push('discord');
    }

    for (const name of enabled) {
      try {
        const platform = await this.loadPlatform(name);
        await platform.start();
        this.logger.log(`[PlatformLoader] Started platform: ${name}`);
      } catch (err) {
        this.logger.error(`[PlatformLoader] Failed to load platform "${name}": ${err.message}`);
      }
    }

    return Array.from(this.platforms.keys());
  }

  async stopAll() {
    const stopPromises = [];

    for (const [name, platform] of this.platforms) {
      stopPromises.push(
        platform.stop().catch(err => {
          this.logger.error(`[PlatformLoader] Error stopping platform "${name}": ${err.message}`);
        })
      );
    }

    await Promise.all(stopPromises);
    this.platforms.clear();
  }

  getPlatform(name) {
    return this.platforms.get(name);
  }

  getLoadedPlatforms() {
    return Array.from(this.platforms.keys());
  }

  async broadcast(eventName, ...args) {
    for (const platform of this.platforms.values()) {
      if (platform.connected && platform.radio?.events) {
        platform.radio.events.emit(eventName, ...args);
      }
    }
  }
}

export { BUILTIN_PLATFORMS };
export default PlatformLoader;
