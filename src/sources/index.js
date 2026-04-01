import { SourceInterface } from './interface.js';
import { YouTubeSource } from './youtube/index.js';
import { SoundCloudSource } from './soundcloud/index.js';
import { HTTPSource } from './http/index.js';
import { TelegramSource } from './telegram/index.js';
import { SourceManager, BUILTIN_SOURCES, DEFAULT_ORDER } from './manager.js';

export {
  SourceInterface,
  YouTubeSource,
  SoundCloudSource,
  HTTPSource,
  TelegramSource,
  SourceManager,
  BUILTIN_SOURCES,
  DEFAULT_ORDER
};

export default SourceManager;
