import { loadConfig } from './config.js';

async function main() {
  try {
    const config = await loadConfig();
    console.log('RadioBot starting...');
    console.log(`HTTP server: http://${config.http.host}:${config.http.port}`);
    console.log(`Mixer: ${config.mixer.sampleRate}Hz, ${config.mixer.bitDepth}bit, ${config.mixer.channels}ch`);
    console.log(`Native mixer: ${config.mixer.useNative ? 'enabled' : 'disabled'}`);
    console.log(`Telegram: ${config.telegram.enabled ? 'enabled' : 'disabled'}`);
    console.log(`Discord: ${config.discord.enabled ? 'enabled' : 'disabled'}`);

    // Placeholder - core modules will be initialized here in later phases
    console.log('RadioBot initialized successfully (Phase 1 placeholder)');
  } catch (err) {
    console.error('Failed to start RadioBot:', err.message);
    process.exit(1);
  }
}

main();
