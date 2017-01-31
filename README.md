Licson's Radio Bot
===================

Your hobbyist radio station solution.

You and your listeners can submit songs through the bot and play it like a real DJ do and it can do even more.
Broadcast your voice with ease through its web broadcasting interface. Run an internet radio has never been this
easy before.

Project Status
===================

The project is in an alpha state, which means it may not be stable and updates may break things.
If you want, you can try out and help contribute to the code base.

Setup
===================

- Install [ffmpeg](https://ffmpeg.org/) and make sure the `ffmpeg` command works
- Follow the Instruction on [repository of node-gyp](https://github.com/nodejs/node-gyp) to properly setup `node-gyp`
- `npm install`
- Change contents in `config.example.json` and rename it `config.json`
- `node index.js`

Commands
===================

- `[Any URL]` - play the song from internet (with youtube and soundcloud support)
- `[Audio Message]` - play the song from a file
- `[Document Message]` - play the song from a file
- `list` - show the songs recently ordered
- `play_list` - show current play list
- `skip` - skip the song and remove it from play list (admin only)
- `next` - skip the song but do not remove it fron play list (admin only)
- `volume song|tcp|microphone {newVolume}` - change the volume(between 0 and 1) (admin only)
- `tts` - play a text (admin only)

HTTP Endpoints
===================

- `/` - redirect to `station.url` in the `config.json`
- `/live.mp3` - the music stream
- `/stream` - alias of `live.mp3`
- `/;` - alias of `live.mp3`
- `/player` - the HTML5 music player
- `/player/embed.html` - the embeded HTML5 player
- `/player/customizer.html` - the embeded player customizer
- `/microphone` - the microphone
- `/status` - the process status
- `/info` - the station info
- `/title/poll` - the new subtitle of the station (using long polling)
- `/title/sse` - the new subtitle of the station (using Server Send Event)
