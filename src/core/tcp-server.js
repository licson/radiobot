import { createServer } from 'net';

class TCPServer {
  #server = null;
  #mixer = null;
  #config = null;
  #logger = null;
  #port = 0;

  constructor(mixer, config, logger) {
    this.#mixer = mixer;
    this.#config = config;
    this.#logger = logger;
    this.#port = config.tcp?.port || config.ports?.helper || 0;
  }

  start() {
    if (!this.#port) {
      this.#logger.log('[TCPServer] No port configured, TCP server disabled');
      return;
    }

    this.#server = createServer(socket => {
      const remoteAddress = socket.remoteAddress;
      const remotePort = socket.remotePort;

      this.#logger.log(`[TCPServer] Accepting connection from ${remoteAddress}:${remotePort}`);

      const source = this.#mixer.addSource(socket, ['tcp']);

      socket.on('error', err => {
        this.#logger.error(`[TCPServer] Socket error from ${remoteAddress}:${remotePort}: ${err.message}`);
      });

      socket.on('close', () => {
        this.#logger.log(`[TCPServer] Connection closed from ${remoteAddress}:${remotePort}`);
      });
    });

    this.#server.listen(this.#port, () => {
      this.#logger.log(`[TCPServer] Listening on port ${this.#port} waiting for push connections`);
    });

    this.#server.on('error', err => {
      this.#logger.error(`[TCPServer] Server error: ${err.message}`);
    });
  }

  stop() {
    if (this.#server) {
      this.#server.close();
      this.#logger.log('[TCPServer] Server stopped');
    }
  }

  get port() {
    return this.#port;
  }
}

export { TCPServer };
export default TCPServer;
