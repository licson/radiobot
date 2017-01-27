const net = require('net');
const spawn = require('child_process').spawn;
const config = require('../config.json');
const MixerStream = require('./mixer');

var ffmpeg = spawn('ffmpeg', [
	'-re', '-f', 's16le', // Input is signed 16-bit raw PCM
	'-ac', '2', // Input has two channels
	'-ar', '44100', // Input sample rate is 44.1kHz
	'-i', '-', // Get from stdin
	'-c:a', 'libmp3lame', // Specify LAME MP3 encoder
	'-ac', config.output.channels, // Output channels
	'-ar', config.output.samplerate, // Output sample rate
	'-ab', config.output.bitrate + 'k',  // Bitrate
	'-af', config.output.normalize ? 'dynaudnorm=f=250:g=15' : 'anull', // Use Dynamic Range Normalization? (sounds like real radio),
	'-bufsize', '640k', // 2 seconds of buffer
	'-f', 'mp3', // MP3 container, clean output
	'-' // Output to stdout
]);

ffmpeg.stderr.resume();
ffmpeg.stdout.resume();

var mixer = new MixerStream(16, 2, 44100);
mixer.pipe(ffmpeg.stdin);

function createTCPHelper() {
	var server = net.createServer(function (socket) {
		console.log(`[Tcp] recieved PCM connection from ${socket.address().address}`);

		var source = mixer.addSource(socket, ['tcp']);
	});
	
	server.listen(config.ports.helper, function () {
		console.log("[Tcp] Listening on %d waiting for push connections.", config.ports.helper);
	});
	
	return {
		mp3Stream: ffmpeg.stdout,
		mixer: mixer
	};
}

module.exports = createTCPHelper;