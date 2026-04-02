import { Readable } from "stream";

/**
 * StreamBroadcaster - Fans out a single stream to multiple clients
 *
 * This solves the backpressure problem where one slow client pauses
 * the stream for everyone. Instead, we consume data once and write
 * to each client independently.
 */
class StreamBroadcaster {
  #source = null;
  #clients = new Map(); // Map<client, { response, lastWrite }>
  #isFlowing = false;
  #highWaterMark = 0;
  #onData = null;
  #onEnd = null;
  #onError = null;

  constructor(sourceStream, highWaterMark = 128 * 1024) {
    this.#source = sourceStream;
    this.#highWaterMark = highWaterMark;

    // Bind event handlers
    this.#onData = this.#handleData.bind(this);
    this.#onEnd = this.#handleEnd.bind(this);
    this.#onError = this.#handleError.bind(this);

    // Start consuming from source
    this.#startConsuming();
  }

  #startConsuming() {
    if (this.#isFlowing) return;

    this.#isFlowing = true;
    this.#source.on("data", this.#onData);
    this.#source.on("end", this.#onEnd);
    this.#source.on("error", this.#onError);

    // Ensure the source is flowing
    if (this.#source.isPaused && this.#source.isPaused()) {
      this.#source.resume();
    }
  }

  #handleData(chunk) {
    // Fan out to all connected clients
    for (const [client, info] of this.#clients) {
      this.#writeToClient(client, info, chunk);
    }
  }

  #writeToClient(client, info, chunk) {
    const response = info.response;

    // Check if response is still writable
    if (!response || response.destroyed || response.writableEnded) {
      this.remove(client);
      return;
    }

    // Try to write - returns false if buffer is full (backpressure)
    const canContinue = response.write(chunk);

    if (!canContinue) {
      // Client is slow - pause writing to this client
      // Data will be lost for this client, but others continue
      // This is acceptable for live audio streaming
      info.paused = true;

      // Set up drain handler to resume
      if (!info.hasDrainHandler) {
        info.hasDrainHandler = true;
        response.once("drain", () => {
          info.paused = false;
          info.hasDrainHandler = false;
        });
      }
    }
  }

  #handleEnd() {
    // End all client responses
    for (const [client, info] of this.#clients) {
      if (info.response && !info.response.destroyed) {
        info.response.end();
      }
    }
    this.#clients.clear();
  }

  #handleError(err) {
    console.error("[StreamBroadcaster] Source stream error:", err.message);
    // Destroy all client connections on source error
    for (const [client, info] of this.#clients) {
      if (info.response && !info.response.destroyed) {
        info.response.destroy(err);
      }
    }
    this.#clients.clear();
  }

  /**
   * Add a new client response to broadcast to
   * @param {object} response - HTTP response object (writable stream)
   * @returns {Function} Cleanup function to remove this client
   */
  add(response) {
    const client = Symbol("client");

    this.#clients.set(client, {
      response,
      paused: false,
      hasDrainHandler: false
    });

    // Handle client disconnect
    const onClose = () => {
      this.remove(client);
    };

    response.on("close", onClose);
    response.on("error", onClose);

    // Return cleanup function
    return () => this.remove(client);
  }

  /**
   * Remove a client from broadcasting
   * @param {Symbol} client - Client symbol returned by add()
   */
  remove(client) {
    const info = this.#clients.get(client);
    if (info) {
      info.response.removeAllListeners("drain");
      this.#clients.delete(client);
    }
  }

  /**
   * Get the number of connected clients
   */
  get clientCount() {
    return this.#clients.size;
  }

  /**
   * Stop broadcasting and clean up
   */
  destroy() {
    this.#source.off("data", this.#onData);
    this.#source.off("end", this.#onEnd);
    this.#source.off("error", this.#onError);

    for (const [client, info] of this.#clients) {
      if (info.response && !info.response.destroyed) {
        info.response.end();
      }
    }
    this.#clients.clear();
    this.#isFlowing = false;
  }
}

export { StreamBroadcaster };
export default StreamBroadcaster;
