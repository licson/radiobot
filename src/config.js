import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CONFIG_PATH = process.env.RADIOBOT_CONFIG || 'config.json';

const REQUIRED_FIELDS = ['http.port', 'mixer.sampleRate', 'mixer.bitDepth', 'mixer.channels'];

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

function validateConfig(config) {
  const missing = [];

  for (const field of REQUIRED_FIELDS) {
    if (getNestedValue(config, field) === undefined) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required config fields: ${missing.join(', ')}`);
  }

  if (config.http?.port && (config.http.port < 1 || config.http.port > 65535)) {
    throw new Error('http.port must be between 1 and 65535');
  }

  if (config.mixer?.sampleRate && ![8000, 16000, 22050, 44100, 48000].includes(config.mixer.sampleRate)) {
    throw new Error('mixer.sampleRate must be 8000, 16000, 22050, 44100, or 48000');
  }

  if (config.mixer?.bitDepth && ![8, 16, 24, 32].includes(config.mixer.bitDepth)) {
    throw new Error('mixer.bitDepth must be 8, 16, 24, or 32');
  }

  if (config.mixer?.channels && ![1, 2].includes(config.mixer.channels)) {
    throw new Error('mixer.channels must be 1 or 2');
  }

  if (config.telegram?.enabled && !config.telegram?.token) {
    throw new Error('telegram.token is required when telegram is enabled');
  }

  if (config.discord?.enabled && !config.discord?.token) {
    throw new Error('discord.token is required when discord is enabled');
  }
}

function applyDefaults(config) {
  return {
    http: {
      port: 3000,
      host: '0.0.0.0',
      ...config.http
    },
    mixer: {
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      useNative: true,
      ...config.mixer
    },
    ffmpeg: {
      path: 'ffmpeg',
      ...config.ffmpeg
    },
    telegram: {
      enabled: false,
      ...config.telegram
    },
    discord: {
      enabled: false,
      ...config.discord
    },
    analytics: {
      enabled: false,
      ...config.analytics
    },
    ...config
  };
}

export async function loadConfig() {
  const configPath = resolve(CONFIG_PATH);

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const content = await readFile(configPath, 'utf-8');
  let config;

  try {
    config = JSON.parse(content);
  } catch (err) {
    throw new Error(`Invalid JSON in config file: ${err.message}`);
  }

  config = applyDefaults(config);
  validateConfig(config);

  return config;
}

export default { loadConfig };
