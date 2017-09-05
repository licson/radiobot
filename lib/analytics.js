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
		listeners[origin] = count;
		
		if (prevCount < count) {
			console.log(`[Server] ${count - prevCount} new listener${count - prevCount > 1 ? 's' : ''} joined via ${origin}, current count from ${origin}: ${count}`);
		} else if (prevCount > count) {
			console.log(`[Server] ${prevCount - count} listener${count - prevCount > 1 ? 's' : ''} from ${origin} leaved, current count from ${origin}: ${count}`);
		}
		
		bridge.emit('listeners', getTotalListeners());
		
		printTotalCount();
	}
	
	bridge.emitSticky('analytics', {
		getTotalListeners,
		printTotalCount,
		updateListenerCount
	});
};