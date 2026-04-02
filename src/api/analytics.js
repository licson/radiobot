class Analytics {
  #listeners = new Map();
  #onUpdate = null;

  getTotalListeners() {
    let sum = 0;
    for (const count of this.#listeners.values()) {
      sum += count;
    }
    return sum;
  }

  updateListenerCount(origin, count) {
    const prevCount = this.#listeners.get(origin) || 0;
    const change = count - prevCount;
    this.#listeners.set(origin, count);

    if (this.#onUpdate) {
      this.#onUpdate(this.getTotalListeners());
    }

    console.log(`[Analytics] ${Math.abs(change)} listener(s) from ${origin} ${change < 0 ? "left" : "joined"}`);
    console.log(`[Analytics] Total listeners: ${this.getTotalListeners()}`);
  }

  onUpdate(callback) {
    this.#onUpdate = callback;
  }

  getListenerStats() {
    return Object.fromEntries(this.#listeners);
  }
}

export { Analytics };
export default Analytics;
