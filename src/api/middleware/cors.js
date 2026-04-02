export function createCorsMiddleware(config = {}) {
  const { allowCrossOrigin = false, originWhitelist = [] } = config;

  return function corsMiddleware(req, res, next) {
    if (!allowCrossOrigin) {
      return next();
    }

    if (originWhitelist.length === 0) {
      res.header("Access-Control-Allow-Origin", "*");
    } else {
      const origin = req.get("Origin");
      if (origin && originWhitelist.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
      }
    }

    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  };
}

export default createCorsMiddleware;
