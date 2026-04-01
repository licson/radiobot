import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscordPlatform } from '../../src/platforms/discord/index.js';

// Mock discord.js
vi.mock('discord.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    login: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    user: { tag: 'TestBot#1234' },
    guilds: {
      cache: {
        forEach: vi.fn()
      }
    }
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    GuildVoiceStates: 3,
    DirectMessages: 4,
    MessageContent: 5
  },
  Events: {
    ClientReady: 'ready',
    MessageCreate: 'messageCreate',
    InteractionCreate: 'interactionCreate',
    VoiceStateUpdate: 'voiceStateUpdate'
  },
  ActivityType: {
    Listening: 2
  },
  Partials: {
    Channel: 'CHANNEL'
  },
  ChannelType: {
    DM: 1,
    GuildText: 0
  }
}));

// Mock @discordjs/voice
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: vi.fn().mockReturnValue({
    on: vi.fn(),
    destroy: vi.fn(),
    subscribe: vi.fn()
  }),
  createAudioPlayer: vi.fn().mockReturnValue({
    on: vi.fn(),
    play: vi.fn(),
    stop: vi.fn()
  }),
  createAudioResource: vi.fn().mockReturnValue({
    volume: { setVolume: vi.fn() }
  }),
  AudioPlayerStatus: {
    Playing: 'playing'
  },
  VoiceConnectionStatus: {
    Ready: 'ready'
  },
  StreamType: {
    Raw: 'raw'
  }
}));

