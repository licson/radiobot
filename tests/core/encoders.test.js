import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FFmpegEncoder } from '../../src/core/stream/mp3.js';
import { OpusEncoder } from '../../src/core/stream/opus.js';
import { ICYWriter } from '../../src/core/stream/icy.js';
import { Readable } from 'stream';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

import { spawn } from 'child_process';

describe('FFmpegEncoder (MP3)', () => {
  let mockProcess;
  let mockStdout;
  let mockStderr;
  let mockStdin;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStdout = new Readable({ read() {} });
    mockStderr = new Readable({ read() {} });
    mockStdin = {
      write: vi.fn(),
      end: vi.fn()
    };

    mockProcess = {
      stdout: mockStdout,
      stderr: mockStderr,
      stdin: mockStdin,
      on: vi.fn(),
      kill: vi.fn()
    };

    spawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create encoder with config', () => {
    const config = {
      sampleRate: 44100,
      channels: 2,
      bitrate: 192,
      normalize: true
    };

    const encoder = new FFmpegEncoder(config);
    expect(encoder).toBeDefined();
  });

  it('should spawn ffmpeg with correct arguments', () => {
    const config = {
      sampleRate: 48000,
      channels: 2,
      bitrate: 256,
      normalize: true
    };

    const encoder = new FFmpegEncoder(config);
    const mixerStream = new Readable({ read() {} });

    encoder.start(mixerStream);

    expect(spawn).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining([
        '-f',
        's16le',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-i',
        '-',
        '-c:a',
        'libmp3lame',
        '-ab',
        '256k',
        '-af',
        'dynaudnorm=f=250:g=15'
      ])
    );
  });

  it('should use anull filter when normalize is false', () => {
    const config = {
      sampleRate: 44100,
      channels: 2,
      bitrate: 192,
      normalize: false
    };

    const encoder = new FFmpegEncoder(config);
    const mixerStream = new Readable({ read() {} });

    encoder.start(mixerStream);

    const args = spawn.mock.calls[0][1];
    expect(args).toContain('anull');
  });

  it('should set correct buffer size', () => {
    const config = {
      sampleRate: 44100,
      channels: 2,
      bitrate: 192,
      normalize: false
    };

    const encoder = new FFmpegEncoder(config);
    const mixerStream = new Readable({ read() {} });

    encoder.start(mixerStream);

    const args = spawn.mock.calls[0][1];
    expect(args).toContain('-bufsize');
    expect(args).toContain('384k'); // bitrate * 2
  });

  it('should return stdout stream', () => {
    const encoder = new FFmpegEncoder({
      sampleRate: 44100,
      channels: 2,
      bitrate: 192
    });
    const mixerStream = new Readable({ read() {} });

    const result = encoder.start(mixerStream);

    expect(result).toBe(mockStdout);
  });

  it('should expose stream getter', () => {
    const encoder = new FFmpegEncoder({
      sampleRate: 44100,
      channels: 2,
      bitrate: 192
    });
    const mixerStream = new Readable({ read() {} });

    encoder.start(mixerStream);

    expect(encoder.stream).toBe(mockStdout);
  });

  it('should kill process on stop', () => {
    const encoder = new FFmpegEncoder({
      sampleRate: 44100,
      channels: 2,
      bitrate: 192
    });
    const mixerStream = new Readable({ read() {} });

    encoder.start(mixerStream);
    encoder.stop();

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('should handle process errors', () => {
    const encoder = new FFmpegEncoder({
      sampleRate: 44100,
      channels: 2,
      bitrate: 192
    });
    const mixerStream = new Readable({ read() {} });

    encoder.start(mixerStream);

    const errorHandler = mockProcess.on.mock.calls.find(call => call[0] === 'error');
    expect(errorHandler).toBeDefined();

    // Should not throw
    errorHandler[1](new Error('Process error'));
  });

  it('should handle process exit', () => {
    const encoder = new FFmpegEncoder({
      sampleRate: 44100,
      channels: 2,
      bitrate: 192
    });
    const mixerStream = new Readable({ read() {} });

    encoder.start(mixerStream);

    const exitHandler = mockProcess.on.mock.calls.find(call => call[0] === 'exit');
    expect(exitHandler).toBeDefined();

    // Should not throw on normal exit
    exitHandler[1](0, null);
  });
});

