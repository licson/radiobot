import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "http";
import express from "express";
import { asyncHandler } from "../../src/api/middleware/async.js";

describe("Async Handler Middleware", () => {
  let server;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it("should pass through successful async handlers", async () => {
    const app = express();

    app.get(
      "/test",
      asyncHandler(async (req, res) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        res.json({ success: true });
      })
    );

    server = app.listen(0);
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/test`, resolve).on("error", reject);
    });

    let body = "";
    for await (const chunk of res) {
      body += chunk;
    }

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(body).success).toBe(true);
  });

  it("should catch errors from async handlers", async () => {
    const app = express();

    app.get(
      "/test",
      asyncHandler(async () => {
        throw new Error("Test error");
      })
    );

    app.use((err, req, res, next) => {
      res.status(500).json({ error: err.message });
    });

    server = app.listen(0);
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/test`, resolve).on("error", reject);
    });

    let body = "";
    for await (const chunk of res) {
      body += chunk;
    }

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(body).error).toBe("Test error");
  });

  it("should handle rejected promises", async () => {
    const app = express();

    app.get(
      "/test",
      asyncHandler(async () => {
        return Promise.reject(new Error("Promise rejected"));
      })
    );

    app.use((err, req, res, next) => {
      res.status(500).json({ error: err.message });
    });

    server = app.listen(0);
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/test`, resolve).on("error", reject);
    });

    let body = "";
    for await (const chunk of res) {
      body += chunk;
    }

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(body).error).toBe("Promise rejected");
  });

  it("should work with synchronous handlers", async () => {
    const app = express();

    app.get(
      "/test",
      asyncHandler((req, res) => {
        res.json({ sync: true });
      })
    );

    server = app.listen(0);
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/test`, resolve).on("error", reject);
    });

    let body = "";
    for await (const chunk of res) {
      body += chunk;
    }

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(body).sync).toBe(true);
  });
});
