import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RadioBot } from '../../src/core/radio.js';
import EventEmitter from 'events';

// Mock dependencies
vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

vi.mock('../../src/core/persistence.js', () => ({
  saveQueue: vi.fn(),
  loadQueue: vi.fn(),
  createFileAppender: vi.fn().mockReturnValue(vi.fn())
}));

vi.mock('../../src/sources/manager.js', () => ({
  SourceManager: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(4),
    find: vi.fn()
  }))
}));

import { spawn } from 'child_process';
import { loadQueue } from '../../src/core/persistence.js';

describe('RadioBot', () => {
  let mockConfig;
  let mockLogger;
  let mockProcess;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      station: {
        name: 'Test Radio',
        description: 'A test station'
      },
      mixer: {
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        useNative: false
      },
      queueSize: 10,
      loopSize: 20
    };

    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    // Mock spawn for ffprobe
    mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn()
    };
    spawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should create RadioBot instance', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      expect(radio).toBeDefined();
    });

    it('should create mixer with config options', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const mixer = radio.mixer;

      expect(mixer).toBeDefined();
      expect(mixer.sampleRate).toBe(44100);
      expect(mixer.bitDepth).toBe(16);
      expect(mixer.channels).toBe(2);
    });

    it('should create queue with loopSize', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const queue = radio.queue;

      expect(queue).toBeDefined();
      expect(queue.length).toBe(0);
    });

    it('should create event emitter', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const events = radio.events;

      expect(events).toBeDefined();
      expect(events).toBeInstanceOf(EventEmitter);
    });

    it('should create source manager', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const sourceManager = radio.sourceManager;

      expect(sourceManager).toBeDefined();
    });

    it('should initialize volume object', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const volume = radio.volume;

      expect(volume).toEqual({
        song: 1,
        tcp: 1,
        microphone: 1
      });
    });

    it('should create empty song list', () => {
      const radio = new RadioBot(mockConfig, mockLogger);

      expect(radio.songList).toEqual([]);
    });
  });

  describe('Mixer Handlers', () => {
    it('should set up new_track handler', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const mixer = radio.mixer;

      // Emit new_track event
      const mockTrack = {
        labels: ['song'],
        setVolume: vi.fn(),
        fadeTo: vi.fn()
      };

      mixer.emit('new_track', mockTrack);

      expect(mockTrack.setVolume).toHaveBeenCalledWith(0);
      expect(mockTrack.fadeTo).toHaveBeenCalledWith(1, 1000);
    });

    it('should handle tcp tracks', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const mixer = radio.mixer;

      const mockTrack = {
        labels: ['tcp'],
        setVolume: vi.fn(),
        fadeTo: vi.fn()
      };

      mixer.emit('new_track', mockTrack);

      expect(mockTrack.fadeTo).toHaveBeenCalledWith(1, 1000);
    });

    it('should handle microphone tracks', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const mixer = radio.mixer;

      const mockTrack = {
        labels: ['microphone'],
        setVolume: vi.fn(),
        fadeTo: vi.fn()
      };

      mixer.emit('new_track', mockTrack);

      expect(mockTrack.fadeTo).toHaveBeenCalledWith(1, 1000);
    });

    it('should handle unknown track types', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const mixer = radio.mixer;

      const mockTrack = {
        labels: ['unknown'],
        setVolume: vi.fn(),
        fadeTo: vi.fn()
      };

      mixer.emit('new_track', mockTrack);

      expect(mockTrack.setVolume).toHaveBeenCalledWith(1);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('Queue Handlers', () => {
    it('should emit queue_push event on push', async () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const events = radio.events;

      const pushHandler = vi.fn();
      events.on('queue_push', pushHandler);

      radio.queue.push(async () => {}, { uid: '1', title: 'Test' });

      // Wait for queueMicrotask
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(pushHandler).toHaveBeenCalled();
    });

    it('should emit queue_next event on next', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const events = radio.events;

      const nextHandler = vi.fn();
      events.on('queue_next', nextHandler);

      // Manually emit the queue event
      radio.queue.emit('next', async () => {}, { title: 'Test' });

      expect(nextHandler).toHaveBeenCalled();
    });
  });

  describe('Methods', () => {
    it('should init sources', async () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const count = await radio.initSources();

      expect(count).toBe(4);
    });

    it('should load persisted queue', async () => {
      loadQueue.mockResolvedValueOnce(true);

      const radio = new RadioBot(mockConfig, mockLogger);
      const result = await radio.loadPersistedQueue();

      expect(loadQueue).toHaveBeenCalledWith(radio.queue);
      expect(result).toBe(true);
    });

    it('should start queue', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      radio.queue.push(async () => {}, { uid: '1', title: 'Test' });

      const result = radio.startQueue();

      expect(result).toBe(true);
    });

    it('should not start empty queue', () => {
      const radio = new RadioBot(mockConfig, mockLogger);

      const result = radio.startQueue();

      expect(result).toBe(false);
    });

    it('should add to song list', () => {
      const radio = new RadioBot(mockConfig, mockLogger);

      radio.addToSongList('file.mp3', 'User', 'Title', 'Artist', null);

      expect(radio.songList).toHaveLength(1);
      expect(radio.songList[0]).toMatchObject({
        file: 'file.mp3',
        name: 'User',
        title: 'Title',
        artist: 'Artist'
      });
    });

    it('should respect song list max size', () => {
      mockConfig.queueSize = 2;
      const radio = new RadioBot(mockConfig, mockLogger);

      radio.addToSongList('file1.mp3', 'User1', 'Title1', 'Artist1', null);
      radio.addToSongList('file2.mp3', 'User2', 'Title2', 'Artist2', null);
      radio.addToSongList('file3.mp3', 'User3', 'Title3', 'Artist3', null);

      expect(radio.songList).toHaveLength(2);
      expect(radio.songList[0].file).toBe('file2.mp3');
      expect(radio.songList[1].file).toBe('file3.mp3');
    });
  });

  describe('getRadioContext', () => {
    it('should return context object', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const context = radio.getRadioContext();

      expect(context).toHaveProperty('queue');
      expect(context).toHaveProperty('mixer');
      expect(context).toHaveProperty('events');
      expect(context).toHaveProperty('urlHandlers');
      expect(context).toHaveProperty('songList');
      expect(context).toHaveProperty('volume');
      expect(context).toHaveProperty('doQueueSong');
      expect(context).toHaveProperty('doTTS');
      expect(context).toHaveProperty('addToSongList');
      expect(context).toHaveProperty('getMediaInfo');
    });

    it('should have callable methods in context', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const context = radio.getRadioContext();

      expect(typeof context.doQueueSong).toBe('function');
      expect(typeof context.doTTS).toBe('function');
      expect(typeof context.addToSongList).toBe('function');
      expect(typeof context.getMediaInfo).toBe('function');
    });

    it('should return same queue instance', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const context = radio.getRadioContext();

      expect(context.queue).toBe(radio.queue);
    });

    it('should return same mixer instance', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const context = radio.getRadioContext();

      expect(context.mixer).toBe(radio.mixer);
    });

    it('should return same events instance', () => {
      const radio = new RadioBot(mockConfig, mockLogger);
      const context = radio.getRadioContext();

      expect(context.events).toBe(radio.events);
    });
  });

  describe('getMediaInfo', () => {
    it('should call ffprobe', async () => {
      const mockStdout = {
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(JSON.stringify({ format: { duration: '180' } }));
          }
        })
      };
      const mockStderr = { on: vi.fn() };

      spawn.mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        on: vi.fn((event, handler) => {
          if (event === 'close') {
            setTimeout(() => handler(0), 10);
          }
        })
      });

      const radio = new RadioBot(mockConfig, mockLogger);
      const info = await radio.getMediaInfo('http://example.com/audio.mp3');

      expect(spawn).toHaveBeenCalledWith('ffprobe', [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        'http://example.com/audio.mp3'
      ]);

      expect(info).toEqual({ format: { duration: '180' } });
    });

    it('should reject on ffprobe error', async () => {
      spawn.mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler('Error message');
            }
          })
        },
        on: vi.fn((event, handler) => {
          if (event === 'close') {
            setTimeout(() => handler(1), 10);
          }
        })
      });

      const radio = new RadioBot(mockConfig, mockLogger);

      await expect(radio.getMediaInfo('http://example.com/audio.mp3')).rejects.toThrow();
    });
  });

  describe('doTTS', () => {
    it('should add TTS task to queue', () => {
      const radio = new RadioBot(mockConfig, mockLogger);

      radio.doTTS('Hello world');

      expect(radio.queue.length).toBe(1);
    });

    it('should create task with tts type', () => {
      const radio = new RadioBot(mockConfig, mockLogger);

      radio.doTTS('Hello world');

      const tasks = radio.queue.getAllTasks();
      expect(tasks[0].info.type).toBe('tts');
      expect(tasks[0].info.text).toBe('Hello world');
    });
  });

  describe('urlHandlers alias', () => {
    it('should return sourceManager as urlHandlers', () => {
      const radio = new RadioBot(mockConfig, mockLogger);

      expect(radio.urlHandlers).toBe(radio.sourceManager);
    });
  });
});
