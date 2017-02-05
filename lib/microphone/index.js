module.exports = function (bridge) {
bridge.allOnce(['get_router', 'mixer', 'config', 'socket.io'], function (getRouter, mixer, config, io) {
// --------------

console.log('[HTML5 MicroPhone] initing');

const stream = require("stream");
const path = require("path");
const router = getRouter();
const express = require("express");

var ioUsers = 0;
var microUsers = 0;

io.on('connection', function (socket) {
	var source = null;
	ioUsers++;
	
	console.log(`[Socket.io] A user connected, total ${ioUsers} users online, ${microUsers} microphones taken`);
	
	// init the microphone
	socket.emit('info', {
		sampleRate: mixer.sampleRate,
		channel: mixer.channel
	})
	
	socket.on('microphone_take', function () {
		if (source) return;
		
		microUsers++;
		
		console.log(`[Socket.io] A microphone taken, total ${ioUsers} users online, ${microUsers} microphones taken`);
		
		source = new stream.PassThrough();
		mixer.addSource(source, ['microphone']);
		socket.emit('microphone_ready');
	});
	
	socket.on('PCM', function (pcm_s16le, id) {
		if (!source) return;
		if (!pcm_s16le instanceof Buffer) return console.log(pcm_s16le);
	
		source.write(pcm_s16le);
		socket.emit('ACK', id);
	});
	
	socket.on('microphone_drop', function () {
		if (!source) return;
		
		microUsers--;
		
		console.log(`[Socket.io] A microphone dropped, total ${ioUsers} users online, ${microUsers} microphones taken`);
		
		source.end()
		source = null;
		socket.emit('microphone_dropped');
	});
	
	socket.on('disconnect', function () {
		ioUsers--;
		
		if (source) {
			microUsers--;
		}
		
		console.log(`[Socket.io] A user leaved, total ${ioUsers} users online, ${microUsers} microphones taken`);
		
		if (source) {
			source.end();
			socket = null;
		}
	});
});

router.use(express.static(path.resolve(__dirname, './public')));

// --------------
});
};