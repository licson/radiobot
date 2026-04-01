import { Router } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { ICYWriter } from '../../core/stream/icy.js';
import { findOggPage } from '../../core/stream/ogg-helpers.js';

function createStreamRoutes(context) {
  const router = Router();
  const { config, encoders, mixer, events } = context;

  router.get('/live.mp3', (req, res) => {
    if (!encoders?.mp3?.stream) {
      return res.status(503).json({ error: 'MP3 encoder not available' });
    }

    req.setTimeout(0);
    res.connection?.setTimeout?.(0);
    res.socket?.setTimeout?.(0);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');

    if (config.station?.name) {
      res.setHeader('icy-name', config.station.name);
    }
    if (config.station?.description) {
      res.setHeader('icy-description', config.station.description);
    }
    if (config.station?.url) {
      res.setHeader('icy-url', config.station.url);
    }
    res.setHeader('icy-pub', config.station?.public ? '1' : '0');
    res.setHeader('icy-metaint', '0');

    const stream = encoders.mp3.stream;
    stream.pipe(res);

    req.on('close', () => {
      stream.unpipe(res);
    });

    res.on('error', err => {
      console.error('[Stream] MP3 response error:', err.message);
      stream.unpipe(res);
    });
  });

  router.get('/live.ogg', (req, res) => {
    if (!encoders?.opus?.stream) {
      return res.status(503).json({ error: 'Opus encoder not available' });
    }

    req.setTimeout(0);
    res.connection?.setTimeout?.(0);
    res.socket?.setTimeout?.(0);

    res.setHeader('Content-Type', 'audio/ogg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');

    if (config.station?.name) {
      res.setHeader('icy-name', config.station.name);
    }
    if (config.station?.description) {
      res.setHeader('icy-description', config.station.description);
    }

    const stream = encoders.opus.stream;

    if (encoders.opus.headersReady) {
      if (encoders.opus.idHeader) {
        res.write(encoders.opus.idHeader);
      }
      if (encoders.opus.commentHeader) {
        res.write(encoders.opus.commentHeader);
      }
    } else {
      encoders.opus.onHeadersReady(() => {
        if (encoders.opus.idHeader) {
          res.write(encoders.opus.idHeader);
        }
        if (encoders.opus.commentHeader) {
          res.write(encoders.opus.commentHeader);
        }
      });
    }

    stream.pipe(res);

    req.on('close', () => {
      stream.unpipe(res);
    });

    res.on('error', err => {
      console.error('[Stream] Ogg response error:', err.message);
      stream.unpipe(res);
    });
  });

  router.get('/stream', (req, res) => {
    if (!encoders?.mp3?.stream) {
      return res.status(503).json({ error: 'MP3 encoder not available' });
    }

    const metaInt = config.icy?.metaInt || 2048;

    req.setTimeout(0);
    res.connection?.setTimeout?.(0);
    res.socket?.setTimeout?.(0);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('icy-metaint', String(metaInt));

    if (config.station?.name) {
      res.setHeader('icy-name', config.station.name);
    }
    if (config.station?.description) {
      res.setHeader('icy-description', config.station.description);
    }
    if (config.station?.url) {
      res.setHeader('icy-url', config.station.url);
    }
    res.setHeader('icy-pub', config.station?.public ? '1' : '0');
    res.setHeader('icy-br', String(config.mp3?.bitrate || 192));

    const icyWriter = new ICYWriter(metaInt);
    const mp3Stream = encoders.mp3.stream;

    mp3Stream.pipe(icyWriter).pipe(res);

    let currentTitle = config.station?.name || 'RadioBot';

    const updateMetadata = title => {
      currentTitle = title;
      icyWriter.queue(title);
    };

    if (events) {
      events.on('metadata', updateMetadata);
    }

    req.on('close', () => {
      if (events) {
        events.off('metadata', updateMetadata);
      }
      mp3Stream.unpipe(icyWriter);
      icyWriter.unpipe(res);
    });

    res.on('error', err => {
      console.error('[Stream] ICY response error:', err.message);
      if (events) {
        events.off('metadata', updateMetadata);
      }
      mp3Stream.unpipe(icyWriter);
      icyWriter.unpipe(res);
    });
  });

  router.get('/stream.ogg', (req, res) => {
    if (!encoders?.opus?.stream) {
      return res.status(503).json({ error: 'Opus encoder not available' });
    }

    const metaInt = config.icy?.metaInt || 2048;

    req.setTimeout(0);
    res.connection?.setTimeout?.(0);
    res.socket?.setTimeout?.(0);

    res.setHeader('Content-Type', 'audio/ogg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');

    if (config.station?.name) {
      res.setHeader('icy-name', config.station.name);
    }
    if (config.station?.description) {
      res.setHeader('icy-description', config.station.description);
    }
    if (config.station?.url) {
      res.setHeader('icy-url', config.station.url);
    }
    res.setHeader('icy-pub', config.station?.public ? '1' : '0');
    res.setHeader('icy-br', String(config.opus?.bitrate || 256));

    // Handle ICY metadata for OGG stream
    let icyWriter = null;
    let lastTitle = null;

    const setupIcy = () => {
      if (req.headers['icy-metadata'] === '1') {
        res.setHeader('icy-metaint', String(metaInt));
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

    const waitForFrame = cb => {
      const checkFrame = () => {
        const stream = encoders.opus.stream;
        const onData = data => {
          const pos = findOggPage(data);
          if (pos >= 0) {
            stream.pause();
            stream.off('data', onData);
            cb(data.subarray(pos));
          }
        };
        stream.on('data', onData);
        stream.resume();
      };
      checkFrame();
    };

    let currentTitle = config.station?.name || 'RadioBot';

    const updateMetadata = title => {
      currentTitle = title;
      if (icyWriter && title !== lastTitle) {
        icyWriter.queue(title);
        lastTitle = title;
      }
    };

    setupIcy();

    if (events) {
      events.on('metadata', updateMetadata);
    }

    const stream = encoders.opus.stream;

    if (encoders.opus.headersReady) {
      sendHeaders();
      if (icyWriter) {
        icyWriter.pipe(res);
        stream.pipe(icyWriter);
        icyWriter.queue(currentTitle);
      } else {
        stream.pipe(res);
      }
    } else {
      encoders.opus.onHeadersReady(() => {
        waitForFrame(frameData => {
          sendHeaders();
          if (icyWriter) {
            icyWriter.write(frameData);
            icyWriter.pipe(res);
            stream.pipe(icyWriter);
            icyWriter.queue(currentTitle);
          } else {
            res.write(frameData);
            stream.pipe(res);
          }
        });
      });
    }

    req.on('close', () => {
      if (events) {
        events.off('metadata', updateMetadata);
      }
      stream.unpipe(icyWriter || res);
      if (icyWriter) {
        icyWriter.unpipe(res);
      }
    });

    res.on('error', err => {
      console.error('[Stream] Ogg ICY response error:', err.message);
      if (events) {
        events.off('metadata', updateMetadata);
      }
      stream.unpipe(icyWriter || res);
      if (icyWriter) {
        icyWriter.unpipe(res);
      }
    });
  });

  router.get('/live.m3u8', (req, res) => {
    const segmentDir = encoders?.hls?.segmentDir;

    if (!segmentDir) {
      return res.status(503).json({ error: 'HLS encoder not available' });
    }

    const playlistPath = join(segmentDir, 'live.m3u8');

    if (!existsSync(playlistPath)) {
      return res.status(404).json({ error: 'HLS playlist not ready' });
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');

    const fileStream = createReadStream(playlistPath);
    fileStream.pipe(res);

    fileStream.on('error', err => {
      console.error('[Stream] HLS playlist error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read playlist' });
      }
    });
  });

  router.get('/seg_:num.mp3', (req, res) => {
    const segmentDir = encoders?.hls?.segmentDir;

    if (!segmentDir) {
      return res.status(503).json({ error: 'HLS encoder not available' });
    }

    const segmentNum = req.params.num || req.path.match(/seg_(\d+)\.mp3/)?.[1];

    if (!segmentNum) {
      return res.status(400).json({ error: 'Invalid segment number' });
    }

    const segmentPath = join(segmentDir, `seg_${String(segmentNum).padStart(3, '0')}.mp3`);

    if (!existsSync(segmentPath)) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const fileStream = createReadStream(segmentPath);
    fileStream.pipe(res);

    fileStream.on('error', err => {
      console.error('[Stream] HLS segment error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read segment' });
      }
    });
  });

  router.get('/live.raw', (req, res) => {
    if (!mixer) {
      return res.status(503).json({ error: 'Mixer not available' });
    }

    req.setTimeout(0);
    res.connection?.setTimeout?.(0);
    res.socket?.setTimeout?.(0);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Radio-SampleSize', '16');
    res.setHeader('X-Radio-SampleRate', String(config.mixer?.sampleRate || 44100));
    res.setHeader('X-Radio-Channels', String(config.mixer?.channels || 2));

    mixer.pipe(res, { end: false });

    req.on('close', () => {
      mixer.unpipe(res);
    });

    res.on('error', err => {
      console.error('[Stream] Raw PCM response error:', err.message);
      mixer.unpipe(res);
    });
  });

  return router;
}

export { createStreamRoutes };
export default createStreamRoutes;
