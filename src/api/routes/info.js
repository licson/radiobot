import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';

export function createInfoRoutes({ config, analytics, queue }) {
  const router = Router();

  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      res.header('Content-Type', 'text/plain');
      res.send(`active_conn=${analytics.getTotalListeners()}
rss=${process.memoryUsage().rss}
uptime=${process.uptime()}`);
    })
  );

  router.get(
    '/info',
    asyncHandler(async (req, res) => {
      const currentTitle = queue.currentTask?.info?.title || config.station.name;

      res.json({
        'station-name': config.station.name,
        url: config.station.url,
        description: config.station.description,
        bitrate: config.output.bitrate,
        title: currentTitle
      });
    })
  );

  return router;
}

export default createInfoRoutes;
