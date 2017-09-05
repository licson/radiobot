module.exports = function (bridge) {
	const listeners = {};
	
	function getTotalListeners() {
		var sum = 0;

		for (var origin in listeners) {
			if (listeners.hasOwnProperty(origin)) {
				sum += listeners[origin];
			}
		}

		return sum;
	}
	
	function printTotalCount() {
		console.log(`[Server] total listeners from all origin: ${getTotalListeners()}`);
	}
	
	function updateListenerCount(origin, count) {
		var prevCount = listeners[origin] || 0;
		var change = count - prevCount;
		listeners[origin] = count;
		
		bridge.emit('listeners', getTotalListeners());
		
		console.log(`[Server] ${Math.abs(change)} listener(s) from ${origin} ${change < 0 ? 'leaved' : 'joined'}`);
		printTotalCount();
	}
	
	bridge.emitSticky('analytics', {
		getTotalListeners,
		printTotalCount,
		updateListenerCount
	});
};