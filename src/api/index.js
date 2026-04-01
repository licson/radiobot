import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { createCorsMiddleware } from './middleware/index.js';
import { createInfoRoutes, createTitleRoutes, createQueueRoutes, createStreamRoutes } from './routes/index.js';
import { createSocketHandler } from './socket/index.js';
import { Analytics } from './analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class APIServer {
  #app = null;
  #server = null;
  #io = null;
  #config = null;
  #mixer = null;
  #queue = null;
  #encoders = null;
  #events = null;
  #analytics = null;
  #titleRoutes = null;

  constructor() {
    this.#app = express();
    this.#server = http.createServer(this.#app);
    this.#analytics = new Analytics();
  }

  init({ config, mixer, queue, encoders, events }) {
    this.#config = config;
    this.#mixer = mixer;
    this.#queue = queue;
    this.#encoders = encoders;
    this.#events = events;

    this.#setupMiddleware();
    this.#setupRoutes();
    this.#setupSocketIO();
    this.#setupErrorHandling();
    this.#setupMetadataWire();

    return this;
  }

  #setupMiddleware() {
    this.#app.set('x-powered-by', false);

    this.#app.use((req, res, next) => {
      res.header('Server', 'radiobot');
      next();
    });

    const corsMiddleware = createCorsMiddleware({
      allowCrossOrigin: this.#config.http?.allowCrossOrigin ?? false,
      originWhitelist: this.#config.http?.originWhitelist ?? []
    });
    this.#app.use(corsMiddleware);

    this.#app.use(express.json());
    this.#app.use(express.urlencoded({ extended: true }));
  }

  #setupRoutes() {
    const apiContext = {
      config: this.#config,
      mixer: this.#mixer,
      queue: this.#queue,
      analytics: this.#analytics
    };

    const infoRouter = createInfoRoutes(apiContext);
    this.#app.use('/info', infoRouter);
    this.#app.use('/status', infoRouter);

    this.#titleRoutes = createTitleRoutes(apiContext);
    this.#app.use('/title', this.#titleRoutes.router);

    const queueRouter = createQueueRoutes(apiContext);
    this.#app.use('/queue', queueRouter);

    const streamContext = {
      config: this.#config,
      encoders: this.#encoders,
      mixer: this.#mixer,
      events: this.#events,
      analytics: this.#analytics
    };
    const streamRouter = createStreamRoutes(streamContext);
    this.#app.use('/', streamRouter);

    this.#app.get('/', (req, res) => {
      if (this.#config.station?.url) {
        return res.redirect(this.#config.station.url);
      }
      res.redirect('/player/');
    });

    this.#app.use('/player', express.static(path.join(__dirname, 'public', 'player')));
    this.#app.use('/microphone', express.static(path.join(__dirname, 'public', 'microphone')));
    this.#app.use('/components', express.static(path.join(__dirname, 'public', 'components')));
  }

  #setupSocketIO() {
    const ioOptions = this.#getSocketIOOptions();

    this.#io = new SocketIOServer(this.#server, ioOptions);

    const socketHandler = createSocketHandler({
      mixer: this.#mixer,
      config: this.#config
    });

    this.#io.on('connection', socketHandler);
  }

  #getSocketIOOptions() {
    if (!this.#config.http?.allowCrossOrigin) {
      return {
        cors: {
          origin: this.#config.http?.host || '*',
          methods: ['GET', 'POST']
        }
      };
    }

    if (this.#config.http?.originWhitelist?.length === 0) {
      return {
        cors: {
          origin: '*',
          methods: ['GET', 'POST']
        }
      };
    }

    const allowedOrigins = [this.#config.http?.host, ...(this.#config.http?.originWhitelist || [])].filter(Boolean);

    return {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST']
      }
    };
  }

  #setupErrorHandling() {
    this.#app.use((err, req, res, next) => {
      console.error('[API Error]', err);
      res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error'
      });
    });

    this.#app.use((req, res) => {
      res.status(404).json({ error: 'Not Found' });
    });
  }

  #setupMetadataWire() {
    if (this.#events) {
      this.#events.on('metadata', title => {
        this.setMetadata(title);
      });
    }
  }

  setMetadata(title) {
    if (this.#titleRoutes) {
      this.#titleRoutes.setMetadata(title);
    }
  }

  getAnalytics() {
    return this.#analytics;
  }

  getSocketIO() {
    return this.#io;
  }

  getApp() {
    return this.#app;
  }

  start(port) {
    return new Promise(resolve => {
      this.#server.setTimeout(0);
      this.#server.listen(port, () => {
        console.log(`[API] Server listening on port ${port}`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (this.#io) {
        this.#io.close();
      }
      this.#server.close(err => {
        if (err) {
          reject(err);
        } else {
          console.log('[API] Server stopped');
          resolve();
        }
      });
    });
  }
}

export { APIServer };
export default APIServer;
