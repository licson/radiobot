import { appendFile } from "fs/promises";

export function createLogger(prefix = "") {
  const formatMessage = (level, ...args) => {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
      typeof arg === "object" ? JSON.stringify(arg) : String(arg)
    ).join(" ");
    return prefix ? `[${prefix}] [${level}] ${message}` : `[${level}] ${message}`;
  };

  return {
    log: (...args) => console.log(formatMessage("INFO", ...args)),
    info: (...args) => console.info(formatMessage("INFO", ...args)),
    warn: (...args) => console.warn(formatMessage("WARN", ...args)),
    error: (...args) => console.error(formatMessage("ERROR", ...args)),
    debug: (...args) => {
      if (process.env.DEBUG) {
        console.debug(formatMessage("DEBUG", ...args));
      }
    }
  };
}

export function createFileLogger(prefix, filePath) {
  const consoleLogger = createLogger(prefix);

  const logToFile = async (level, ...args) => {
    const timestamp = new Date().toISOString();
    const message = args.map(arg =>
      typeof arg === "object" ? JSON.stringify(arg) : String(arg)
    ).join(" ");
    const line = `${timestamp} [${level}] ${message}\n`;

    try {
      await appendFile(filePath, line);
    } catch (err) {
      consoleLogger.error("Failed to write to log file:", err.message);
    }
  };

  return {
    log: (...args) => {
      consoleLogger.log(...args);
      logToFile("INFO", ...args);
    },
    info: (...args) => {
      consoleLogger.info(...args);
      logToFile("INFO", ...args);
    },
    warn: (...args) => {
      consoleLogger.warn(...args);
      logToFile("WARN", ...args);
    },
    error: (...args) => {
      consoleLogger.error(...args);
      logToFile("ERROR", ...args);
    },
    debug: (...args) => {
      consoleLogger.debug(...args);
      if (process.env.DEBUG) {
        logToFile("DEBUG", ...args);
      }
    }
  };
}

export default createLogger;
