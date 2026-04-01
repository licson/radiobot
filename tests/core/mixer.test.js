import { describe, it, expect } from 'vitest';
import { MixerStream, Source } from '../../src/core/mixer/index.js';

describe('MixerStream', () => {
  it('should create mixer with default options', () => {
    const mixer = new MixerStream();
    expect(mixer.bitDepth).toBe(16);
    expect(mixer.channels).toBe(2);
    expect(mixer.sampleRate).toBe(44100);
  });

  it('should create mixer with custom options', () => {
    const mixer = new MixerStream({
      bitDepth: 24,
      channels: 1,
      sampleRate: 48000
    });
    expect(mixer.bitDepth).toBe(24);
    expect(mixer.channels).toBe(1);
    expect(mixer.sampleRate).toBe(48000);
  });

  it('should throw for invalid bit depth', () => {
    expect(() => new MixerStream({ bitDepth: 12 })).toThrow('Bit depth must be a multiple of 8');
  });

  it('should have empty sources initially', () => {
    const mixer = new MixerStream();
    expect(mixer.count()).toBe(0);
  });
});

describe('Source', () => {
  it('should create source with default values', () => {
    const source = new Source();
    expect(source.volume).toBe(1);
    expect(source.labels).toEqual([]);
    expect(source.ended).toBe(false);
  });

  it('should create source with custom values', () => {
    const source = new Source({
      volume: 0.5,
      labels: ['music'],
      sampleRate: 48000
    });
    expect(source.volume).toBe(0.5);
    expect(source.labels).toEqual(['music']);
    expect(source.sampleRate).toBe(48000);
  });

  it('should set volume', () => {
    const source = new Source();
    source.setVolume(0.7);
    expect(source.volume).toBe(0.7);
  });

  it('should clamp volume to valid range', () => {
    const source = new Source();
    source.setVolume(1.5);
    expect(source.volume).toBe(1);
    source.setVolume(-0.5);
    expect(source.volume).toBe(0);
  });

  it('should check labels correctly', () => {
    const source = new Source({ labels: ['music', 'ad'] });
    expect(source.is('music')).toBe(true);
    expect(source.is('ad')).toBe(true);
    expect(source.is('jingle')).toBe(false);
  });
});
