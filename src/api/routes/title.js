import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';

export function createTitleRoutes({ config, queue }) {
  const router = Router();

  const pollingConnections = [];
  const sseConnections = [];
  let currentTitle = '';

  function queueToObject(queue) {
    return {
      current: queue.currentTask ? queue.currentTask.info : null,
      nexts: queue.getAllTasks().map(task => task.info)
    };
  }

  function writeSSE(res, eventName, data) {
    res.write(`event: ${eventName}\r\ndata: ${data.replace(/\r?\n/g, '\r\ndata: ')}\r\n\r\n`);
  }

  function keepSSEAlive(res) {
    res.sseKeepAliveTimer = setInterval(() => {
      res.write(': ' + Date.now() + '\r\n\r\n');
    }, 30000);
  }

  queue.on('push', () => {
    sseConnections.forEach(res => {
      writeSSE(res, 'songList', JSON.stringify(queueToObject(queue)));
    });
  });

  queue.on('next', () => {
    sseConnections.forEach(res => {
      writeSSE(res, 'songList', JSON.stringify(queueToObject(queue)));
    });
  });

  function setMetadata(title) {
    currentTitle = title;

    pollingConnections.forEach(res => {
      res.jsonp({ change: true, title });
    });
    pollingConnections.length = 0;

    sseConnections.forEach(res => {
      writeSSE(res, 'title', title);
    });
  }

  router.get(
    '/poll',
    asyncHandler(async (req, res) => {
      res.header('Cache-Control', 'no-cache');

      req.on('close', () => {
        const index = pollingConnections.indexOf(res);
        if (index >= 0) {
          pollingConnections.splice(index, 1);
        }
      });

      pollingConnections.push(res);

      setTimeout(() => {
        const index = pollingConnections.indexOf(res);
        if (index >= 0) {
          res.jsonp({ change: false, title: currentTitle });
          pollingConnections.splice(index, 1);
        }
      }, 40000);
    })
  );

  router.get(
    '/sse',
    asyncHandler(async (req, res) => {
      res.header({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache'
      });
      res.write('');

      req.on('close', () => {
        const index = sseConnections.indexOf(res);
        clearInterval(res.sseKeepAliveTimer);
        if (index >= 0) {
          sseConnections.splice(index, 1);
        }
      });

      sseConnections.push(res);
      res.write('retry: 1000\r\n\r\n');

      writeSSE(
        res,
        'info',
        JSON.stringify({
          'station-name': config.station.name,
          url: config.station.url,
          description: config.station.description,
          bitrate: config.output.bitrate
        })
      );

      writeSSE(res, 'title', currentTitle);
      writeSSE(res, 'songList', JSON.stringify(queueToObject(queue)));
      keepSSEAlive(res);
    })
  );

  router.get(
    '/cover',
    asyncHandler(async (req, res) => {
      if (queue.currentTask != null) {
        const info = queue.currentTask.info.title.split('-');
        res.redirect('/components/default-artwork.png');
      } else {
        res.redirect('/components/default-artwork.png');
      }
    })
  );

  return { router, setMetadata, getCurrentTitle: () => currentTitle };
}

export default createTitleRoutes;
