export class ChatSource {
  static create(options) {
    if (!options.type) {
      throw new Error('ChatSource requires "type" property');
    }
    if (!options.generalName) {
      throw new Error('ChatSource requires "generalName" property');
    }
    return new ChatSource(options);
  }

  constructor(options) {
    this.type = options.type;
    this.generalName = options.generalName;
    this.original = options.original || null;

    if (options.type === 'telegram') {
      this.chatId = options.chatId || options.chat_id;
      this.messageId = options.messageId || options.message_id;
    }

    if (options.type === 'discord') {
      this.userId = options.userId || options.user_id;
      this.channelId = options.channelId || options.channel_id;
    }
  }

  toJSON() {
    const obj = {
      type: this.type,
      generalName: this.generalName,
    };

    if (this.original) {
      obj.original = this.original;
    }

    if (this.type === 'telegram') {
      obj.chatId = this.chatId;
      obj.messageId = this.messageId;
    }

    if (this.type === 'discord') {
      obj.userId = this.userId;
      obj.channelId = this.channelId;
    }

    return obj;
  }
}

export default ChatSource;
