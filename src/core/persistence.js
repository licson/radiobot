import { writeFile, readFile, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TEMP_DIR = tmpdir();

async function atomicWrite(filePath, data) {
  const tempPath = join(TEMP_DIR, `radiobot_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`);

  await writeFile(tempPath, data, 'utf-8');

  try {
    await rename(tempPath, filePath);
  } catch (err) {
    try {
      await writeFile(filePath, data, 'utf-8');
    } finally {
      try {
        await unlink(tempPath);
      } catch {}
    }
  }
}

async function rename(oldPath, newPath) {
  const fs = await import('fs/promises');
  return fs.rename(oldPath, newPath);
}

async function unlink(path) {
  const fs = await import('fs/promises');
  return fs.unlink(path);
}

async function saveQueue(queue, filePath = 'song_queue.json') {
  try {
    const data = JSON.stringify(queue.toJSON(), null, 2);
    await atomicWrite(filePath, data);
    return true;
  } catch (err) {
    console.error(`[Persistence] Failed to save queue: ${err.message}`);
    return false;
  }
}

async function loadQueue(queue, filePath = 'song_queue.json') {
  if (!existsSync(filePath)) {
    console.log('[Persistence] No saved queue found, starting fresh');
    return false;
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    queue.loadFromObject(data);
    console.log('[Persistence] Queue loaded from file');
    return true;
  } catch (err) {
    console.error(`[Persistence] Failed to load queue: ${err.message}`);
    return false;
  }
}

function createFileAppender(filePath) {
  return async function append(text) {
    try {
      await appendFile(filePath, text + '\n');
      return true;
    } catch (err) {
      console.error(`[Persistence] Failed to append to ${filePath}: ${err.message}`);
      return false;
    }
  };
}

export { saveQueue, loadQueue, createFileAppender };
export default { saveQueue, loadQueue, createFileAppender };
