import { Router } from "express";
import { asyncHandler } from "../middleware/async.js";

export function createQueueRoutes({ queue, config }) {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json({
        current: queue.currentTask ? queue.currentTask.info : null,
        nexts: queue.getAllTasks().map(task => task.info),
        length: queue.length,
        isRunning: queue.isRunning
      });
    })
  );

  router.post(
    "/skip",
    asyncHandler(async (req, res) => {
      if (queue.currentTask) {
        queue.signal("stop");
        res.json({ success: true, message: "Current song skipped" });
      } else {
        res.status(400).json({ success: false, message: "No song playing" });
      }
    })
  );

  router.delete(
    "/:index",
    asyncHandler(async (req, res) => {
      const index = parseInt(req.params.index, 10);
      const tasks = queue.getAllTasks();

      if (index >= 0 && index < tasks.length) {
        queue.remove(tasks[index]);
        res.json({ success: true, message: "Song removed from queue" });
      } else {
        res.status(404).json({ success: false, message: "Song not found in queue" });
      }
    })
  );

  return router;
}

export default createQueueRoutes;
