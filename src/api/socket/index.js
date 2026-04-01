import { PassThrough } from 'stream';

export function createSocketHandler({ mixer, config }) {
  let ioUsers = 0;
  let microUsers = 0;

  return function handleConnection(socket) {
    let source = null;
    ioUsers++;

    console.log(`[Socket.io] User connected, total ${ioUsers} users, ${microUsers} microphones active`);

    socket.emit('info', {
      sampleRate: mixer.sampleRate,
      channel: mixer.channels
    });

    socket.on('microphone_take', () => {
      if (source) return;

      microUsers++;
      console.log(`[Socket.io] Microphone taken, total ${ioUsers} users, ${microUsers} microphones active`);

      source = new PassThrough();
      mixer.addSource(source, ['microphone']);
      socket.emit('microphone_ready');
    });

    socket.on('PCM', (pcmData, id) => {
      if (!source) return;
      if (!(pcmData instanceof Buffer)) {
        console.warn('[Socket.io] Received non-buffer PCM data');
        return;
      }

      source.write(pcmData);
      socket.emit('ACK', id);
    });

    socket.on('microphone_drop', () => {
      if (!source) return;

      microUsers--;
      console.log(`[Socket.io] Microphone dropped, total ${ioUsers} users, ${microUsers} microphones active`);

      source.end();
      source = null;
      socket.emit('microphone_dropped');
    });

    socket.on('disconnect', () => {
      ioUsers--;

      if (source) {
        microUsers--;
        source.end();
        source = null;
      }

      console.log(`[Socket.io] User disconnected, total ${ioUsers} users, ${microUsers} microphones active`);
    });
  };
}

export default createSocketHandler;