describe('DiscordPlatform', () => {
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
        getAllTasks: vi.fn().mockReturnValue([{ info: { title: 'Song 1' } }, { info: { title: 'Song 2' } }]),
        push: vi.fn(),
        start: vi.fn()
      },
      songList: [{ name: 'User1', title: 'Test Song', artist: 'Artist1' }],
      doQueueSong: vi.fn(),
      doTTS: vi.fn(),
      events: {
        on: vi.fn(),
        off: vi.fn()
      },
      opusStream: {
        pipe: vi.fn()
      },
      mixer: {
        sampleRate: 48000,
        channels: 2
      }
    };

    mockConfig = {
      discord: {
        token: 'test-token-here',
        enabled: true,
        admins: ['123456789'],
        voiceChannel: '987654321'
      },
      mixer: {
        sampleRate: 48000,
        channels: 2
      }
    };

    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    platform = new DiscordPlatform(mockRadio, mockConfig, mockLogger);
  });

  describe('Constructor', () => {
    it('should create DiscordPlatform instance', () => {
      expect(platform).toBeDefined();
      expect(platform.constructor.name).toBe('DiscordPlatform');
    });

    it('should initialize with null client', () => {
      expect(platform.client).toBeNull();
    });

    it('should initialize with null audioPlayer', () => {
      expect(platform.audioPlayer).toBeNull();
    });

    it('should initialize empty voice connections map', () => {
      expect(platform.voiceConnections).toBeInstanceOf(Map);
      expect(platform.voiceConnections.size).toBe(0);
    });

    it('should initialize empty log channels array', () => {
      expect(platform.logChannels).toEqual([]);
    });

    it('should initialize empty playlist channels array', () => {
      expect(platform.playListChannels).toEqual([]);
    });
  });

  describe('Start/Stop', () => {
    it('should not start without token', async () => {
      mockConfig.discord.token = null;
      await platform.start();

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Missing bot token'));
    });

    it('should not start if not enabled', async () => {
      mockConfig.discord.enabled = false;
      await platform.start();

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should warn about wrong sample rate', async () => {
      const { Client } = await import('discord.js');
      mockConfig.mixer.sampleRate = 44100;
      platform = new DiscordPlatform(mockRadio, mockConfig, mockLogger);

      await platform.start();

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('requires 48000Hz'));
    });

    it('should warn about wrong channel count', async () => {
      const { Client } = await import('discord.js');
      mockConfig.mixer.channels = 1;
      platform = new DiscordPlatform(mockRadio, mockConfig, mockLogger);

      await platform.start();

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('requires stereo'));
    });

    it('should start with valid config', async () => {
      await platform.start();

      expect(platform.client).not.toBeNull();
      expect(platform.audioPlayer).not.toBeNull();
      expect(platform.connected).toBe(true);
    });

    it('should login with token', async () => {
      await platform.start();

      const { Client } = await import('discord.js');
      const clientInstance = Client.mock.results[0].value;
      expect(clientInstance.login).toHaveBeenCalledWith('test-token-here');
    });

    it('should stop and clean up', async () => {
      await platform.start();
      await platform.stop();

      expect(platform.connected).toBe(false);
    });

    it('should destroy voice connections on stop', async () => {
      const { joinVoiceChannel } = await import('@discordjs/voice');
      await platform.start();

      // Add a mock connection
      const mockConnection = {
        destroy: vi.fn(),
        on: vi.fn(),
        subscribe: vi.fn()
      };
      platform.voiceConnections.set('guild1', mockConnection);

      await platform.stop();

      expect(mockConnection.destroy).toHaveBeenCalled();
    });

    it('should stop audio player on stop', async () => {
      const { createAudioPlayer } = await import('@discordjs/voice');
      await platform.start();

      const playerInstance = createAudioPlayer.mock.results[0].value;
      await platform.stop();

      expect(playerInstance.stop).toHaveBeenCalled();
    });
  });

  describe('Admin Check', () => {
    beforeEach(async () => {
      await platform.start();
    });

    it('should return true for admin user', () => {
      const result = platform.isAdmin({ userId: '123456789' });
      expect(result).toBe(true);
    });

    it('should return false for non-admin user', () => {
      const result = platform.isAdmin({ userId: '999999999' });
      expect(result).toBe(false);
    });

    it('should return false for undefined userId', () => {
      const result = platform.isAdmin({});
      expect(result).toBe(false);
    });

    it('should handle admin array not configured', () => {
      mockConfig.discord.admins = undefined;
      const result = platform.isAdmin({ userId: '123456789' });
      expect(result).toBe(false);
    });
  });

  describe('Handlers Setup', () => {
    beforeEach(async () => {
      await platform.start();
    });

    it('should register ClientReady handler', () => {
      const { Client } = require('discord.js');
      const clientInstance = Client.mock.results[0].value;

      expect(clientInstance.once).toHaveBeenCalledWith('ready', expect.any(Function));
    });

    it('should register MessageCreate handler', () => {
      const { Client } = require('discord.js');
      const clientInstance = Client.mock.results[0].value;

      expect(clientInstance.on).toHaveBeenCalledWith('messageCreate', expect.any(Function));
    });
  });

  describe('Voice Channel', () => {
    beforeEach(async () => {
      await platform.start();
    });

    it('should join voice channel', async () => {
      const { joinVoiceChannel } = await import('@discordjs/voice');

      await platform.joinVoiceChannel('guild1', 'channel1');

      expect(joinVoiceChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: 'guild1',
          channelId: 'channel1'
        })
      );
    });

    it('should store voice connection', async () => {
      await platform.joinVoiceChannel('guild1', 'channel1');

      expect(platform.voiceConnections.has('guild1')).toBe(true);
    });
  });

  describe('sendMessage', () => {
    beforeEach(async () => {
      await platform.start();
    });

    it('should send DM to user', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      const mockCreateDM = vi.fn().mockResolvedValue({ send: mockSend });

      platform.client.users = {
        fetch: vi.fn().mockResolvedValue({
          createDM: mockCreateDM
        })
      };

      const chatOrigin = { userId: '123456789' };
      await platform.sendMessage(chatOrigin, 'Hello');

      expect(platform.client.users.fetch).toHaveBeenCalledWith('123456789');
    });
  });

  describe('sendReply', () => {
    beforeEach(async () => {
      await platform.start();
    });

    it('should send reply via DM', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      const mockCreateDM = vi.fn().mockResolvedValue({ send: mockSend });

      platform.client.users = {
        fetch: vi.fn().mockResolvedValue({
          createDM: mockCreateDM
        })
      };

      const chatOrigin = { userId: '123456789' };
      await platform.sendReply(chatOrigin, 'Reply text');

      expect(platform.client.users.fetch).toHaveBeenCalledWith('123456789');
    });
  });

  describe('Playlist Management', () => {
    beforeEach(async () => {
      await platform.start();
    });

    it('should update playlist messages', async () => {
      const mockMessage = {
        edit: vi.fn().mockResolvedValue({})
      };
      platform.playListMessages = [mockMessage];

      platform.updatePlayList();

      expect(mockMessage.edit).toHaveBeenCalled();
    });

    it('should handle missing playlist messages', () => {
      platform.playListMessages = [];

      // Should not throw
      expect(() => platform.updatePlayList()).not.toThrow();
    });
  });

  describe('isURL', () => {
    it('should detect HTTP URLs', () => {
      expect(platform.isURL('https://example.com/song.mp3')).toBe(true);
      expect(platform.isURL('http://example.com/song.ogg')).toBe(true);
    });

    it('should reject non-URLs', () => {
      expect(platform.isURL('not a url')).toBe(false);
      expect(platform.isURL('/path/to/file.mp3')).toBe(false);
    });
  });
});
