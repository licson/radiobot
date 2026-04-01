import { describe, it, expect, beforeEach } from 'vitest';
import { Analytics } from '../../src/api/analytics.js';

describe('Analytics', () => {
  let analytics;

  beforeEach(() => {
    analytics = new Analytics();
  });

  it('should start with zero listeners', () => {
    expect(analytics.getTotalListeners()).toBe(0);
  });

  it('should track listeners by origin', () => {
    analytics.updateListenerCount('mp3', 5);
    expect(analytics.getTotalListeners()).toBe(5);

    analytics.updateListenerCount('hls', 3);
    expect(analytics.getTotalListeners()).toBe(8);
  });

  it('should update listener count', () => {
    analytics.updateListenerCount('mp3', 10);
    analytics.updateListenerCount('mp3', 5);
    expect(analytics.getTotalListeners()).toBe(5);
  });

  it('should handle listener leaving', () => {
    analytics.updateListenerCount('mp3', 10);
    analytics.updateListenerCount('mp3', 9);
    expect(analytics.getTotalListeners()).toBe(9);
  });

  it('should return listener stats', () => {
    analytics.updateListenerCount('mp3', 5);
    analytics.updateListenerCount('hls', 3);

    const stats = analytics.getListenerStats();
    expect(stats).toEqual({ mp3: 5, hls: 3 });
  });

  it('should call onUpdate callback', () => {
    let calledWith = null;
    analytics.onUpdate(total => {
      calledWith = total;
    });

    analytics.updateListenerCount('mp3', 5);
    expect(calledWith).toBe(5);
  });

  it('should not allow negative listener counts', () => {
    analytics.updateListenerCount('mp3', 5);
    analytics.updateListenerCount('mp3', -10);
    expect(analytics.getTotalListeners()).toBe(0);
  });

  it('should track multiple origins independently', () => {
    analytics.updateListenerCount('mp3', 10);
    analytics.updateListenerCount('opus', 5);
    analytics.updateListenerCount('hls', 3);

    expect(analytics.getTotalListeners()).toBe(18);
    expect(analytics.getListenerStats()).toEqual({
      mp3: 10,
      opus: 5,
      hls: 3
    });
  });
});
