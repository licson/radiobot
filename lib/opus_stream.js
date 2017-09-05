module.exports = function (bridge) {
	bridge.allOnce(['config', 'mixer'], function (config, mixer) {
		const spawn = require('child_process').spawn;
		
		if (!config.discord.enabled) {
			return;
		}
		
		var ffmpeg = spawn('ffmpeg', [
			'-v', '8',
			'-f', 's16le', // Input is signed 16-bit raw PCM
			'-ac', config.output.channels, // Input channels
			'-ar', config.output.samplerate, // Input sample rate
			'-i', '-', // Get from stdin
			'-vn',
			'-map', '0:a',
			'-acodec', 'libopus',
			'-f', 'data', // No container, clean output
			'-sample_fmt', 's16',
			'-vbr', 'off', // Disable variable bitrate
			'-ar', config.output.samplerate, // Output sample rate
			'-ac', config.output.channels, // Output channels
			'-ab', config.discord.bitrate + 'k',  // Bitrate
			// '-af', config.opus.normalize ? 'dynaudnorm=f=250:g=15' : 'anull', // Use Dynamic Range Normalization? (sounds like real radio),
			// '-bufsize', config.opus.bitrate * 2 + 'k', // 2 seconds of buffer
			'pipe:1' // Output to stdout
		]);
		
		mixer.pipe(ffmpeg.stdin);
		
		ffmpeg.stdout.resume();
		ffmpeg.stderr.pipe(process.stderr);
		
		bridge.emitSticky('opus_stream', ffmpeg.stdout);
	});
};