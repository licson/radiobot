module.exports = function (bridge) {
	bridge.allOnce(['config', 'mixer'], 
	function (config, mixer) {
		const net = require('net');
		
		var server = net.createServer(function (socket) {
			console.log(`[Tcp] recieved PCM connection from ${socket.address().address}`);
			mixer.addSource(socket, ['tcp']);
		});
		
		server.listen(config.ports.helper, function () {
			console.log("[Tcp] Listening on %d waiting for push connections.", config.ports.helper);
		});
	});
};