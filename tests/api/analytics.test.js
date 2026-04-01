import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Analytics } from '../../src/api/analytics.js';

describe('Analytics', () => {
  let analytics;

  beforeEach(() => {
    analytics = new Analytics();
  });

  it('should start with zero listeners', () => {
    assert.strictEqual(analytics.getTotalListeners(), 0);
  });

  it('should track listeners by origin', () => {
    analytics.updateListenerCount('mp3', 5);
    assert.strictEqual(analytics.getTotalListeners(), 5);

    analytics.updateListenerCount('hls', 3);
    assert.strictEqual(analytics.getTotalListeners(), 8);
  });

  it('should update listener count', () => {
    analytics.updateListenerCount('mp3', 10);
    analytics.updateListenerCount('mp3', 5);
    assert.strictEqual(analytics.getTotalListeners(), 5);
  });

  it('should handle listener leaving', () => {
    analytics.updateListenerCount('mp3', 10);
    analytics.updateListenerCount('mp3', 9);
    assert.strictEqual(analytics.getTotalListeners(), 9);
  });

  it('should return listener stats', () => {
    analytics.updateListenerCount('mp3', 5);
    analytics.updateListenerCount('hls', 3);

    const stats = analytics.getListenerStats();
    assert.deepStrictEqual(stats, { mp3: 5, hls: 3 });
  });

  it('should call onUpdate callback', () => {
    let calledWith = null;
    analytics.onUpdate(total => {
      calledWith = total;
    });

    analytics.updateListenerCount('mp3', 5);
    assert.strictEqual(calledWith, 5);
  });
});
