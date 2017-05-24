module.exports = function (bridge) {
    bridge.allOnce(['config', 'mixer', 'get_router'], function (config, mixer, getRouter) {
        var router = getRouter();
        var Passthrogh = require('stream').PassThrough;
        var proxy = new Passthrogh();
        mixer.pipe(proxy);

        router.get('/live.raw', function (req, res) {
            res.header('Content-Type', 'application/octet-stream');
            res.header('X-Radio-SampleSize', 16);
            res.header('X-Radio-SampleRate', config.output.samplerate);
            res.header('X-Radio-Channels', config.output.channels);
            proxy.pipe(res, { end: false });
        });
    });
};