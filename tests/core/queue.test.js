import { describe, it, expect, beforeEach } from 'vitest';
import { Queue } from '../../src/core/queue/index.js';

describe('Queue', () => {
  let queue;

  beforeEach(() => {
    queue = new Queue(5);
  });

  it('should create queue with max size', () => {
    expect(queue.length).toBe(0);
  });

  it('should push task to queue', () => {
    const task = async () => 'result';
    queue.push(task, { uid: '1' });
    expect(queue.length).toBe(1);
  });

  it('should unshift task to front of queue', () => {
    const task1 = async () => 'result1';
    const task2 = async () => 'result2';
    queue.push(task1, { uid: '1' });
    queue.unshift(task2, { uid: '2' });
    expect(queue.length).toBe(2);
  });

  it('should find task by uid', () => {
    const task = async () => 'result';
    queue.push(task, { uid: 'test-uid' });
    const found = queue.findTask({ uid: 'test-uid' });
    expect(found.length).toBe(1);
  });

  it('should return empty array for non-existent uid', () => {
    const found = queue.findTask({ uid: 'non-existent' });
    expect(found).toEqual([]);
  });

  it('should remove task', () => {
    const task = async () => 'result';
    queue.push(task, { uid: '1' });
    const found = queue.findTask({ uid: '1' });
    queue.remove(found[0]);
    expect(queue.length).toBe(0);
  });

  it('should get all tasks', () => {
    queue.push(async () => '1', { uid: '1' });
    queue.push(async () => '2', { uid: '2' });
    expect(queue.getAllTasks().length).toBe(2);
  });

  it('should export to JSON', () => {
    queue.push(async () => 'result', { uid: '1' });
    const json = queue.toJSON();
    expect(json).toHaveProperty('items');
    expect(json).toHaveProperty('exceedItems');
    expect(json).toHaveProperty('prependList');
  });

  it('should not start when empty', () => {
    expect(queue.start()).toBe(false);
  });
});
