function ChatSource(obj) {
	var requires = [
		'type',
		'generalName'
	];
	
	for (var i = 0; i < requires.length; i++) {
		if (!obj.hasOwnProperty(requires[i])) {
			throw new Error('missing property: ' + requires[i]);
		}
	}
	
	return obj;
}

module.exports = ChatSource;