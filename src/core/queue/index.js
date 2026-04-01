import EventEmitter from 'events';

class TaskWrapper {
  constructor(taskFactory, info = {}, initTime = Date.now(), execCount = 0) {
    this.taskFactory = taskFactory;
    this.info = info;
    this.initTime = initTime;
    this.execCount = execCount;
  }

  async run(...args) {
    return this.taskFactory.apply(this, args);
  }
}

function once(fn) {
  let called = false;
  return (...args) => {
    if (called) {
      console.error(new Error('Callback called more than once'));
      return;
    }
    called = true;
    return fn(...args);
  };
}

class Queue extends EventEmitter {
  #maxSize;
  #items = [];
  #oldCount = 0;
  #overflow = [];
  #prepend = [];
  #running = false;
  #currentTask = null;
  #taskHandle = null;
  #taskToJSON;
  #JSONToTask;

  constructor(maxSize, options = {}) {
    super();
    this.#maxSize = maxSize;
    this.#taskToJSON = options.taskToJSON || ((_, info) => info);
    this.#JSONToTask = options.JSONToTask || (json => ({ task: async () => json, info: json }));
  }

  get length() {
    return this.#items.length - this.#oldCount + this.#overflow.length + this.#prepend.length;
  }

  get isRunning() {
    return this.#running;
  }

  get currentTask() {
    return this.#currentTask;
  }

  #updateQueue() {
    while (this.#overflow.length > 0 && (this.#oldCount > 0 || this.#maxSize > this.#items.length)) {
      this.push(this.#overflow.shift().taskFactory, this.#overflow[0]?.info);
    }
  }

  push(task, info = {}) {
    queueMicrotask(() => this.emit('push', task, info));

    const existing = this.findTask(info);
    for (const t of existing) {
      this.remove(t);
    }

    const item = new TaskWrapper(task, info);

    if (this.#maxSize > this.#items.length) {
      this.#items.splice(this.#items.length - this.#oldCount, 0, item);
      return true;
    }

    if (this.#oldCount > 0) {
      const oldest = this.#items.filter(i => i.execCount > 0).sort((a, b) => a.initTime - b.initTime)[0];

      if (oldest) {
        this.remove(oldest);
        this.#items.splice(this.#items.length - this.#oldCount, 0, item);
        return true;
      }
    }

    this.#overflow.push(item);
    return false;
  }

  unshift(task, info = {}) {
    const existing = this.findTask(info);
    for (const t of existing) {
      this.remove(t);
    }

    const item = new TaskWrapper(task, info);
    this.#prepend.unshift(item);

    queueMicrotask(() => this.emit('unshift', task, info));
  }

  shift() {
    if (this.#prepend.length > 0) {
      return this.#prepend.shift();
    }

    if (this.#items.length === 0) {
      return null;
    }

    if (this.#oldCount < this.#items.length) {
      this.#oldCount++;
    }

    const item = this.#items.shift();
    this.#items.push(item);
    this.#updateQueue();
    this.emit('repeat', item.taskFactory, item.info);
    return item;
  }

  remove(item, error) {
    if (!item) return;

    let removed = false;

    for (let i = this.#overflow.length - 1; i >= 0; i--) {
      if (item === this.#overflow[i]) {
        this.#overflow.splice(i, 1);
        this.emit('remove', item.taskFactory, item.info, error);
        removed = true;
      }
    }

    for (let i = this.#prepend.length - 1; i >= 0; i--) {
      if (item === this.#prepend[i]) {
        this.#prepend.splice(i, 1);
        this.emit('remove', item.taskFactory, item.info, error);
        removed = true;
      }
    }

    for (let i = this.#items.length - 1; i >= 0; i--) {
      const isOld = this.#items.length - this.#oldCount <= i;
      if (item === this.#items[i]) {
        if (isOld) this.#oldCount--;
        this.#items.splice(i, 1);
        this.emit('remove', item.taskFactory, item.info, error);
        removed = true;
      }
    }

    if (removed) {
      this.#updateQueue();
    }
  }

  findTask(info = {}) {
    if (!info.uid) {
      return [];
    }

    return [
      ...this.#overflow.filter(i => i.info.uid === info.uid),
      ...this.#items.filter(i => i.info.uid === info.uid),
      ...this.#prepend.filter(i => i.info.uid === info.uid)
    ];
  }

  async #next() {
    const task = this.shift();

    if (!task) {
      this.#running = false;
      return;
    }

    task.execCount++;
    this.#currentTask = task;
    this.emit('next', task.taskFactory, task.info);

    try {
      const callback = once((err, data) => {
        this.#taskHandle = null;
        this.#currentTask = null;

        if (err) {
          this.remove(task, err);
          this.emit('error', err, task.taskFactory, task.info);
        } else {
          this.emit('success', data, task.taskFactory, task.info);
        }

        this.#next();
      });

      this.#taskHandle = task.run(callback);
    } catch (err) {
      this.#taskHandle = null;
      this.#currentTask = null;
      this.remove(task, err);
      this.emit('error', err, task.taskFactory, task.info);
      this.#next();
    }
  }

  start() {
    if (this.#running || this.#items.length === 0) {
      return false;
    }
    this.#running = true;
    this.#next();
    return true;
  }

  stop() {
    this.#running = false;
  }

  signal(data) {
    if (typeof this.#taskHandle === 'function') {
      this.#taskHandle(data);
    }
  }

  toJSON() {
    const encodeTask = task => ({
      initTime: task.initTime,
      execCount: task.execCount,
      info: this.#taskToJSON(task.taskFactory, task.info)
    });

    return {
      old: this.#oldCount,
      items: this.#items.map(encodeTask),
      exceedItems: this.#overflow.map(encodeTask),
      prependList: this.#prepend.map(encodeTask)
    };
  }

  loadFromObject(obj) {
    const decodeTask = info => {
      const { task, info: taskInfo } = this.#JSONToTask(info.info);
      return new TaskWrapper(task, taskInfo, info.initTime, info.execCount);
    };

    this.#oldCount = obj.old;
    this.#items = obj.items.map(decodeTask);
    this.#overflow = obj.exceedItems.map(decodeTask);
    this.#prepend = obj.prependList.map(decodeTask);
  }

  getAllTasks() {
    return [...this.#prepend, ...this.#items, ...this.#overflow];
  }
}

function mergeTasks(task1, task2) {
  let handle;
  let stopped = false;

  return async function merged(cb) {
    const onceCb = once(cb);

    try {
      handle = await task1(async (err, data) => {
        if (err) {
          return onceCb(err);
        }

        if (stopped) {
          return onceCb(null, data);
        }

        handle = await task2(async (err2, data2) => {
          if (err2) {
            return onceCb(err2);
          }
          onceCb(null, [data, data2]);
        });
      });
    } catch (err) {
      onceCb(err);
    }

    return function wrapHandle(data) {
      if (data !== 'stop') {
        throw new Error('Not implemented');
      }

      stopped = true;

      if (typeof handle === 'function') {
        handle(data);
      }
    };
  };
}

export { Queue, TaskWrapper, mergeTasks };
export default Queue;
