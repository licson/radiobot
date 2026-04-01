import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatSource } from '../../src/utils/chat-source.js';

describe('ChatSource', () => {
  it('should create a Telegram chat source', () => {
    const source = ChatSource.create({
      type: 'telegram',
      generalName: 'John on Telegram',
      chatId: 123456,
      messageId: 789
    });

    expect(source.type).toBe('telegram');
    expect(source.generalName).toBe('John on Telegram');
    expect(source.chatId).toBe(123456);
    expect(source.messageId).toBe(789);
  });

  it('should create a Discord chat source', () => {
    const source = ChatSource.create({
      type: 'discord',
      generalName: 'Jane#1234 on Discord',
      userId: '987654321'
    });

    expect(source.type).toBe('discord');
    expect(source.generalName).toBe('Jane#1234 on Discord');
    expect(source.userId).toBe('987654321');
  });

  it('should throw if type is missing', () => {
    expect(() => {
      ChatSource.create({
        generalName: 'Test'
      });
    }).toThrow('ChatSource requires "type" property');
  });

  it('should throw if generalName is missing', () => {
    expect(() => {
      ChatSource.create({
        type: 'telegram'
      });
    }).toThrow('ChatSource requires "generalName" property');
  });

  it('should preserve original chat source', () => {
    const original = ChatSource.create({
      type: 'telegram',
      generalName: 'Original',
      chatId: 111,
      messageId: 222
    });

    const forwarded = ChatSource.create({
      type: 'discord',
      generalName: 'Forwarded',
      userId: '333',
      original
    });

    expect(forwarded.original).toBe(original);
    expect(forwarded.original.type).toBe('telegram');
  });

  it('should serialize to JSON correctly', () => {
    const source = ChatSource.create({
      type: 'telegram',
      generalName: 'Test User',
      chatId: 123,
      messageId: 456
    });

    const json = source.toJSON();

    expect(json.type).toBe('telegram');
    expect(json.generalName).toBe('Test User');
    expect(json.chatId).toBe(123);
    expect(json.messageId).toBe(456);
  });
});
