import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveQueue, loadQueue, createFileAppender } from '../../src/core/persistence.js';
import { Queue } from '../../src/core/queue/index.js';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'radiobot-tests-' + Date.now());

describe('Persistence', () => {
  beforeEach(async () => {
    try {
      await mkdir(TEST_DIR, { recursive: true });
    } catch {
      // Directory might already exist
    }
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  });

  describe('saveQueue', () => {
    it('should save queue to JSON file', async () => {
      const queue = new Queue(10);
      queue.push(async () => 'task1', { uid: '1', title: 'Song 1' });
      queue.push(async () => 'task2', { uid: '2', title: 'Song 2' });

      const filePath = join(TEST_DIR, 'queue.json');
      const result = await saveQueue(queue, filePath);

      expect(result).toBe(true);
      expect(existsSync(filePath)).toBe(true);
    });

    it('should create valid JSON', async () => {
      const queue = new Queue(10);
      queue.push(async () => 'task1', { uid: '1', title: 'Song 1' });

      const filePath = join(TEST_DIR, 'queue.json');
      await saveQueue(queue, filePath);

      const content = await import('fs/promises').then(fs => fs.readFile(filePath, 'utf-8'));
      const data = JSON.parse(content);

      expect(data).toHaveProperty('items');
      expect(data).toHaveProperty('exceedItems');
      expect(data).toHaveProperty('prependList');
    });

    it('should handle empty queue', async () => {
      const queue = new Queue(10);

      const filePath = join(TEST_DIR, 'empty-queue.json');
      const result = await saveQueue(queue, filePath);

      expect(result).toBe(true);
      expect(existsSync(filePath)).toBe(true);
    });

    it('should return false on error', async () => {
      const queue = new Queue(10);
      queue.toJSON = vi.fn().mockImplementation(() => {
        throw new Error('Test error');
      });

      const filePath = join(TEST_DIR, 'error.json');
      const result = await saveQueue(queue, filePath);

      expect(result).toBe(false);
    });
  });

  describe('loadQueue', () => {
    it('should return false if file does not exist', async () => {
      const queue = new Queue(10);
      const filePath = join(TEST_DIR, 'non-existent.json');

      const result = await loadQueue(queue, filePath);

      expect(result).toBe(false);
    });

    it('should load queue from JSON file', async () => {
      // First save a queue
      const saveFilePath = join(TEST_DIR, 'saved-queue.json');
      const savedQueue = new Queue(10, {
        JSONToTask: json => ({ task: async () => json, info: json })
      });
      savedQueue.push(async () => 'task1', { uid: '1', title: 'Song 1' });
      await saveQueue(savedQueue, saveFilePath);

      // Then load it
      const loadFilePath = join(TEST_DIR, 'saved-queue.json');
      const loadedQueue = new Queue(10, {
        JSONToTask: json => ({ task: async () => json, info: json })
      });
      const result = await loadQueue(loadedQueue, loadFilePath);

      expect(result).toBe(true);
    });

    it('should return false on invalid JSON', async () => {
      const fs = await import('fs/promises');
      const filePath = join(TEST_DIR, 'invalid.json');
      await fs.writeFile(filePath, 'not valid json');

      const queue = new Queue(10);
      const result = await loadQueue(queue, filePath);

      expect(result).toBe(false);
    });

    it('should return false on file read error', async () => {
      const filePath = join(TEST_DIR, 'readonly-dir', 'queue.json');
      await mkdir(join(TEST_DIR, 'readonly-dir'), { recursive: true });

      const queue = new Queue(10);
      const result = await loadQueue(queue, filePath);

      // Should fail gracefully
      expect(result).toBe(false);
    });
  });

  describe('createFileAppender', () => {
    it('should create appender function', () => {
      const filePath = join(TEST_DIR, 'appender.log');
      const appender = createFileAppender(filePath);

      expect(typeof appender).toBe('function');
    });

    it('should append text to file', async () => {
      const fs = await import('fs/promises');
      const filePath = join(TEST_DIR, 'appender.log');
      const appender = createFileAppender(filePath);

      await appender('Line 1');
      await appender('Line 2');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('Line 1');
      expect(content).toContain('Line 2');
    });

    it('should add newline after each append', async () => {
      const fs = await import('fs/promises');
      const filePath = join(TEST_DIR, 'newlines.log');
      const appender = createFileAppender(filePath);

      await appender('Test');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content.endsWith('\n')).toBe(true);
    });

    it('should create file if it does not exist', async () => {
      const filePath = join(TEST_DIR, 'new-file.log');
      const appender = createFileAppender(filePath);

      await appender('First line');

      expect(existsSync(filePath)).toBe(true);
    });

    it('should return false on write error', async () => {
      const filePath = join(TEST_DIR, 'non-existent-dir', 'appender.log');
      const appender = createFileAppender(filePath);

      const result = await appender('Test');

      expect(result).toBe(false);
    });

    it('should append multiple times to same file', async () => {
      const fs = await import('fs/promises');
      const filePath = join(TEST_DIR, 'multi-append.log');
      const appender = createFileAppender(filePath);

      await appender('Line 1');
      await appender('Line 2');
      await appender('Line 3');

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(3);
    });
  });

  describe('atomic write behavior', () => {
    it('should use atomic write for saveQueue', async () => {
      const queue = new Queue(10);
      queue.push(async () => 'task', { uid: '1', title: 'Test' });

      const filePath = join(TEST_DIR, 'atomic-test.json');
      await saveQueue(queue, filePath);

      // File should exist and be valid
      expect(existsSync(filePath)).toBe(true);

      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      expect(data.items).toHaveLength(1);
    });
  });
});
