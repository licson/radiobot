import { loadConfig } from './config.js';
import { APIServer } from './api/index.js';
import { PlatformLoader } from './platforms/loader.js';
import { RadioBot } from './core/radio.js';
import { FFmpegEncoder } from './core/stream/mp3.js';
import { OpusEncoder } from './core/stream/opus.js';
import { HLSSegmenter } from './core/stream/hls.js';
import { createLogger } from './utils/logger.js';

let config;
let logger;
let radio;
let encoders;
let apiServer;
let platformLoader;
let isShuttingtingDown = false;

async function createEncoders(mixer, cfg) {
  const result = {};

  const mp3 = new FFmpegEncoder({
    sampleRate: cfg.mixer.sampleRate,
    channels: cfg.mixer.channels,
    bitrate: cfg.mp3?.bitrate || 192,
    normalize: cfg.mp3?.normalize || false
  });
  mp3.start(mixer);
  result.mp3 = mp3;

  const opus = new OpusEncoder();
  opus.start(mixer, {
    sampleRate: cfg.mixer.sampleRate,
    channels: cfg.mixer.channels,
    bitrate: cfg.opus?.bitrate || 256
  });
  result.opus = opus;

  if (cfg.hls?.enabled) {
    const hls = new HLSSegmenter({
      sampleRate: cfg.mixer.sampleRate,
      channels: cfg.mixer.channels,
      segmentLength: cfg.hls?.segmentLength || 5,
      segmentListLength: cfg.hls?.segmentListLength || 6
    });
    await hls.start(mixer);
    result.hls = hls;
  }

  return result;
}

function setupGracefulShutdown() {
  const shutdown = async signal => {
    if (isShuttingtingDown) {
      logger.log(`[RadioBot] Already shutting down, ignoring ${signal}...`);
      return;
    }

    isShuttingtingDown = true;
    logger.log(`[RadioBot] Received ${signal}, starting graceful shutdown...`);

    try {
      if (encoders?.mp3) {
        encoders.mp3.stop();
      }
      if (encoders?.opus) {
        encoders.opus.stop();
      }
      if (encoders?.hls) {
        encoders.hls.stop();
      }

      if (radio?.events) {
        radio.events.emit('shutdown');
      }

      if (platformLoader) {
        await platformLoader.stopAll();
      }

      if (apiServer) {
        await apiServer.stop();
      }

      logger.log('[RadioBot] All components stopped');
      process.exit(0);
    } catch (err) {
      logger.error('[RadioBot] Error during shutdown:', err.message);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
  config = await loadConfig();
  logger = createLogger('RadioBot');

  logger.log('[RadioBot] Initializing...');

  radio = new RadioBot(config, logger);

  await radio.initSources();

  encoders = await createEncoders(radio.mixer, config);

  radio.setOpusStream(encoders.opus?.stream || null);

  apiServer = new APIServer();
  apiServer.init({
    config,
    mixer: radio.mixer,
    queue: radio.queue,
    encoders,
    events: radio.events
  });

  const radioContext = radio.getRadioContext();
  platformLoader = new PlatformLoader(radioContext, config, logger);

  await platformLoader.loadEnabledPlatforms();

  await radio.loadPersistedQueue();

  radio.startQueue();

  setupGracefulShutdown();

  await apiServer.start(config.http.port);

  logger.log('[RadioBot] Server started successfully');
}

main().catch(err => {
  const log = logger || console;
  log.error('[RadioBot] Failed to start:', err);
  process.exit(1);
});
