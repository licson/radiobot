function findOggPage(buffer, fromIndex = 0) {
  for (let i = fromIndex; i < buffer.length - 3; i++) {
    if (buffer[i] === 0x4f && buffer[i + 1] === 0x67 && buffer[i + 2] === 0x67 && buffer[i + 3] === 0x53) {
      return i;
    }
  }
  return -1;
}

function rewriteOpusPreSkip(buffer, preSkip, crc32Fn) {
  const CRC_OFFSET = 22;
  const PRE_SKIP_OFFSET = 38;
  const newBuffer = Buffer.alloc(buffer.length);
  buffer.copy(newBuffer);
  newBuffer.writeUInt32LE(0, CRC_OFFSET);
  newBuffer.writeUInt16LE(preSkip, PRE_SKIP_OFFSET);
  const newCrc = crc32Fn(newBuffer);
  newBuffer.writeUInt32LE(newCrc, CRC_OFFSET);
  return newBuffer;
}

export { findOggPage, rewriteOpusPreSkip };
export default { findOggPage, rewriteOpusPreSkip };
