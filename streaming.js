const spawn = require('child_process').spawn;
const HTTPHelper = require('./http_helper');
const TCPHelper = require('./tcp_helper');
const config = require('./config.json');

module.exports = HTTPHelper(TCPHelper());