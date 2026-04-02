import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "http";
import express from "express";
import { createCorsMiddleware } from "../../src/api/middleware/cors.js";

describe("CORS Middleware", () => {
  let server;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it("should not add CORS headers when disabled", async () => {
    const app = express();
    const cors = createCorsMiddleware({ allowCrossOrigin: false });

    app.use(cors);
    app.get("/test", (req, res) => res.json({ ok: true }));

    server = app.listen(0);
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/test`, resolve).on("error", reject);
    });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("should add wildcard CORS when enabled with empty whitelist", async () => {
    const app = express();
    const cors = createCorsMiddleware({
      allowCrossOrigin: true,
      originWhitelist: []
    });

    app.use(cors);
    app.get("/test", (req, res) => res.json({ ok: true }));

    server = app.listen(0);
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/test`, resolve).on("error", reject);
    });

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("should allow specific origin when in whitelist", async () => {
    const app = express();
    const cors = createCorsMiddleware({
      allowCrossOrigin: true,
      originWhitelist: ["http://example.com"]
    });

    app.use(cors);
    app.get("/test", (req, res) => res.json({ ok: true }));

    server = app.listen(0);
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "localhost",
          port,
          path: "/test",
          method: "GET",
          headers: { Origin: "http://example.com" }
        },
        resolve
      );
      req.on("error", reject);
      req.end();
    });

    expect(res.headers["access-control-allow-origin"]).toBe("http://example.com");
  });

  it("should not allow origin not in whitelist", async () => {
    const app = express();
    const cors = createCorsMiddleware({
      allowCrossOrigin: true,
      originWhitelist: ["http://example.com"]
    });

    app.use(cors);
    app.get("/test", (req, res) => res.json({ ok: true }));

    server = app.listen(0);
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "localhost",
          port,
          path: "/test",
          method: "GET",
          headers: { Origin: "http://evil.com" }
        },
        resolve
      );
      req.on("error", reject);
      req.end();
    });

    expect(res.headers["access-control-allow-origin"]).toBeFalsy();
  });

  it("should handle preflight requests", async () => {
    const app = express();
    const cors = createCorsMiddleware({
      allowCrossOrigin: true,
      originWhitelist: ["http://example.com"]
    });

    app.use(cors);
    app.get("/test", (req, res) => res.json({ ok: true }));

    server = app.listen(0);
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "localhost",
          port,
          path: "/test",
          method: "OPTIONS",
          headers: {
            Origin: "http://example.com",
            "Access-Control-Request-Method": "GET"
          }
        },
        resolve
      );
      req.on("error", reject);
      req.end();
    });

    expect(res.headers["access-control-allow-origin"]).toBe("http://example.com");
  });
});
