import { vi } from 'vitest';
import { Readable } from 'stream';
import EventEmitter from 'events';

/**
 * Creates a mock configuration object for tests
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock config
 */
export function createMockConfig(overrides = {}) {
  return {
    station: {
      name: 'Test Radio',
      description: 'A test radio station',
      url: 'https://example.com',
      public: true,
      ...overrides.station
    },
    http: {
      port: 8080,
      host: 'localhost',
      allowCrossOrigin: false,
      originWhitelist: [],
      ...overrides.http
    },
    mixer: {
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      useNative: false,
      ...overrides.mixer
    },
    mp3: {
      bitrate: 192,
      normalize: true,
      ...overrides.mp3
    },
    opus: {
      bitrate: 256,
      ...overrides.opus
    },
    hls: {
      enabled: false,
      segmentDuration: 10,
      segmentCount: 6,
      ...overrides.hls
    },
    icy: {
      metaInt: 2048,
      ...overrides.icy
    },
    queueSize: 10,
    loopSize: 20,
    telegram: {
      enabled: false,
      token: null,
      ...overrides.telegram
    },
    discord: {
      enabled: false,
      token: null,
      ...overrides.discord
    },
    ...overrides
  };
}

/**
 * Creates a mock logger with spy functions
 * @returns {Object} Mock logger
 */
export function createMockLogger() {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
}

/**
 * Creates a mock Queue for tests
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock queue
 */
export function createMockQueue(overrides = {}) {
  const tasks = overrides.tasks || [];
  const events = new EventEmitter();

  return {
    length: tasks.length,
    isRunning: false,
    currentTask: null,
    push: vi.fn((task, info) => {
      tasks.push({ task, info });
      queueMicrotask(() => events.emit('push', task, info));
      return true;
    }),
    unshift: vi.fn((task, info) => {
      tasks.unshift({ task, info });
      queueMicrotask(() => events.emit('unshift', task, info));
    }),
    remove: vi.fn(task => {
      const index = tasks.indexOf(task);
      if (index > -1) {
        tasks.splice(index, 1);
        events.emit('remove', task.taskFactory, task.info);
      }
    }),
    findTask: vi.fn(info => {
      if (!info?.uid) return [];
      return tasks.filter(t => t.info?.uid === info.uid);
    }),
    getAllTasks: vi.fn(() => tasks),
    start: vi.fn(() => {
      if (tasks.length === 0) return false;
      mockQueue.isRunning = true;
      return true;
    }),
    stop: vi.fn(() => {
      mockQueue.isRunning = false;
    }),
    signal: vi.fn(),
    toJSON: vi.fn(() => ({
      items: tasks,
      exceedItems: [],
      prependList: []
    })),
    loadFromObject: vi.fn(),
    on: events.on.bind(events),
    off: events.off.bind(events),
    once: events.once.bind(events),
    emit: events.emit.bind(events),
    ...overrides
  };
}

/**
 * Creates a mock MixerStream for tests
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock mixer
 */
export function createMockMixer(overrides = {}) {
  const sources = [];
  const events = new EventEmitter();

  const mockMixer = new Readable({
    read() {}
  });

  Object.assign(mockMixer, {
    bitDepth: 16,
    channels: 2,
    sampleRate: 44100,
    sampleSize: 4,
    sources,
    addSource: vi.fn((stream, labels = []) => {
      const source = {
        stream,
        labels: Array.isArray(labels) ? labels : [labels],
        volume: 1,
        setVolume: vi.fn(function (v) {
          this.volume = v;
        }),
        fadeTo: vi.fn(),
        is: vi.fn(label => this.labels?.includes(label)),
        on: vi.fn(),
        emit: vi.fn()
      };
      sources.push(source);
      events.emit('new_track', source);
      return source;
    }),
    getSources: vi.fn(labels => {
      if (!labels) return sources.slice();
      const labelArray = Array.isArray(labels) ? labels : [labels];
      return sources.filter(s => labelArray.some(l => s.labels?.includes(l)));
    }),
    count: vi.fn(() => sources.length),
    destroy: vi.fn(),
    pipe: vi.fn(),
    unpipe: vi.fn(),
    on: vi.fn((event, handler) => {
      events.on(event, handler);
      return mockMixer;
    }),
    once: vi.fn((event, handler) => {
      events.once(event, handler);
      return mockMixer;
    }),
    off: vi.fn((event, handler) => {
      events.off(event, handler);
      return mockMixer;
    }),
    emit: events.emit.bind(events),
    ...overrides
  });

  return mockMixer;
}

