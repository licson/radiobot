import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramPlatform } from '../../src/platforms/telegram/index.js';
import { ChatSource } from '../../src/utils/chat-source.js';

// Mock grammy
vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    command: vi.fn(),
    on: vi.fn(),
    api: {
      config: {
        use: vi.fn()
      }
    }
  })),
  GrammyError: class GrammyError extends Error {}
}));

// Mock ChatSource
vi.mock('../../src/utils/chat-source.js', () => ({
  ChatSource: {
    create: vi.fn(data => data)
  }
}));

describe('TelegramPlatform', () => {
  let platform;
  let mockRadio;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRadio = {
      queue: {
        length: 5,
        currentTask: { info: { title: 'Current Song' } },
        getAllTasks: vi.fn().mockReturnValue([
          { info: { title: 'Song 1' }, execCount: 0 },
          { info: { title: 'Song 2' }, execCount: 1 }
        ]),
        push: vi.fn(),
        start: vi.fn()
      },
      songList: [{ name: 'User1', title: 'Test Song', artist: 'Artist1', file: 'test.mp3' }],
      doQueueSong: vi.fn(),
      doTTS: vi.fn(),
      events: {
        on: vi.fn(),
        off: vi.fn()
      }
    };

    mockConfig = {
      telegram: {
        token: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        admins: ['admin1', 'admin2'],
        startMessage: 'Welcome!',
        playList: true,
        queueSize: 10
      }
    };

    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    platform = new TelegramPlatform(mockRadio, mockConfig, mockLogger);
  });

  describe('Constructor', () => {
    it('should create TelegramPlatform instance', () => {
      expect(platform).toBeDefined();
      expect(platform.constructor.name).toBe('TelegramPlatform');
    });

    it('should initialize with empty file cache', () => {
      expect(platform.fileCache).toBeInstanceOf(Map);
      expect(platform.fileCache.size).toBe(0);
    });

    it('should initialize with empty cache timers', () => {
      expect(platform.cacheTimers).toBeInstanceOf(Map);
      expect(platform.cacheTimers.size).toBe(0);
    });

    it('should set bot to null initially', () => {
      expect(platform.bot).toBeNull();
    });
  });

  describe('Start/Stop', () => {
    it('should not start without token', async () => {
      mockConfig.telegram.token = null;
      await platform.start();

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Missing bot token'));
    });

    it('should not start with invalid token format', async () => {
      mockConfig.telegram.token = 'invalid-token';
      await platform.start();

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid token format'));
    });

    it('should start with valid token', async () => {
      await platform.start();

      expect(platform.bot).not.toBeNull();
    });

    it('should set connected flag when started', async () => {
      await platform.start();

      expect(platform.connected).toBe(true);
    });

    it('should stop bot and clean up', async () => {
      await platform.start();
      await platform.stop();

      expect(platform.connected).toBe(false);
    });

    it('should clear cache timers on stop', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      platform.cacheTimers.set(
        'file1',
        setTimeout(() => {}, 1000)
      );

      await platform.stop();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('Admin Check', () => {
    beforeEach(async () => {
      await platform.start();
    });

    it('should return true for admin username', () => {
      const result = platform.isAdminTelegram('admin1');
      expect(result).toBe(true);
    });

    it('should return false for non-admin username', () => {
      const result = platform.isAdminTelegram('notadmin');
      expect(result).toBe(false);
    });

    it('should return false for undefined username', () => {
      const result = platform.isAdminTelegram(undefined);
      expect(result).toBe(false);
    });

    it('should handle admin array not configured', () => {
      mockConfig.telegram.admins = undefined;
      const result = platform.isAdminTelegram('admin1');
      expect(result).toBe(false);
    });
  });

  describe('Command Handlers', () => {
    beforeEach(async () => {
      await platform.start();
    });

    it('should register start command handler', () => {
      expect(platform.bot.command).toHaveBeenCalledWith('start', expect.any(Function));
    });

    it('should register queue command handler', () => {
      expect(platform.bot.command).toHaveBeenCalledWith('queue', expect.any(Function));
    });

    it('should register list command handler', () => {
      expect(platform.bot.command).toHaveBeenCalledWith('list', expect.any(Function));
    });

    it('should register play_list command handler', () => {
      expect(platform.bot.command).toHaveBeenCalledWith('play_list', expect.any(Function));
    });

    it('should register skip command handler', () => {
      expect(platform.bot.command).toHaveBeenCalledWith('skip', expect.any(Function));
    });
  });

  describe('URL/File Detection', () => {
    it('should detect audio file extensions', () => {
      expect(platform.isAudioFile('song.mp3')).toBe(true);
      expect(platform.isAudioFile('song.ogg')).toBe(true);
      expect(platform.isAudioFile('song.flac')).toBe(true);
    });

    it('should reject non-audio file extensions', () => {
      expect(platform.isAudioFile('song.txt')).toBe(false);
      expect(platform.isAudioFile('song.jpg')).toBe(false);
      expect(platform.isAudioFile('song')).toBe(false);
    });

    it('should detect URLs', () => {
      expect(platform.isURL('https://example.com/song.mp3')).toBe(true);
      expect(platform.isURL('http://example.com/song.ogg')).toBe(true);
    });

    it('should reject non-URLs', () => {
      expect(platform.isURL('not a url')).toBe(false);
      expect(platform.isURL('/path/to/file.mp3')).toBe(false);
    });
  });

  describe('File Caching', () => {
    it('should cache file by ID', () => {
      platform.setFileCache('file_id_123', 'path/to/file.mp3');

      expect(platform.fileCache.has('file_id_123')).toBe(true);
      expect(platform.fileCache.get('file_id_123')).toBe('path/to/file.mp3');
    });

    it('should get cached file', () => {
      platform.setFileCache('file_id_123', 'path/to/file.mp3');

      const result = platform.getFileCache('file_id_123');
      expect(result).toBe('path/to/file.mp3');
    });

    it('should return null for uncached file', () => {
      const result = platform.getFileCache('unknown_id');
      expect(result).toBeNull();
    });

    it('should set cache expiration timer', () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      platform.setFileCache('file_id_123', 'path/to/file.mp3');

      expect(setTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('Playlist Message', () => {
    it('should update playlist message', () => {
      platform.playListMessage = { message_id: 123, chat: { id: 456 } };
      platform.bot.api = {
        editMessageText: vi.fn().mockResolvedValue(undefined)
      };

      platform.updatePlayList();

      expect(platform.bot.api.editMessageText).toHaveBeenCalled();
    });

    it('should not update if no playlist message', () => {
      platform.playListMessage = null;
      platform.bot.api = {
        editMessageText: vi.fn()
      };

      platform.updatePlayList();

      expect(platform.bot.api.editMessageText).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    beforeEach(async () => {
      await platform.start();
      platform.bot.api = {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 123 })
      };
    });

    it('should send message to chat', async () => {
      const chatOrigin = { chatId: 12345 };
      await platform.sendMessage(chatOrigin, 'Hello');

      expect(platform.bot.api.sendMessage).toHaveBeenCalledWith(12345, 'Hello', expect.any(Object));
    });

    it('should send reply if messageId provided', async () => {
      const chatOrigin = { chatId: 12345, messageId: 67890 };
      await platform.sendMessage(chatOrigin, 'Hello');

      expect(platform.bot.api.sendMessage).toHaveBeenCalledWith(
        12345,
        'Hello',
        expect.objectContaining({
          reply_parameters: { message_id: 67890 }
        })
      );
    });
  });

  describe('sendReply', () => {
    beforeEach(async () => {
      await platform.start();
      platform.bot.api = {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 123 })
      };
    });

    it('should send reply to same chat', async () => {
      const chatOrigin = { chatId: 12345, messageId: 67890 };
      await platform.sendReply(chatOrigin, 'Reply text');

      expect(platform.bot.api.sendMessage).toHaveBeenCalled();
    });
  });
});
