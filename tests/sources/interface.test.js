import { describe, it, expect, beforeEach, vi } from "vitest";
import { SourceInterface } from "../../src/sources/interface.js";
import { SourceManager } from "../../src/sources/manager.js";

import { YouTubeSource } from "../../src/sources/youtube/index.js";
import { SoundCloudSource } from "../../src/sources/soundcloud/index.js";
import { HTTPSource } from "../../src/sources/http/index.js";
import { TelegramSource } from "../../src/sources/telegram/index.js";

class MockSource extends SourceInterface {
  static name = "mock";

  constructor(config, logger) {
    super(config, logger);
    this.canHandle = vi.fn();
    this.getInfo = vi.fn();
    this.getStream = vi.fn();
    this.getStreamURL = vi.fn();
  }
}

describe("SourceInterface", () => {
  it("should not be instantiable directly", () => {
    expect(() => {
      new SourceInterface({}, {});
    }).toThrow("SourceInterface is abstract");
  });
});

describe("YouTubeSource", () => {
  let source;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    mockConfig = {};
    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    source = new YouTubeSource(mockConfig, mockLogger);
  });

  it("should extract video ID from YouTube URLs", () => {
    expect(source.extractVideoId("https://www.youtube.com/watch?v=dQw4w9WxXmQ")).toBe("dQw4w9WxXmQ");
    expect(source.extractVideoId("https://youtu.be/dQw4w9WxXmQ")).toBe("dQw4w9WxXmQ");
    expect(source.extractVideoId("https://www.youtube.com/embed/dQw4w9WxXmQ")).toBe("dQw4w9WxXmQ");
    expect(source.extractVideoId("https://www.youtube.com/v/dQw4w9WxXmQ")).toBe("dQw4w9WxXmQ");
    expect(source.extractVideoId("https://youtube.com/shorts/dQw4w9WxXmQ")).toBe("dQw4w9WxXmQ");
    expect(source.extractVideoId("not a youtube video")).toBe(null);
  });

  it("should identify valid YouTube URLs", () => {
    expect(source.canHandle("https://www.youtube.com/watch?v=dQw4w9WxXmQ")).toBe(true);
    expect(source.canHandle("https://youtu.be/dQw4w9WxXmQ")).toBe(true);
    expect(source.canHandle("https://www.youtube.com/embed/dQw4w9WxXmQ")).toBe(true);
    expect(source.canHandle("https://www.youtube.com/v/dQw4w9WxXmQ")).toBe(true);
    expect(source.canHandle("https://youtube.com/shorts/dQw4w9WxXmQ")).toBe(true);
    expect(source.canHandle("https://example.com/video")).toBe(false);
  });
});

describe("SoundCloudSource", () => {
  let source;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    mockConfig = {};
    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    source = new SoundCloudSource(mockConfig, mockLogger);
  });

  it("should identify SoundCloud URLs", () => {
    expect(source.canHandle("https://soundcloud.com/user/track")).toBe(true);
    expect(source.canHandle("https://www.soundcloud.com/user/track")).toBe(true);
    expect(source.canHandle("https://example.com/audio.mp3")).toBe(false);
  });
});

describe("HTTPSource", () => {
  let source;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    mockConfig = {};
    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    source = new HTTPSource(mockConfig, mockLogger);
  });

  it("should identify HTTP URLs", () => {
    expect(source.canHandle("https://example.com/audio.mp3")).toBe(true);
    expect(source.canHandle("http://example.com/stream")).toBe(true);
    expect(source.canHandle("ftp://example.com/file.mp3")).toBe(false);
  });
});

describe("TelegramSource", () => {
  let source;
  let mockConfig;
  let mockLogger;
  let mockBot;

  beforeEach(() => {
    mockConfig = { telegram: { token: "test-token" } };
    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    mockBot = {
      api: {
        getFile: vi.fn().mockResolvedValue({ file_path: "/path/to/file.mp3" })
      }
    };
    source = new TelegramSource(mockConfig, mockLogger, mockBot);
  });

  it("should identify Telegram file URLs", () => {
    expect(source.canHandle("telegram:ABC123")).toBe(true);
    expect(source.canHandle("telegram:file_id_456")).toBe(true);
    expect(source.canHandle("https://example.com/file")).toBe(false);
  });

  it("should extract file ID from URL", () => {
    expect(source.extractFileId("telegram:ABC123")).toBe("ABC123");
    expect(source.extractFileId("telegram:file_id_456")).toBe("file_id_456");
    expect(source.extractFileId("https://example.com")).toBe(null);
  });

  it("should get info", async () => {
    const info = await source.getInfo("telegram:ABC123");
    expect(info.fileId).toBe("ABC123");
  });

  it("should get stream URL", async () => {
    mockBot.api.getFile.mockResolvedValue({ file_path: "/path/to/file.mp3" });

    const result = await source.getStreamURL("telegram:ABC123");
    expect(result.url).toContain("/file/bottest-token/");
  });
});

describe("SourceManager", () => {
  let manager;
  let mockConfig;
  let mockLogger;
  let mockBot;

  beforeEach(() => {
    mockConfig = {};
    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    mockBot = null;
    manager = new SourceManager(mockConfig, mockLogger, mockBot);
  });

  it("should initialize sources", async () => {
    const count = await manager.init();
    expect(count).toBe(4);
    expect(manager.sources.length).toBe(4);
  });

  it("should register custom sources", () => {
    class CustomSource {
      static name = "custom";
      canHandle() {
        return true;
      }
    }

    manager.register("custom", CustomSource);
    expect(manager.customSources.has("custom")).toBe(true);
  });

  it("should set source order", () => {
    manager.setOrder(["http", "youtube"]);
    expect(manager.order).toEqual(["http", "youtube"]);
  });

  it("should find matching source", () => {
    manager.sources = [
      { name: "youtube", instance: { canHandle: url => url.includes("youtube") } },
      { name: "soundcloud", instance: { canHandle: url => url.includes("soundcloud") } },
      { name: "http", instance: { canHandle: url => url.startsWith("http") } }
    ];

    const youtube = manager.find("https://www.youtube.com/watch?v=test");
    expect(youtube.name).toBe("youtube");

    const soundcloud = manager.find("https://soundcloud.com/user/track");
    expect(soundcloud.name).toBe("soundcloud");

    const http = manager.find("https://example.com/audio.mp3");
    expect(http.name).toBe("http");
  });

  it("should return null when no source matches", () => {
    manager.sources = [{ name: "youtube", instance: { canHandle: () => false } }];

    const result = manager.find("https://example.com/audio.mp3");
    expect(result).toBeNull();
  });
});
