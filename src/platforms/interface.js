export class PlatformInterface {
  static name = "base";

  constructor(radio, config, logger) {
    if (this.constructor === PlatformInterface) {
      throw new Error("PlatformInterface is abstract and cannot be instantiated directly");
    }
    this.radio = radio;
    this.config = config;
    this.logger = logger;
    this.connected = false;
  }

  async start() {
    throw new Error("start() must be implemented by subclass");
  }

  async stop() {
    throw new Error("stop() must be implemented by subclass");
  }

  async sendMessage(chatOrigin, text) {
    throw new Error("sendMessage() must be implemented by subclass");
  }

  async sendReply(chatOrigin, text) {
    throw new Error("sendReply() must be implemented by subclass");
  }

  isAdmin(chatOrigin) {
    return false;
  }

  isQueueFull() {
    return this.radio.queue?.length >= (this.config.queueSize || 10);
  }

  getPlayListText() {
    const queue = this.radio.queue;
    let output = "";

    if (queue?.currentTask) {
      output += "Playing:\n";
      output += `-> ${queue.currentTask.info.title}\n`;
    }

    output += "Music To Play:\n";

    if (queue) {
      output += queue
        .getAllTasks()
        .map(task => {
          const played = task.execCount > 0 ? ` (played ${task.execCount} time${task.execCount > 1 ? "s" : ""})` : "";
          return `-- ${task.info.title}${played}`;
        })
        .join("\n");
    }

    return output || "Queue is empty";
  }

  getSongListText(songList) {
    if (!songList || songList.length === 0) {
      return "There are no songs in the list.";
    }

    let output = "Recent songs:\n";
    songList.forEach((item, i) => {
      output += `song_${i + 1} uploaded by ${item.name}`;
      if (item.title) {
        output += ` (${item.title}`;
        if (item.artist) {
          output += ` performed by ${item.artist}`;
        }
        output += ")";
      }
      output += "\n";
    });

    return output;
  }
}

export default PlatformInterface;
