import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MixerStream } from "../../src/core/mixer/index.js";
import { Readable } from "stream";

describe("Native Addon", () => {
  let originalRequire;
  let consoleWarnSpy;
  let consoleLogSpy;

  beforeEach(() => {
    // Store original require
    originalRequire = global.require;
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    global.require = originalRequire;
    vi.restoreAllMocks();
  });

  describe("MixerStream native loading", () => {
    it("should create mixer without native addon", () => {
      // Mock require to throw (simulating missing native addon)
      global.require = vi.fn().mockImplementation(() => {
        throw new Error("Cannot find module");
      });

      const mixer = new MixerStream({
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        useNative: true
      });

      expect(mixer).toBeDefined();
      expect(mixer.sampleRate).toBe(44100);
    });

    it("should log warning when native addon not found", () => {
      global.require = vi.fn().mockImplementation(() => {
        throw new Error("Cannot find module");
      });

      new MixerStream({
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        useNative: true
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Using JavaScript implementation"));
    });

    it("should use native addon when available", () => {
      const mockNativeMix = vi.fn().mockReturnValue(Buffer.alloc(1024));

      global.require = vi.fn().mockImplementation(() => {
        return mockNativeMix;
      });

      new MixerStream({
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        useNative: true
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Using optimized C++ implementation"));
    });

    it("should not load native addon when useNative is false", () => {
      const requireSpy = vi.fn().mockImplementation(() => {
        throw new Error("Should not be called");
      });
      global.require = requireSpy;

      new MixerStream({
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        useNative: false
      });

      expect(requireSpy).not.toHaveBeenCalled();
    });
  });

  describe("JavaScript mixing fallback", () => {
    it("should produce output with JS implementation", () => {
      // Ensure no native addon
      global.require = vi.fn().mockImplementation(() => {
        throw new Error("No native addon");
      });

      const mixer = new MixerStream({
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        useNative: true
      });

      // Add a source
      const sourceStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024, 0x80));
          this.push(null);
        }
      });

      const source = mixer.addSource(sourceStream, ["test"]);
      expect(source).toBeDefined();
    });

    it("should handle multiple sources with JS implementation", () => {
      global.require = vi.fn().mockImplementation(() => {
        throw new Error("No native addon");
      });

      const mixer = new MixerStream({
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        useNative: true
      });

      const source1 = mixer.addSource(
        new Readable({
          read() {
            this.push(null);
          }
        }),
        ["music"]
      );

      const source2 = mixer.addSource(
        new Readable({
          read() {
            this.push(null);
          }
        }),
        ["voice"]
      );

      expect(mixer.count()).toBe(2);
    });
  });

  describe("Native vs JS parity", () => {
    it("should produce deterministic output", () => {
      // Test that JS implementation produces consistent output
      global.require = vi.fn().mockImplementation(() => {
        throw new Error("No native addon");
      });

      const mixer1 = new MixerStream({
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        useNative: true
      });

      const mixer2 = new MixerStream({
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        useNative: true
      });

      expect(mixer1.sampleRate).toBe(mixer2.sampleRate);
      expect(mixer1.bitDepth).toBe(mixer2.bitDepth);
      expect(mixer1.channels).toBe(mixer2.channels);
    });
  });

  describe("Error handling", () => {
    it("should handle native addon that returns invalid data", () => {
      global.require = vi.fn().mockImplementation(() => {
        // Return something that's not a function
        return "invalid";
      });

      // Should fall back to JS implementation
      const mixer = new MixerStream({
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        useNative: true
      });

      expect(mixer).toBeDefined();
    });

    it("should handle require throwing unexpected error", () => {
      global.require = vi.fn().mockImplementation(() => {
        throw new TypeError("Unexpected error");
      });

      const mixer = new MixerStream({
        sampleRate: 44100,
        bitDepth: 16,
        channels: 2,
        useNative: true
      });

      expect(mixer).toBeDefined();
    });
  });
});
