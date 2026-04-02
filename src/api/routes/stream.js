import { Router } from "express";
import { createReadStream, existsSync } from "fs";
import { join } from "path";
import { StreamBroadcaster } from "../../core/stream/broadcaster.js";
import { ICYWriter } from "../../core/stream/icy.js";
import { findOggPage } from "../../core/stream/ogg-helpers.js";

function createStreamRoutes(context) {
  const router = Router();
  const { config, encoders, mixer, events, analytics } = context;

  // Create broadcasters for each stream type
  const broadcasters = {
    mp3: null,
    opus: null,
    raw: null
  };

  // Initialize broadcasters when encoders are available
  if (encoders?.mp3?.stream) {
    broadcasters.mp3 = new StreamBroadcaster(encoders.mp3.stream);
    console.log("[Stream] MP3 broadcaster initialized");
  }

  if (encoders?.opus?.stream) {
    broadcasters.opus = new StreamBroadcaster(encoders.opus.stream);
    console.log("[Stream] Opus broadcaster initialized");
  }

  if (mixer) {
    broadcasters.raw = new StreamBroadcaster(mixer);
    console.log("[Stream] Raw PCM broadcaster initialized");
  }

  // Expose broadcasters for cleanup
  router.broadcasters = broadcasters;

  // Listener counters for analytics
  const mp3Listeners = { count: 0 };
  const oggListeners = { count: 0 };
  const streamListeners = { count: 0 };
  const streamOggListeners = { count: 0 };
  const rawListeners = { count: 0 };

  function updateListenerCount(type, counter, delta) {
    counter.count += delta;
    if (analytics) {
      analytics.updateListenerCount(type, Math.max(0, counter.count));
    }
  }

  router.get("/live.mp3", (req, res) => {
    if (!broadcasters.mp3) {
      return res.status(503).json({ error: "MP3 encoder not available" });
    }

    updateListenerCount("mp3", mp3Listeners, 1);

    req.setTimeout(0);
    res.connection?.setTimeout?.(0);
    res.socket?.setTimeout?.(0);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Transfer-Encoding", "chunked");

    if (config.station?.name) {
      res.setHeader("icy-name", config.station.name);
    }
    if (config.station?.description) {
      res.setHeader("icy-description", config.station.description);
    }
    if (config.station?.url) {
      res.setHeader("icy-url", config.station.url);
    }
    res.setHeader("icy-pub", config.station?.public ? "1" : "0");
    res.setHeader("icy-metaint", "0");

    // Add this response to the broadcaster
    const cleanup = broadcasters.mp3.add(res);
    console.log(`[Stream] MP3 client connected. Total clients: ${broadcasters.mp3.clientCount}`);

    req.on("close", () => {
      updateListenerCount("mp3", mp3Listeners, -1);
      cleanup();
      console.log(`[Stream] MP3 client disconnected. Total clients: ${broadcasters.mp3.clientCount}`);
    });

    res.on("error", err => {
      console.error("[Stream] MP3 response error:", err.message);
      cleanup();
    });
  });

  router.get("/live.ogg", (req, res) => {
    if (!broadcasters.opus) {
      return res.status(503).json({ error: "Opus encoder not available" });
    }

    updateListenerCount("ogg", oggListeners, 1);

    req.setTimeout(0);
    res.connection?.setTimeout?.(0);
    res.socket?.setTimeout?.(0);

    res.setHeader("Content-Type", "audio/ogg");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");

    if (config.station?.name) {
      res.setHeader("icy-name", config.station.name);
    }
    if (config.station?.description) {
      res.setHeader("icy-description", config.station.description);
    }

    // Send headers immediately if available
    if (encoders.opus.headersReady) {
      if (encoders.opus.idHeader) {
        res.write(encoders.opus.idHeader);
      }
      if (encoders.opus.commentHeader) {
        res.write(encoders.opus.commentHeader);
      }
    }

    // Add this response to the broadcaster
    const cleanup = broadcasters.opus.add(res);
    console.log(`[Stream] Ogg client connected. Total clients: ${broadcasters.opus.clientCount}`);

    req.on("close", () => {
      updateListenerCount("ogg", oggListeners, -1);
      cleanup();
      console.log(`[Stream] Ogg client disconnected. Total clients: ${broadcasters.opus.clientCount}`);
    });

    res.on("error", err => {
      console.error("[Stream] Ogg response error:", err.message);
      cleanup();
    });
  });

  router.get("/stream", (req, res) => {
    if (!broadcasters.mp3) {
      return res.status(503).json({ error: "MP3 encoder not available" });
    }

    updateListenerCount("shoutcast", streamListeners, 1);

    const metaInt = config.icy?.metaInt || 2048;

    req.setTimeout(0);
    res.connection?.setTimeout?.(0);
    res.socket?.setTimeout?.(0);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("icy-metaint", String(metaInt));

    if (config.station?.name) {
      res.setHeader("icy-name", config.station.name);
    }
    if (config.station?.description) {
      res.setHeader("icy-description", config.station.description);
    }
    if (config.station?.url) {
      res.setHeader("icy-url", config.station.url);
    }
    res.setHeader("icy-pub", config.station?.public ? "1" : "0");
    res.setHeader("icy-br", String(config.mp3?.bitrate || 192));

    // Each ICY client needs their own ICYWriter since metadata is per-client
    const icyWriter = new ICYWriter(metaInt);

    // Create a wrapper that pipes through ICYWriter
    const wrapper = {
      write: chunk => {
        return icyWriter.write(chunk);
      },
      end: () => {
        icyWriter.end();
        res.end();
      },
      destroy: err => {
        res.destroy(err);
      },
      get destroyed() {
        return res.destroyed;
      },
      get writableEnded() {
        return res.writableEnded;
      },
      on: (event, handler) => res.on(event, handler),
      off: (event, handler) => res.off(event, handler),
      removeAllListeners: event => res.removeAllListeners(event)
    };

    // Pipe ICYWriter to response
    icyWriter.pipe(res);

    let currentTitle = config.station?.name || "RadioBot";

    const updateMetadata = title => {
      currentTitle = title;
      icyWriter.queue(title);
    };

    if (events) {
      events.on("metadata", updateMetadata);
    }

    // Add wrapper to broadcaster
    const cleanup = broadcasters.mp3.add(wrapper);
    console.log(`[Stream] ICY MP3 client connected. Total clients: ${broadcasters.mp3.clientCount}`);

    req.on("close", () => {
      updateListenerCount("shoutcast", streamListeners, -1);
      if (events) {
        events.off("metadata", updateMetadata);
      }
      cleanup();
      icyWriter.unpipe(res);
      console.log(`[Stream] ICY MP3 client disconnected. Total clients: ${broadcasters.mp3.clientCount}`);
    });

    res.on("error", err => {
      console.error("[Stream] ICY response error:", err.message);
      if (events) {
        events.off("metadata", updateMetadata);
      }
      cleanup();
      icyWriter.unpipe(res);
    });
  });

  router.get("/stream.ogg", (req, res) => {
    if (!broadcasters.opus) {
      return res.status(503).json({ error: "Opus encoder not available" });
    }

    updateListenerCount("ogg-icy", streamOggListeners, 1);

    const metaInt = config.icy?.metaInt || 2048;

    req.setTimeout(0);
    res.connection?.setTimeout?.(0);
    res.socket?.setTimeout?.(0);

    res.setHeader("Content-Type", "audio/ogg");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");

    if (config.station?.name) {
      res.setHeader("icy-name", config.station.name);
    }
    if (config.station?.description) {
      res.setHeader("icy-description", config.station.description);
    }
    if (config.station?.url) {
      res.setHeader("icy-url", config.station.url);
    }
    res.setHeader("icy-pub", config.station?.public ? "1" : "0");
    res.setHeader("icy-br", String(config.opus?.bitrate || 256));

    // Handle ICY metadata for OGG stream
    let icyWriter = null;
    let lastTitle = null;

    const setupIcy = () => {
      if (req.headers["icy-metadata"] === "1") {
        res.setHeader("icy-metaint", String(metaInt));
        icyWriter = new ICYWriter(metaInt);
      }
    };

    const sendHeaders = () => {
      if (encoders.opus.idHeader) {
        if (icyWriter) {
          icyWriter.write(encoders.opus.idHeader);
        } else {
          res.write(encoders.opus.idHeader);
        }
      }
      if (encoders.opus.commentHeader) {
        if (icyWriter) {
          icyWriter.write(encoders.opus.commentHeader);
        } else {
          res.write(encoders.opus.commentHeader);
        }
      }
    };

    // Send headers immediately if available
    setupIcy();
    if (encoders.opus.headersReady) {
      sendHeaders();
    }

    let currentTitle = config.station?.name || "RadioBot";

    const updateMetadata = title => {
      currentTitle = title;
      if (icyWriter && title !== lastTitle) {
        icyWriter.queue(title);
        lastTitle = title;
      }
    };

    if (events) {
      events.on("metadata", updateMetadata);
    }

    // Create wrapper for ICY or direct response
    const wrapper = icyWriter
      ? {
          write: chunk => {
            return icyWriter.write(chunk);
          },
          end: () => {
            if (icyWriter) {
              icyWriter.end();
            }
            res.end();
          },
          destroy: err => {
            res.destroy(err);
          },
          get destroyed() {
            return res.destroyed;
          },
          get writableEnded() {
            return res.writableEnded;
          },
          on: (event, handler) => res.on(event, handler),
          off: (event, handler) => res.off(event, handler),
          removeAllListeners: event => res.removeAllListeners(event)
        }
      : res;

    // Pipe ICYWriter to response if using ICY
    if (icyWriter) {
      icyWriter.pipe(res);
    }

    // Add to broadcaster
    const cleanup = broadcasters.opus.add(wrapper);
    console.log(`[Stream] ICY Ogg client connected. Total clients: ${broadcasters.opus.clientCount}`);

    req.on("close", () => {
      updateListenerCount("ogg-icy", streamOggListeners, -1);
      if (events) {
        events.off("metadata", updateMetadata);
      }
      cleanup();
      if (icyWriter) {
        icyWriter.unpipe(res);
      }
      console.log(`[Stream] ICY Ogg client disconnected. Total clients: ${broadcasters.opus.clientCount}`);
    });

    res.on("error", err => {
      console.error("[Stream] Ogg ICY response error:", err.message);
      if (events) {
        events.off("metadata", updateMetadata);
      }
      cleanup();
      if (icyWriter) {
        icyWriter.unpipe(res);
      }
    });
  });

  router.get("/live.m3u8", (req, res) => {
    const segmentDir = encoders?.hls?.segmentDir;

    if (!segmentDir) {
      return res.status(503).json({ error: "HLS encoder not available" });
    }

    const playlistPath = join(segmentDir, "live.m3u8");

    if (!existsSync(playlistPath)) {
      return res.status(404).json({ error: "HLS playlist not ready" });
    }

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-cache");

    const fileStream = createReadStream(playlistPath);
    fileStream.pipe(res);

    fileStream.on("error", err => {
      console.error("[Stream] HLS playlist error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to read playlist" });
      }
    });
  });

  router.get("/seg_:num.mp3", (req, res) => {
    const segmentDir = encoders?.hls?.segmentDir;

    if (!segmentDir) {
      return res.status(503).json({ error: "HLS encoder not available" });
    }

    const segmentNum = req.params.num || req.path.match(/seg_(\d+)\.mp3/)?.[1];

    if (!segmentNum) {
      return res.status(400).json({ error: "Invalid segment number" });
    }

    const segmentPath = join(segmentDir, `seg_${String(segmentNum).padStart(3, "0")}.mp3`);

    if (!existsSync(segmentPath)) {
      return res.status(404).json({ error: "Segment not found" });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");

    const fileStream = createReadStream(segmentPath);
    fileStream.pipe(res);

    fileStream.on("error", err => {
      console.error("[Stream] HLS segment error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to read segment" });
      }
    });
  });

  router.get("/live.raw", (req, res) => {
    if (!broadcasters.raw) {
      return res.status(503).json({ error: "Mixer not available" });
    }

    updateListenerCount("raw-pcm", rawListeners, 1);

    req.setTimeout(0);
    res.connection?.setTimeout?.(0);
    res.socket?.setTimeout?.(0);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Radio-SampleSize", "16");
    res.setHeader("X-Radio-SampleRate", String(config.mixer?.sampleRate || 44100));
    res.setHeader("X-Radio-Channels", String(config.mixer?.channels || 2));

    // Add this response to the broadcaster
    const cleanup = broadcasters.raw.add(res);
    console.log(`[Stream] Raw PCM client connected. Total clients: ${broadcasters.raw.clientCount}`);

    req.on("close", () => {
      updateListenerCount("raw-pcm", rawListeners, -1);
      cleanup();
      console.log(`[Stream] Raw PCM client disconnected. Total clients: ${broadcasters.raw.clientCount}`);
    });

    res.on("error", err => {
      console.error("[Stream] Raw PCM response error:", err.message);
      cleanup();
    });
  });

  return router;
}

export { createStreamRoutes };
export default createStreamRoutes;
