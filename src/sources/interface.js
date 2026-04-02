export class SourceInterface {
  static name = "base";

  constructor(config, logger) {
    if (this.constructor === SourceInterface) {
      throw new Error("SourceInterface is abstract and cannot be instantiated directly");
    }
    this.config = config;
    this.logger = logger;
  }

  canHandle(url) {
    throw new Error("canHandle() must be implemented by subclass");
  }

  async getInfo(url) {
    throw new Error("getInfo() must be implemented by subclass");
  }

  async getStream(url) {
    throw new Error("getStream() must be implemented by subclass");
  }

  async getStreamURL(url) {
    throw new Error("getStreamURL() must be implemented by subclass");
  }
}

export default SourceInterface;
