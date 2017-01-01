const net = require('net');
const spawn = require('child_process').spawn;
const config = require('./config.json');

var ffmpeg = spawn('ffmpeg', [
	'-f', 's16le', // Input is signed 16-bit raw PCM
	'-ac', '2', // Input has two channels
	'-ar', '44100', // Input sample rate is 44.1kHz
	'-i', '-', // Get from stdin
	'-c:a', 'libmp3lame', // Specify LAME MP3 encoder
	'-ac', config.output.channels, // Output channels
	'-ar', config.output.samplerate, // Output sample rate
	'-ab', config.output.bitrate + 'k',  // Bitrate
	'-af', config.output.normalize ? 'dynaudnorm' : 'anull', // Use Dynamic Range Normalization? (sounds like real radio)
	'-f', 'mp3', // MP3 container, clean output
	'-' // Output to handler through TCP
]);

ffmpeg.stderr.pipe(process.stderr);
ffmpeg.stdout.on('data', function () {});

var EMPTY_CHUNK = Buffer.alloc(44100);

var emptyTimer = 0;

function writeEmpty() {
	emptyTimer = setInterval(function () {
		ffmpeg.stdin.write(EMPTY_CHUNK);
	}, 250);
};

writeEmpty();

function createTCPHelper() {
	var server = net.createServer(function (socket) {
		server.getConnections(function (e, count) {
			if (e || count > 1) {
				socket.end();
				socket.destroy();
				return;
			}

			clearInterval(emptyTimer);

			socket.pipe(ffmpeg.stdin, { end: false });

			/* socket.setTimeout(30000, function () {
				socket.end();
				socket.destroy();
			}); */

			socket.on('error', function (e) {
				console.error(e);
			});

			socket.on('close', function () {
				writeEmpty();
			});
		});
	});

	server.listen(config.ports.helper);
	return ffmpeg.stdout;
}

module.exports = createTCPHelper;