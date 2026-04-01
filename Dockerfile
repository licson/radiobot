# Use a minimal Alpine Linux image with Node.js 22 LTS
FROM node:22-alpine

# Jobs used in make command
ARG JOBS=4

# FFmpeg version
ENV FFMPEG_VERSION=7.1

# Set working directory
WORKDIR /app

# Layer 1: Install runtime dependencies (rarely changes)
# These libraries are needed at runtime for FFmpeg and native Node modules
RUN apk add --no-cache libsodium-dev zlib-dev openssl-dev lame-dev \
    libogg-dev x264-dev libvpx-dev libvorbis-dev x265-dev freetype-dev \
    libass-dev libwebp-dev rtmpdump-dev libtheora-dev opus-dev

# Layer 2: Build and install FFmpeg (changes when FFMPEG_VERSION updates)
# Uses virtual package to cleanly remove build dependencies after installation
RUN apk add --no-cache --virtual .ffmpeg-build build-base curl nasm tar bzip2 && \
    DIR=$(mktemp -d) && cd ${DIR} && \
    curl -s http://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.gz | tar zxvf - -C . && \
    cd ffmpeg-${FFMPEG_VERSION} && \
    ./configure \
    --enable-version3 --enable-gpl --enable-nonfree --enable-small --enable-libmp3lame \
    --enable-libx264 --enable-libx265 --enable-libvpx --enable-libtheora --enable-libvorbis \
    --enable-libopus --enable-libass --enable-libwebp --enable-librtmp --enable-postproc \
    --enable-swresample --enable-libfreetype --enable-openssl --disable-debug && \
    make -j $JOBS && \
    make install && \
    make distclean && \
    rm -rf ${DIR} && \
    apk del .ffmpeg-build

# Layer 3: Install Node dependencies (changes when package.json updates)
# Copy package files first for better caching
COPY package*.json ./
RUN apk add --no-cache --virtual .node-build build-base python3 && \
    npm ci --omit=dev && \
    npm cache clean && \
    apk del .node-build

# Layer 4: Copy application code and build native modules (changes frequently)
COPY . .
RUN npm run install

# Expose ports
EXPOSE 8080
EXPOSE 5000

# Specify entrypoint
CMD ["node", "src/index.js"]
