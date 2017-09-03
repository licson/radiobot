const crc32 = require('./crc32');

// based on http://ietf.org/rfc/rfc3533.txt
function indexOfHeader(buffer, from) {
    from = from || 0;
    
    for (var i = from; i < buffer.length - 3; i++) {
        if (buffer[i] !== 0x4f) continue; // O
        if (buffer[i + 1] !== 0x67) continue; // g
        if (buffer[i + 2] !== 0x67) continue; // g
        if (buffer[i + 3] !== 0x53) continue; // S
        return i;
    }
    
    return -1;
}

// based http://ietf.org/rfc/rfc3533.txt
// based on https://tools.ietf.org/html/draft-ietf-codec-oggopus-14#section-5
function rewriteOpusPreSkip(buffer, newPreSkip) {
    const CRCPosition = 22;
    const preSkipPosition = 38;
    const newBuffer = Buffer.alloc(buffer.length);
    
    newBuffer.fill(buffer);
    newBuffer.writeUInt32LE(0, CRCPosition);
    newBuffer.writeInt16LE(newPreSkip || 3840, preSkipPosition);
    
    const newCRC = crc32(newBuffer);
    
    console.log(newCRC);
    
    newBuffer.writeInt32LE(newCRC, CRCPosition);
    
    return newBuffer; 
}

exports.indexOfHeader = indexOfHeader;
exports.rewriteOpusPreSkip = rewriteOpusPreSkip;