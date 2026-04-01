import { Transform } from 'stream';

const META_MAX_SIZE = 4080;

class ICYWriter extends Transform {
  #metaInt;
  #bytesUntilMeta;
  #pendingMeta = null;
  #metaBuffer;

  constructor(metaInt) {
    super();
    this.#metaInt = metaInt;
    this.#bytesUntilMeta = metaInt;
    this.#metaBuffer = Buffer.alloc(META_MAX_SIZE + 2);
  }

  queue(title) {
    this.#pendingMeta = title;
  }

  #writeMeta(title) {
    if (!title) {
      this.#metaBuffer[0] = 0;
      return 1;
    }

    const metaStr = `StreamTitle='${title.replace(/'/g, '')}';`;
    const metaBytes = Buffer.byteLength(metaStr, 'ascii');

    const paddedLen = Math.ceil(metaBytes / 16) * 16;

    if (paddedLen > META_MAX_SIZE) {
      this.#metaBuffer[0] = 0;
      return 1;
    }

    this.#metaBuffer[0] = paddedLen / 16;
    this.#metaBuffer.write(metaStr, 1, 'ascii');

    for (let i = metaBytes + 1; i <= paddedLen; i++) {
      this.#metaBuffer[i] = 0;
    }

    return paddedLen + 1;
  }

  _transform(chunk, encoding, callback) {
    let offset = 0;
    const chunks = [];

    while (offset < chunk.length) {
      const bytesToWrite = Math.min(chunk.length - offset, this.#bytesUntilMeta);

      chunks.push(chunk.subarray(offset, offset + bytesToWrite));
      offset += bytesToWrite;
      this.#bytesUntilMeta -= bytesToWrite;

      if (this.#bytesUntilMeta === 0) {
        const metaLen = this.#writeMeta(this.#pendingMeta);
        chunks.push(this.#metaBuffer.subarray(0, metaLen));
        this.#bytesUntilMeta = this.#metaInt;
        this.#pendingMeta = null;
      }
    }

    callback(null, Buffer.concat(chunks));
  }
}

export { ICYWriter };
export default ICYWriter;
