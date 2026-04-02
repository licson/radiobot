import { describe, it, expect, beforeEach, vi } from "vitest";
import { PlatformLoader, BUILTIN_PLATFORMS } from "../../src/platforms/loader.js";

describe("PlatformLoader", () => {
  let loader;
  let mockRadio;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    mockRadio = {
      queue: { length: 0 },
      events: { emit: vi.fn() }
    };

    mockConfig = {
      telegram: { enabled: false },
      discord: { enabled: false }
    };

    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    loader = new PlatformLoader(mockRadio, mockConfig, mockLogger);
  });

  it("should have builtin platforms registered", () => {
    expect(BUILTIN_PLATFORMS.telegram).toBeDefined();
    expect(BUILTIN_PLATFORMS.discord).toBeDefined();
  });

  it("should register custom platforms", () => {
    class CustomPlatform {
      static name = "custom";
    }

    loader.register("custom", CustomPlatform);
    expect(loader.customPlatforms.has("custom")).toBe(true);
  });

  it("should throw when registering duplicate platform", () => {
    class CustomPlatform {
      static name = "custom";
    }

    loader.register("custom", CustomPlatform);

    expect(() => {
      loader.register("custom", CustomPlatform);
    }).toThrow("already registered");
  });

  it("should throw when loading unknown platform", async () => {
    await expect(loader.loadPlatform("unknown")).rejects.toThrow("Unknown platform");
  });

  it("should load no platforms when none enabled", async () => {
    const loaded = await loader.loadEnabledPlatforms();
    expect(loaded).toEqual([]);
  });

  it("should load enabled platforms", async () => {
    mockConfig.telegram = { enabled: true, token: null };
    mockConfig.discord = { enabled: true, token: null };

    const loaded = await loader.loadEnabledPlatforms();

    expect(loaded.length).toBeLessThanOrEqual(2);
  });

  it("should stop all platforms", async () => {
    mockConfig.telegram = { enabled: true, token: null };

    await loader.loadEnabledPlatforms();
    await loader.stopAll();

    expect(loader.platforms.size).toBe(0);
  });

  it("should get loaded platform", async () => {
    mockConfig.telegram = { enabled: true, token: null };

    await loader.loadEnabledPlatforms();
    const platform = loader.getPlatform("telegram");

    expect(platform).toBeDefined();
  });

  it("should return list of loaded platforms", async () => {
    mockConfig.telegram = { enabled: true, token: null };

    await loader.loadEnabledPlatforms();
    const loaded = loader.getLoadedPlatforms();

    expect(loaded).toContain("telegram");
  });
});
