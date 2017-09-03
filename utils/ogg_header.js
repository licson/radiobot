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

exports.indexOfHeader = indexOfHeader;