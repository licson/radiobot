// based on http://ietf.org/rfc/rfc3533.txt
function indexOfHeader(buffer, from) {
    from = from || 0;
    
    const char_O = 0x4f;
    const char_g = 0x67;
    const char_S = 0x53;
    
    // console.log(buffer.toString('utf8'))
    
    for (let i = from; i < buffer.length - 3; i++) {
        
        if (buffer[i] !== char_O) continue;
        if (buffer[i + 1] !== char_g) continue;
        if (buffer[i + 2] !== char_g) continue;
        if (buffer[i + 3] !== char_S) continue;
        return i;
    }
    
    return -1;
}

exports.indexOfHeader = indexOfHeader;