/**
 * Creates a mock RadioBot context for tests
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock radio context
 */
export function createMockRadio(overrides = {}) {
  const config = createMockConfig(overrides.config);
  const logger = createMockLogger();
  const queue = createMockQueue(overrides.queue);
  const mixer = createMockMixer(overrides.mixer);
  const events = new EventEmitter();
  const songList = overrides.songList || [];
  const volume = { song: 1, tcp: 1, microphone: 1 };

  return {
    config,
    logger,
    queue,
    mixer,
    events,
    songList,
    volume,
    doQueueSong: vi.fn(),
    doTTS: vi.fn(),
    addToSongList: vi.fn((file, name, title, artist, chatOrigin) => {
      songList.push({ file, name, title, artist, chatOrigin });
    }),
    getMediaInfo: vi.fn().mockResolvedValue({
      format: { duration: '180.5' },
      streams: [{ codec_type: 'audio' }]
    }),
    initSources: vi.fn().mockResolvedValue(4),
    loadPersistedQueue: vi.fn().mockResolvedValue(false),
    startQueue: vi.fn().mockReturnValue(true),
    getRadioContext: vi.fn().mockReturnValue({
      queue,
      mixer,
      events,
      urlHandlers: { find: vi.fn() },
      songList,
      volume,
      doQueueSong: vi.fn(),
      doTTS: vi.fn(),
      addToSongList: vi.fn(),
      getMediaInfo: vi.fn()
    }),
    ...overrides
  };
}

/**
 * Creates mock encoders for tests
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock encoders
 */
export function createMockEncoders(overrides = {}) {
  const mp3Stream = new Readable({ read() {} });
  const opusStream = new Readable({ read() {} });

  return {
    mp3: {
      stream: mp3Stream,
      stop: vi.fn()
    },
    opus: {
      stream: opusStream,
      headersReady: true,
      idHeader: Buffer.from('id header'),
      commentHeader: Buffer.from('comment header'),
      onHeadersReady: vi.fn(cb => {
        if (cb) cb();
      }),
      stop: vi.fn()
    },
    hls: {
      segmentDir: '/tmp/hls',
      stop: vi.fn()
    },
    icy: {
      stop: vi.fn()
    },
    ...overrides
  };
}

/**
 * Waits for an event to be emitted
 * @param {EventEmitter} emitter - Event emitter
 * @param {string} event - Event name
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<any>} Event data
 */
export function waitForEvent(emitter, event, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);

    emitter.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args.length === 1 ? args[0] : args);
    });
  });
}

/**
 * Creates a delayed promise
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a mock stream with data
 * @param {Buffer[]} chunks - Data chunks
 * @returns {Readable} Mock stream
 */
export function createMockStream(chunks = []) {
  let index = 0;
  const stream = new Readable({
    read() {
      if (index < chunks.length) {
        this.push(chunks[index++]);
      } else {
        this.push(null);
      }
    }
  });
  return stream;
}

/**
 * Mocks child_process.spawn for tests
 * @param {Object} mocks - Mock implementations
 * @returns {Function} Mock spawn function
 */
export function createMockSpawn(mocks = {}) {
  const defaultMock = {
    stdout: createMockStream([Buffer.from('mock output')]),
    stderr: createMockStream([]),
    stdin: {
      write: vi.fn(),
      end: vi.fn()
    },
    on: vi.fn((event, handler) => {
      if (event === 'exit') {
        setTimeout(() => handler(0, null), 10);
      }
    }),
    kill: vi.fn()
  };

  return vi.fn((command, args) => {
    const key = `${command} ${args?.join(' ')}`;
    return mocks[key] || defaultMock;
  });
}

export default {
  createMockConfig,
  createMockLogger,
  createMockQueue,
  createMockMixer,
  createMockRadio,
  createMockEncoders,
  waitForEvent,
  delay,
  createMockStream,
  createMockSpawn
};
