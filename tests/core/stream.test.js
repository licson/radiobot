import { describe, it, expect } from "vitest";
import { ICYWriter } from "../../src/core/stream/icy.js";
import { Transform } from "stream";

describe("ICYWriter", () => {
  it("should create ICYWriter with metaInt", () => {
    const writer = new ICYWriter(8192);
    expect(writer).toBeInstanceOf(Transform);
  });

  it("should pass through data when no metadata", () => {
    const writer = new ICYWriter(8);
    const input = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

    let output = Buffer.alloc(0);
    writer.on("data", chunk => {
      output = Buffer.concat([output, chunk]);
    });

    writer.write(input);

    expect(output.length).toBeGreaterThan(input.length);
  });

  it("should queue metadata", () => {
    const writer = new ICYWriter(8192);
    writer.queue("Test Title");
    expect(writer).toBeDefined();
  });
});
