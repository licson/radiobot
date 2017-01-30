var url = require("url");

module.exports = function fixPathname(input) {
	
	var parsed = url.parse(input);
	
	parsed.pathname = parsed.pathname.match(/\/|%[0-9a-fA-F]{2,2}|./g).map(function (i) {
		if (i === '/') return i;
		if (i[0] === '%') return i;
		return encodeURIComponent(i);
	}).join('');
	
	return url.format(parsed);
};