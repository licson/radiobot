# Use a minimal Alpine Linux image
FROM mhart/alpine-node:6

# Install a fresh ffmpeg ourselves as the one on Alpine Linux repo is old
# Taken from https://github.com/opencoconut/ffmpeg/ for minimal Alpine build
WORKDIR /tmp/ffmpeg
ENV FFMPEG_VERSION=3.3.3
RUN apk add --update build-base python make gcc g++ curl nasm tar bzip2 \
	zlib-dev openssl-dev yasm-dev lame-dev libogg-dev x264-dev libvpx-dev libvorbis-dev x265-dev freetype-dev libass-dev libwebp-dev rtmpdump-dev libtheora-dev opus-dev && \

	DIR=$(mktemp -d) && cd ${DIR} && \

	curl -s http://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.gz | tar zxvf - -C . && \
	cd ffmpeg-${FFMPEG_VERSION} && \
	./configure \
	--enable-version3 --enable-gpl --enable-nonfree --enable-small --enable-libmp3lame --enable-libx264 --enable-libx265 --enable-libvpx --enable-libtheora --enable-libvorbis --enable-libopus --enable-libass --enable-libwebp --enable-librtmp --enable-postproc --enable-avresample --enable-libfreetype --enable-openssl --disable-debug && \
	make -j 4 && \
	make install && \
	make distclean && \

	rm -rf ${DIR} && \
	apk del build-base curl tar bzip2 x264 openssl nasm && rm -rf /var/cache/apk/*

# Starts our installs
WORKDIR /app
COPY . .

# Sometimes npm fails to run the install hook, to
# enable the use of optimized native code, we need
# running this manually
RUN npm install --production --force && npm cache clean --force && npm run install

# Expose ports
EXPOSE 8080
EXPOSE 5000

# Specify endpoint
CMD ["node", "index.js"]
