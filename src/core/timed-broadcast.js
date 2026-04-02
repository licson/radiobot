import { schedule } from "node-cron";

class TimedBroadcast {
  #radio;
  #config;
  #logger;
  #tasks = [];

  constructor(radio, config, logger) {
    this.#radio = radio;
    this.#config = config;
    this.#logger = logger;
  }

  start() {
    if (!this.#config.timedBroadcast?.enabled) {
      this.#logger.log("[TimedBroadcast] Not enabled, skipping initialization");
      return;
    }

    this.#logger.log("[TimedBroadcast] Initializing scheduled broadcasts");

    // Schedule queue start check every minute
    this.#tasks.push(
      schedule("* * * * *", () => {
        this.#radio.queue?.start();
      })
    );

    // Schedule time announcement every hour
    this.#tasks.push(
      schedule("0 * * * *", () => {
        this.#announceTime();
      })
    );

    // Schedule advertisement every 15 minutes
    this.#tasks.push(
      schedule("*/15 * * * *", () => {
        this.#playAdvertisement();
      })
    );

    this.#logger.log("[TimedBroadcast] Scheduled tasks started");
  }

  stop() {
    for (const task of this.#tasks) {
      task.stop();
    }
    this.#tasks = [];
    this.#logger.log("[TimedBroadcast] All scheduled tasks stopped");
  }

  async #announceTime() {
    try {
      const { format } = await import("date-fns");
      const timeFormat = this.#config.timedBroadcast?.timeFormat || "h:mm A";
      const timeString = format(new Date(), timeFormat);
      const text = `The time now is ${timeString}.`;

      this.#logger.log(`[TimedBroadcast] Announcing time: ${text}`);
      this.#radio.doTTS?.(text);
    } catch (err) {
      // Fallback if date-fns is not available
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes().toString()
.padStart(2, "0");
      const ampm = hours >= 12 ? "PM" : "AM";
      const displayHours = hours % 12 || 12;
      const text = `The time now is ${displayHours}:${minutes} ${ampm}.`;

      this.#logger.log(`[TimedBroadcast] Announcing time: ${text}`);
      this.#radio.doTTS?.(text);
    }
  }

  async #playAdvertisement() {
    const adConfig = this.#config.timedBroadcast;
    if (!adConfig?.advertisement && !adConfig?.advertisementTrack) {
      return;
    }

    this.#logger.log("[TimedBroadcast] Playing advertisement");

    const queue = this.#radio.queue;
    if (!queue) return;

    // Create advertisement task
    const adTask = async cb => {
      this.#radio.events?.emit("metadata", "Advertisement Time");

      try {
        if (adConfig.advertisementTrack) {
          // Try to play the advertisement track first
          const handler = this.#radio.urlHandlers?.find(adConfig.advertisementTrack);
          if (handler) {
            const urlObj = await handler.getStreamURL();
            // urlObj can be either a string (backward compatibility) or { url: string, format: string }
            const url = typeof urlObj === "string" ? urlObj : urlObj?.url;
            if (url) {
              return this.#radio.doBroadcast?.(url)(cb);
            }
          }
        }
        // Fallback to TTS
        return this.#radio.doBroadcast?.(this.#getTTSAudioUrl(adConfig.advertisement))(cb);
      } catch (err) {
        // If track fails, fall back to TTS
        return this.#radio.doBroadcast?.(this.#getTTSAudioUrl(adConfig.advertisement))(cb);
      }
    };

    queue.unshift(adTask, {
      uid: `tts://${adConfig.advertisement}`,
      type: "Advertisement",
      title: "Advertisement Time",
      text: adConfig.advertisement
    });

    queue.start();
  }

  #getTTSAudioUrl(text) {
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en-GB&client=tw-ob`;
  }
}

export { TimedBroadcast };
export default TimedBroadcast;
