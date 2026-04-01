import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

describe('Config Loader', () => {
  it('should load and validate config.example.json', async () => {
    const configPath = resolve('config.example.json');
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    expect(config).toBeDefined();
    expect(config.http).toBeDefined();
    expect(config.mixer).toBeDefined();
  });

  it('should have valid mixer defaults in example config', async () => {
    const configPath = resolve('config.example.json');
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    expect([8000, 16000, 22050, 44100, 48000]).toContain(config.mixer?.sampleRate ?? 44100);
    expect([8, 16, 24, 32]).toContain(config.mixer?.bitDepth ?? 16);
    expect([1, 2]).toContain(config.mixer?.channels ?? 2);
  });
});
