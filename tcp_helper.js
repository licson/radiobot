var net = require('net');
var spawn = require('child_process').spawn;
var ffmpeg = spawn('ffmpeg', ['-re', '-f', 's32le','-c:a', 'pcm_s32le', '-ac', '2', '-ar', '48000', '-i', '-', '-af', 'dynaudnorm', '-f', 'ffm', 'http://radio.licson.net:8080/input/audio']);

ffmpeg.stdout.resume();
ffmpeg.stderr.resume();
// ffmpeg.stderr.pipe(process.stderr);

var EMPTY_CHUNK = Buffer.alloc(48000);

var emptyTimer = 0;

function writeEmpty () {
	emptyTimer = setInterval(function () {
		ffmpeg.stdin.write(EMPTY_CHUNK);
	}, 150);
};


var server = net.createServer(function (socket) {
	server.getConnections(function (e, count) {
		if(e || count > 1) {
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
			cconsole.error(e);
		});

		socket.on('close', function () {
			writeEmpty();
		});
	});
});

writeEmpty();
server.listen(5000);
