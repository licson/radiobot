module.exports = function (bridge) {
	bridge.allOnce(['config', 'mixer'], function (config, mixer) {
		const net = require('net');
		
		var server = net.createServer(function (socket) {
			console.log(`[Consumer] Accepting connection from ${socket.address().address}`);
			mixer.addSource(socket, ['tcp']);
		});
		
		server.listen(config.ports.helper, function () {
			console.log('[Consumer] Listening on %d waiting for push connections.', config.ports.helper);
		});
	});
};