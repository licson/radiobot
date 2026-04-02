# Licson's Radio Bot v2.0

[![CI](https://github.com/licson/radiobot/actions/workflows/ci.yml/badge.svg)](https://github.com/licson/radiobot/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Your hobbyist internet radio station solution. Accept songs via Telegram/Discord, mix audio in real-time, and broadcast in multiple formats (MP3, Opus, HLS, SHOUTcast).

---

## Quick Start

### Prerequisites

- **Node.js** >= 22.12.0 (LTS recommended)
- **FFmpeg** (with libmp3lame and libopus support)
- **yt-dlp** (optional, for YouTube/SoundCloud support)
- **Telegram Bot Token** (optional, for Telegram integration)
- **Discord Bot Token** (optional, for Discord integration)

### Installation

```bash
# Clone the repository
git clone https://github.com/licson/radiobot.git
cd radiobot

# Install dependencies
npm install

# Copy example config and edit
cp config.example.json config.json
nano config.json  # or use your favorite editor

# Start the bot
npm start
```

### Docker Installation

```bash
docker pull licson/radiobot:latest
docker run -v $(pwd)/config.json:/app/config.json licson/radiobot:latest
```

---

## Features

### Multi-Platform Support
- **Telegram Bot** - Accept songs via messages, inline commands
- **Discord Bot** - Slash commands, voice channel streaming

### Audio Sources
- **YouTube** - Direct video/audio playback
- **SoundCloud** - Track streaming via yt-dlp
- **HTTP URLs** - Direct audio file links
- **Telegram Files** - Audio messages and documents

### Streaming Formats
- **MP3** - Standard MPEG audio stream
- **Opus** - High-quality Ogg Opus stream
- **HLS** - HTTP Live Streaming with segments
- **SHOUTcast** - ICY protocol with metadata
- **Raw PCM** - Uncompressed audio for custom processing

### Audio Pipeline
- Real-time audio mixing with multiple sources
- Volume control per source type (song, TCP, microphone)
- Optional **C++ native addon** for optimized mixing
- Automatic audio format conversion

### Web Interface
- **HTML5 Player** - Modern web player with playlist
- **Microphone Broadcast** - Live voice streaming via browser
- **REST API** - Full programmatic control
- **WebSocket** - Real-time updates

---

## Configuration

Copy `config.example.json` to `config.json` and customize:

```json
{
  "station": {
    "name": "My Radio Station",
    "description": "Playing the best tunes!",
    "url": "https://myradio.example.com",
    "public": true
  },
  "http": {
    "port": 8080,
    "host": "localhost",
    "allowCrossOrigin": false,
    "originWhitelist": []
  },
  "mixer": {
    "sampleRate": 44100,
    "bitDepth": 16,
    "channels": 2,
    "useNative": true
  },
  "mp3": {
    "bitrate": 192,
    "normalize": true
  },
  "opus": {
    "bitrate": 256
  },
  "telegram": {
    "enabled": true,
    "token": "YOUR_BOT_TOKEN",
    "admins": ["your_username"]
  },
  "discord": {
    "enabled": true,
    "token": "YOUR_BOT_TOKEN",
    "admins": ["DISCORD_USER_ID"]
  }
}
```

### Configuration Reference

#### Station Settings
| Key | Type | Description |
|-----|------|-------------|
| `station.name` | string | Station name for metadata |
| `station.description` | string | Station description |
| `station.url` | string | Public URL of your station |
| `station.public` | boolean | Whether to advertise on public directories |

#### Mixer Settings
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mixer.sampleRate` | number | 44100 | Audio sample rate (22050, 44100, 48000) |
| `mixer.bitDepth` | number | 16 | Bit depth (8, 16, 24, 32) |
| `mixer.channels` | number | 2 | Channels (1=mono, 2=stereo) |
| `mixer.useNative` | boolean | true | Use C++ native mixer if available |

**Note:** Discord voice requires `48000` sample rate and `2` channels.

#### Platform Settings

**Telegram:**
- `token` - Bot token from @BotFather
- `admins` - Array of usernames with admin privileges
- `apiServer` - Custom Bot API server (optional)

**Discord:**
- `token` - Bot token from Discord Developer Portal
- `admins` - Array of Discord user IDs with admin privileges
- `voiceChannel` - Default voice channel ID (optional)

---

## API Endpoints

### Station Information

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /` | - | Redirects to station URL or player |
| `GET /info` | GET | Station metadata (JSON) |
| `GET /status` | GET | Server status (plain text) |
| `GET /queue` | GET | Current queue state |
| `POST /queue/skip` | POST | Skip current song |
| `DELETE /queue/:index` | DELETE | Remove song from queue |

### Streaming Endpoints

| Endpoint | Format | Description |
|----------|--------|-------------|
| `/live.mp3` | MP3 | Standard MP3 stream |
| `/live.ogg` | Ogg Opus | Opus encoded stream |
| `/stream` | MP3 + ICY | SHOUTcast compatible |
| `/stream.ogg` | Opus + ICY | SHOUTcast with Opus |
| `/live.m3u8` | HLS | HTTP Live Streaming playlist |
| `/seg_:num.mp3` | MP3 | HLS segment files |
| `/live.raw` | PCM | Raw uncompressed audio |

### Metadata Endpoints

| Endpoint | Description |
|----------|-------------|
| `/title/poll` | Long-polling metadata updates |
| `/title/sse` | Server-sent events for metadata |

### WebSocket

Connect to `/` for real-time updates:
- `metadata` - Current song title
- `queue` - Queue changes
- `listeners` - Listener count updates

---

## Bot Commands

### Telegram Commands

| Command | Description | Admin Only |
|---------|-------------|------------|
| `/start` | Welcome message | No |
| `/queue` | Show queue length | No |
| `/list` | Show recent songs | No |
| `/play_list` | Show current playlist | No |
| `/skip` | Skip current song | Yes |
| `/volume <type> <value>` | Set volume (0-1) | Yes |
| `/tts <text>` | Text-to-speech | Yes |

**Inline Commands:**
- Send any URL - Queue from YouTube/SoundCloud/HTTP
- Send audio file - Queue uploaded audio

### Discord Commands

| Command | Description | Admin Only |
|---------|-------------|------------|
| `/play <url>` | Play song from URL | No |
| `/queue` | Show current queue | No |
| `/skip` | Skip current song | Yes |
| `/volume <type> <value>` | Set volume | Yes |

---

## Development

### Setup

```bash
# Clone repository
git clone https://github.com/licson/radiobot.git
cd radiobot

# Install dependencies
npm install

# Build native addon (optional, requires node-gyp)
npm run prebuild
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Linting & Formatting

```bash
# Check code style
npm run lint

# Fix code style
npm run lint:fix

# Check formatting
npm run format:check

# Fix formatting
npm run format
```

### Project Structure

```
radiobot/
├── src/
│   ├── api/           # HTTP API and web interface
│   ├── core/          # Audio pipeline (mixer, queue, encoders)
│   ├── platforms/     # Telegram and Discord integrations
│   ├── sources/       # URL handlers (YouTube, SoundCloud, etc.)
│   ├── utils/         # Utilities
│   ├── config.js      # Configuration loader
│   └── index.js       # Main entry point
├── native/            # C++ native addon
├── tests/             # Test suite
└── config.example.json
```

---

## Native Addon

The native addon provides optimized audio mixing using C++. It's optional - the bot will fall back to JavaScript implementation if not available.

### Building

```bash
# Build for current platform
npm run prebuild

# Prebuilds will be created in prebuilds/ directory
```

### Installing Prebuilds

Prebuilt binaries are automatically downloaded when installing the package. If not available for your platform, the build will fall back to compiling from source (requires Python and C++ compiler).

### Platforms

Prebuilds are available for:
- Linux (x64, arm64)
- macOS (x64, arm64)
- Windows (x64)

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `production` or `development` |
| `CONFIG_PATH` | Path to config file (default: `config.json`) |
| `PORT` | Override HTTP port |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) |

---

## Troubleshooting

### FFmpeg Not Found

Ensure FFmpeg is installed and in your PATH:

```bash
# Ubuntu/Debian
sudo apt-get install ffmpeg

# macOS
brew install ffmpeg

# Windows
choco install ffmpeg
```

### Native Addon Build Failures

The bot works without the native addon. To disable native loading:

```json
{
  "mixer": {
    "useNative": false
  }
}
```

To build the native addon, ensure you have:
- Python 3.x
- C++ compiler (GCC, Clang, or MSVC)
- Node.js headers (`npm install -g node-gyp`)

### Discord Voice Not Working

Discord requires 48000Hz sample rate and stereo:

```json
{
  "mixer": {
    "sampleRate": 48000,
    "channels": 2
  }
}
```

### Queue Not Persisting

Ensure the bot has write permissions in its working directory for `song_queue.json`.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure:
- Tests pass (`npm test`)
- Code is linted (`npm run lint`)
- Changes are documented

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Credits

- **Licson** - Original author and maintainer
- **Contributors** - See [CONTRIBUTORS.md](CONTRIBUTORS.md)

## Support

- GitHub Issues: [github.com/licson/radiobot/issues](https://github.com/licson/radiobot/issues)
- Email: admin@licson.net

---

**Enjoy your radio station! 🎵📻**
