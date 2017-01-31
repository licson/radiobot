// const HTTPHelper = require('./http_helper');
const HTTPHelper = require('../http_server');
const TCPHelper = require('./tcp_helper');

var helpers = TCPHelper();

helpers.metadataInjector = HTTPHelper(helpers);

module.exports = helpers;