const fs = require('fs');

var files = fs.readdirSync(__dirname).filter(function (name) {
	return name.match(/\.js$/) && name !== 'index.js';
});

module.exports = function (requiredList) {
	var modules = [];
	
	for (var i = 0; i < requiredList.length; i++) {
		if (files.indexOf(requiredList[i] + '.js') < 0) {
			throw new Error('handle module ' + requiredList[i] + ' does not exist.');
		}
		
		modules.push(require('./' + requiredList[i] + '.js'));
	}
	
	modules.push(require('./_default.js'));
	
	modules.find = function find(url) {
		var handle = modules.filter(function (handle) {
			return handle.shouldHandle(url);
		})[0];
		
		return {
			getInfo: handle.getInfo.bind(handle, url),
			getStreamURL: handle.getStreamURL.bind(handle, url)
		};
	};
	
	return modules;
};