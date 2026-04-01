import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import { asyncHandler } from '../../src/api/middleware/async.js';

describe('Async Handler Middleware', () => {
  it('should pass through successful async handlers', async () => {
    const app = express();

    app.get(
      '/test',
      asyncHandler(async (req, res) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        res.json({ success: true });
      })
    );

    const server = app.listen(0);
    const port = server.address().port;

    const res = await new Promise(resolve => {
      http.get(`http://localhost:${port}/test`, resolve);
    });

    let body = '';
    for await (const chunk of res) {
      body += chunk;
    }

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(body).success, true);

    server.close();
  });

  it('should catch errors from async handlers', async () => {
    const app = express();

    app.get(
      '/test',
      asyncHandler(async () => {
        throw new Error('Test error');
      })
    );

    app.use((err, req, res, next) => {
      res.status(500).json({ error: err.message });
    });

    const server = app.listen(0);
    const port = server.address().port;

    const res = await new Promise(resolve => {
      http.get(`http://localhost:${port}/test`, resolve);
    });

    let body = '';
    for await (const chunk of res) {
      body += chunk;
    }

    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(JSON.parse(body).error, 'Test error');

    server.close();
  });
});
