var bridge = new (require('../utils/sticky_event_emitter'))({ debug: false });

require('./core')(bridge);
require('./tcp_server')(bridge);
require('./mp3_stream')(bridge);
require('./opus_stream')(bridge);
require('./methods/shoutcast')(bridge);
require('./methods/ogg')(bridge);
require('./methods/pcm')(bridge);
require('./methods/hls')(bridge);
require('./http_server')(bridge);
require('./html5_player')(bridge);
require('./microphone')(bridge);
require('./telegram')(bridge);
require('./discord')(bridge);
require('./timed_broadcast')(bridge);

bridge.emitSticky('all_load');

module.exports = bridge;