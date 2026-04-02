import { describe, it, expect, beforeEach, vi } from "vitest";
import { PlatformInterface } from "../../src/platforms/interface.js";

class MockPlatform extends PlatformInterface {
  static name = "mock";

  async start() {
    this.connected = true;
  }

  async stop() {
    this.connected = false;
  }

  async sendMessage(chatOrigin, text) {
    return { chatOrigin, text };
  }

  async sendReply(chatOrigin, text) {
    return { chatOrigin, text };
  }

  isAdmin(chatOrigin) {
    return chatOrigin?.isAdmin === true;
  }
}

describe("PlatformInterface", () => {
  let platform;
  let mockRadio;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    mockRadio = {
      queue: {
        length: 5,
        currentTask: { info: { title: "Current Song" } },
        getAllTasks: () => [
          { info: { title: "Song 1" }, execCount: 0 },
          { info: { title: "Song 2" }, execCount: 1 }
        ]
      },
      songList: [{ name: "User1", title: "Test Song", artist: "Artist1", file: "test.mp3" }]
    };

    mockConfig = {
      queueSize: 10
    };

    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    platform = new MockPlatform(mockRadio, mockConfig, mockLogger);
  });

  it("should not be instantiable directly", () => {
    expect(() => {
      new PlatformInterface(mockRadio, mockConfig, mockLogger);
    }).toThrow("PlatformInterface is abstract");
  });

  it("should start and stop correctly", async () => {
    expect(platform.connected).toBe(false);
    await platform.start();
    expect(platform.connected).toBe(true);
    await platform.stop();
    expect(platform.connected).toBe(false);
  });

  it("should generate playlist text", () => {
    const text = platform.getPlayListText();

    expect(text).toContain("Playing:");
    expect(text).toContain("Current Song");
    expect(text).toContain("Music To Play:");
    expect(text).toContain("Song 1");
    expect(text).toContain("Song 2");
    expect(text).toContain("played 1 time");
  });

  it("should generate song list text", () => {
    const text = platform.getSongListText(mockRadio.songList);

    expect(text).toContain("Recent songs:");
    expect(text).toContain("song_1");
    expect(text).toContain("User1");
    expect(text).toContain("Test Song");
    expect(text).toContain("Artist1");
  });

  it("should handle empty song list", () => {
    const text = platform.getSongListText([]);

    expect(text).toBe("There are no songs in the list.");
  });

  it("should check if queue is full", () => {
    expect(platform.isQueueFull()).toBe(false);

    mockRadio.queue.length = 10;
    expect(platform.isQueueFull()).toBe(true);
  });

  it("should check admin status", () => {
    expect(platform.isAdmin({ isAdmin: false })).toBe(false);
    expect(platform.isAdmin({ isAdmin: true })).toBe(true);
  });
});
