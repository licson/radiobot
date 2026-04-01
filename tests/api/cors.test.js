import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import { createCorsMiddleware } from '../../src/api/middleware/cors.js';

describe('CORS Middleware', () => {
  it('should not add CORS headers when disabled', (t, done) => {
    const app = express();
    const cors = createCorsMiddleware({ allowCrossOrigin: false });

    app.use(cors);
    app.get('/test', (req, res) => res.json({ ok: true }));

    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/test`, res => {
        assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
        server.close();
        done();
      });
    });
  });

  it('should add wildcard CORS when enabled with empty whitelist', (t, done) => {
    const app = express();
    const cors = createCorsMiddleware({
      allowCrossOrigin: true,
      originWhitelist: []
    });

    app.use(cors);
    app.get('/test', (req, res) => res.json({ ok: true }));

    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/test`, res => {
        assert.strictEqual(res.headers['access-control-allow-origin'], '*');
        server.close();
        done();
      });
    });
  });

  it('should allow specific origin when in whitelist', (t, done) => {
    const app = express();
    const cors = createCorsMiddleware({
      allowCrossOrigin: true,
      originWhitelist: ['http://example.com']
    });

    app.use(cors);
    app.get('/test', (req, res) => res.json({ ok: true }));

    const server = app.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        {
          hostname: 'localhost',
          port,
          path: '/test',
          method: 'GET',
          headers: { Origin: 'http://example.com' }
        },
        res => {
          assert.strictEqual(res.headers['access-control-allow-origin'], 'http://example.com');
          server.close();
          done();
        }
      );
      req.end();
    });
  });
});
