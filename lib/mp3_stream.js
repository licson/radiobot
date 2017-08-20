module.exports = function (bridge) {
	bridge.allOnce(['config', 'mixer'], function (config, mixer) {
		const spawn = require('child_process').spawn;
		
		var ffmpeg = spawn(require('ffmpeg-static').path, [
			'-f', 's16le', // Input is signed 16-bit raw PCM
			'-ac', config.output.channels, // Input channels
			'-ar', config.output.samplerate, // Input sample rate
			'-i', '-', // Get from stdin
			'-c:a', 'libmp3lame', // Specify LAME MP3 encoder
			'-ac', config.output.channels, // Output channels
			'-ar', config.output.samplerate, // Output sample rate
			'-ab', config.mp3.bitrate + 'k',  // Bitrate
			'-af', config.mp3.normalize ? 'dynaudnorm=f=250:g=15' : 'anull', // Use Dynamic Range Normalization? (sounds like real radio),
			'-bufsize', config.mp3.bitrate * 2 + 'k', // 2 seconds of buffer
			'-f', 'mp3', // MP3 container, clean output
			'-' // Output to stdout
		]);
		
		mixer.pipe(ffmpeg.stdin);
		
		ffmpeg.stderr.resume();
		ffmpeg.stdout.resume();
		
		bridge.emitSticky('mp3_stream', ffmpeg.stdout);
	});
};