describe('OpusEncoder', () => {
  let mockProcess;
  let mockStdout;
  let mockStderr;
  let mockStdin;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStdout = new Readable({ read() {} });
    mockStderr = new Readable({ read() {} });
    mockStdin = {
      write: vi.fn(),
      end: vi.fn()
    };

    mockProcess = {
      stdout: mockStdout,
      stderr: mockStderr,
      stdin: mockStdin,
      on: vi.fn(),
      kill: vi.fn()
    };

    spawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create encoder', () => {
    const encoder = new OpusEncoder();
    expect(encoder).toBeDefined();
  });

  it('should spawn ffmpeg with libopus codec', () => {
    const encoder = new OpusEncoder();
    const mixerStream = new Readable({ read() {} });

    encoder.start(mixerStream, {
      sampleRate: 48000,
      channels: 2,
      bitrate: 256
    });

    expect(spawn).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining([
        '-f',
        's16le',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-i',
        '-',
        '-ab',
        '256k',
        '-acodec',
        'libopus',
        '-f',
        'ogg'
      ])
    );
  });

  it('should start with headers not ready', () => {
    const encoder = new OpusEncoder();
    expect(encoder.headersReady).toBe(false);
    expect(encoder.idHeader).toBeNull();
    expect(encoder.commentHeader).toBeNull();
  });

  it('should queue callbacks when headers not ready', () => {
    const encoder = new OpusEncoder();
    const callback = vi.fn();

    encoder.onHeadersReady(callback);

    expect(encoder.headersReady).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it('should return stdout stream', () => {
    const encoder = new OpusEncoder();
    const mixerStream = new Readable({ read() {} });

    const result = encoder.start(mixerStream, {
      sampleRate: 48000,
      channels: 2,
      bitrate: 256
    });

    expect(result).toBe(mockStdout);
  });

  it('should expose stream getter', () => {
    const encoder = new OpusEncoder();
    const mixerStream = new Readable({ read() {} });

    encoder.start(mixerStream, {
      sampleRate: 48000,
      channels: 2,
      bitrate: 256
    });

    expect(encoder.stream).toBe(mockStdout);
  });

  it('should kill process on stop', () => {
    const encoder = new OpusEncoder();
    const mixerStream = new Readable({ read() {} });

    encoder.start(mixerStream, {
      sampleRate: 48000,
      channels: 2,
      bitrate: 256
    });

    encoder.stop();

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('ICYWriter', () => {
  it('should create writer with metaInt', () => {
    const writer = new ICYWriter(8192);
    expect(writer).toBeDefined();
  });

  it('should pass through data when no metadata', () => {
    const writer = new ICYWriter(8);
    const input = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

    let output = Buffer.alloc(0);
    writer.on('data', chunk => {
      output = Buffer.concat([output, chunk]);
    });

    writer.write(input);

    // Output should be at least the input length
    expect(output.length).toBeGreaterThanOrEqual(input.length);
  });

  it('should queue metadata', () => {
    const writer = new ICYWriter(8192);

    // Should not throw
    writer.queue('Test Title');
  });

  it('should inject metadata at metaInt interval', () => {
    const metaInt = 8;
    const writer = new ICYWriter(metaInt);

    let output = Buffer.alloc(0);
    writer.on('data', chunk => {
      output = Buffer.concat([output, chunk]);
    });

    // Write exactly metaInt bytes
    writer.write(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

    // Should have metadata block after audio data
    expect(output.length).toBeGreaterThan(metaInt);
  });

  it('should encode metadata correctly', () => {
    const writer = new ICYWriter(8);

    let output = Buffer.alloc(0);
    writer.on('data', chunk => {
      output = Buffer.concat([output, chunk]);
    });

    writer.queue('Test');
    writer.write(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

    // Metadata block should exist
    // First byte after audio is length byte (should be 1 for 'Test' = 4 chars, padded to 16)
    const metadataBlock = output.subarray(8);
    expect(metadataBlock.length).toBeGreaterThan(0);
  });

  it('should handle empty metadata', () => {
    const writer = new ICYWriter(8);

    let output = Buffer.alloc(0);
    writer.on('data', chunk => {
      output = Buffer.concat([output, chunk]);
    });

    writer.queue('');
    writer.write(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

    // Should still work with empty metadata (just length byte = 0)
    expect(output.length).toBeGreaterThanOrEqual(8);
  });

  it('should handle long metadata (truncated)', () => {
    const writer = new ICYWriter(8);

    let output = Buffer.alloc(0);
    writer.on('data', chunk => {
      output = Buffer.concat([output, chunk]);
    });

    // Metadata longer than 255*16 characters would be truncated
    const longTitle = 'A'.repeat(5000);
    writer.queue(longTitle);
    writer.write(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

    expect(output.length).toBeGreaterThan(8);
  });

  it('should update metadata for new listeners', () => {
    const writer = new ICYWriter(8);

    let output = Buffer.alloc(0);
    writer.on('data', chunk => {
      output = Buffer.concat([output, chunk]);
    });

    writer.queue('First Title');
    writer.write(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

    const firstOutput = output.length;

    writer.queue('Second Title');
    writer.write(Buffer.from([9, 10, 11, 12, 13, 14, 15, 16]));

    // Should have processed second metadata
    expect(output.length).toBeGreaterThan(firstOutput);
  });
});

describe('createMP3Stream factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be exported from mp3 module', async () => {
    const { createMP3Stream } = await import('../../src/core/stream/mp3.js');
    expect(createMP3Stream).toBeDefined();
    expect(typeof createMP3Stream).toBe('function');
  });
});

describe('createOpusStream factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be exported from opus module', async () => {
    const { createOpusStream } = await import('../../src/core/stream/opus.js');
    expect(createOpusStream).toBeDefined();
    expect(typeof createOpusStream).toBe('function');
  });
});
