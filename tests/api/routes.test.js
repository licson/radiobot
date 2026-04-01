import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createInfoRoutes } from '../../src/api/routes/info.js';
import { createQueueRoutes } from '../../src/api/routes/queue.js';
import { createStreamRoutes } from '../../src/api/routes/stream.js';
import { createTitleRoutes } from '../../src/api/routes/title.js';
import { Readable } from 'stream';
import { createMockConfig, createMockQueue, createMockMixer, createMockEncoders } from '../helpers.js';

// Mock fs methods
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  createReadStream: vi.fn()
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn()
}));

describe('API Routes', () => {
  describe('Info Routes', () => {
    let app;
    let config;
    let queue;
    let analytics;

    beforeEach(() => {
      config = createMockConfig();
      queue = createMockQueue();
      analytics = {
        getTotalListeners: vi.fn().mockReturnValue(42),
        getListenerStats: vi.fn().mockReturnValue({ mp3: 30, ogg: 12 })
      };

      app = express();
      const router = createInfoRoutes({ config, analytics, queue });
      app.use('/', router);
    });

    it('GET /status should return plain text status', async () => {
      const res = await request(app).get('/status');

      expect(res.status).toBe(200);
      expect(res.text).toContain('active_conn=42');
      expect(res.text).toContain('rss=');
      expect(res.text).toContain('uptime=');
    });

    it('GET /info should return JSON station info', async () => {
      queue.currentTask = { info: { title: 'Current Song' } };

      const res = await request(app).get('/info');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        'station-name': 'Test Radio',
        url: 'https://example.com',
        description: 'A test radio station',
        bitrate: 192,
        title: 'Current Song'
      });
    });

    it('GET /info should use station name when no current task', async () => {
      queue.currentTask = null;

      const res = await request(app).get('/info');

      expect(res.body.title).toBe('Test Radio');
    });
  });

  describe('Queue Routes', () => {
    let app;
    let config;
    let queue;

    beforeEach(() => {
      config = createMockConfig();
      queue = createMockQueue({
        tasks: [{ info: { uid: '1', title: 'Song 1' } }, { info: { uid: '2', title: 'Song 2' } }]
      });
      queue.currentTask = { info: { uid: '0', title: 'Current Song' } };

      app = express();
      const router = createQueueRoutes({ config, queue });
      app.use('/', router);
    });

    it('GET / should return queue state', async () => {
      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('current');
      expect(res.body).toHaveProperty('nexts');
      expect(res.body).toHaveProperty('length');
      expect(res.body).toHaveProperty('isRunning');
    });

    it('GET / should include current task', async () => {
      const res = await request(app).get('/');

      expect(res.body.current).toEqual({ uid: '0', title: 'Current Song' });
    });

    it('GET / should include all tasks', async () => {
      const res = await request(app).get('/');

      expect(res.body.nexts).toHaveLength(2);
    });

    it('POST /skip should skip current song', async () => {
      const res = await request(app).post('/skip');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'Current song skipped' });
      expect(queue.signal).toHaveBeenCalledWith('stop');
    });

    it('POST /skip should return 400 if no song playing', async () => {
      queue.currentTask = null;

      const res = await request(app).post('/skip');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: 'No song playing' });
    });

    it('DELETE /:index should remove song from queue', async () => {
      queue.remove = vi.fn();

      const res = await request(app).delete('/0');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'Song removed from queue' });
    });

    it('DELETE /:index should return 404 for invalid index', async () => {
      const res = await request(app).delete('/999');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, message: 'Song not found in queue' });
    });
  });

  describe('Stream Routes', () => {
    let app;
    let config;
    let encoders;
    let mixer;
    let events;
    let analytics;

    beforeEach(() => {
      config = createMockConfig();
      encoders = createMockEncoders();
      mixer = createMockMixer();
      events = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
      analytics = { updateListenerCount: vi.fn() };

      app = express();
    });

    it('GET /live.mp3 should return 503 if encoder unavailable', async () => {
      encoders.mp3 = null;
      const router = createStreamRoutes({ config, encoders, mixer, events, analytics });
      app.use('/', router);

      const res = await request(app).get('/live.mp3');

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('MP3 encoder not available');
    });

    it('GET /live.mp3 should set correct headers', async () => {
      const router = createStreamRoutes({ config, encoders, mixer, events, analytics });
      app.use('/', router);

      const res = await request(app).get('/live.mp3');

      expect(res.headers['content-type']).toBe('audio/mpeg');
      expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
      expect(res.headers['connection']).toBe('keep-alive');
      expect(res.headers['icy-name']).toBe('Test Radio');
    });

    it('GET /live.ogg should return 503 if opus encoder unavailable', async () => {
      encoders.opus = null;
      const router = createStreamRoutes({ config, encoders, mixer, events, analytics });
      app.use('/', router);

      const res = await request(app).get('/live.ogg');

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('Opus encoder not available');
    });

    it('GET /live.ogg should set correct headers', async () => {
      const router = createStreamRoutes({ config, encoders, mixer, events, analytics });
      app.use('/', router);

      const res = await request(app).get('/live.ogg');

      expect(res.headers['content-type']).toBe('audio/ogg');
      expect(res.headers['icy-name']).toBe('Test Radio');
    });

    it('GET /stream should set ICY metadata headers', async () => {
      const router = createStreamRoutes({ config, encoders, mixer, events, analytics });
      app.use('/', router);

      const res = await request(app).get('/stream');

      expect(res.headers['icy-metaint']).toBe('2048');
      expect(res.headers['icy-br']).toBe('192');
    });

    it('GET /stream.ogg should handle opus stream', async () => {
      const router = createStreamRoutes({ config, encoders, mixer, events, analytics });
      app.use('/', router);

      const res = await request(app).get('/stream.ogg');

      expect(res.headers['content-type']).toBe('audio/ogg');
    });

    it('GET /live.raw should return 503 if mixer unavailable', async () => {
      const router = createStreamRoutes({ config, encoders, mixer: null, events, analytics });
      app.use('/', router);

      const res = await request(app).get('/live.raw');

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('Mixer not available');
    });

    it('GET /live.raw should set raw PCM headers', async () => {
      const router = createStreamRoutes({ config, encoders, mixer, events, analytics });
      app.use('/', router);

      const res = await request(app).get('/live.raw');

      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['x-radio-samplesize']).toBe('16');
      expect(res.headers['x-radio-samplerate']).toBe('44100');
      expect(res.headers['x-radio-channels']).toBe('2');
    });

    it('GET /live.m3u8 should return 503 if HLS unavailable', async () => {
      encoders.hls = null;
      const router = createStreamRoutes({ config, encoders, mixer, events, analytics });
      app.use('/', router);

      const res = await request(app).get('/live.m3u8');

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('HLS encoder not available');
    });

    it('GET /seg_:num.mp3 should return 503 if HLS unavailable', async () => {
      encoders.hls = null;
      const router = createStreamRoutes({ config, encoders, mixer, events, analytics });
      app.use('/', router);

      const res = await request(app).get('/seg_001.mp3');

      expect(res.status).toBe(503);
    });
  });

  describe('Title Routes', () => {
    let app;
    let config;
    let queue;
    let titleRoutes;

    beforeEach(() => {
      config = createMockConfig();
      queue = createMockQueue();

      app = express();
      titleRoutes = createTitleRoutes({ config, queue });
      app.use('/', titleRoutes.router);
    });

    it('GET /poll should return current metadata', async () => {
      titleRoutes.setMetadata('Test Song');

      const res = await request(app).get('/poll');

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test Song');
    });

    it('GET /sse should set correct headers', async () => {
      const res = await request(app)
        .get('/sse')
        .expect('Content-Type', /text\/event-stream/)
        .expect('Cache-Control', 'no-cache');

      expect(res.status).toBe(200);
    });
  });
});
