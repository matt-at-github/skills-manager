import { styleText } from "node:util";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const COLORS = {
  debug: ["dim"],
  info: ["cyan"],
  warn: ["yellow"],
  error: ["red", "bold"],
};

function paint(level, msg) {
  try {
    return styleText(COLORS[level], msg);
  } catch {
    return msg;
  }
}

export function createLogger(levelName = "info") {
  const threshold = LEVELS[levelName] ?? LEVELS.info;
  const log = (level, ...args) => {
    if (LEVELS[level] < threshold) return;
    const tag = paint(level, `[${level}]`);
    const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
    stream.write(`${tag} ${args.map(stringify).join(" ")}\n`);
  };
  return {
    debug: (...a) => log("debug", ...a),
    info: (...a) => log("info", ...a),
    warn: (...a) => log("warn", ...a),
    error: (...a) => log("error", ...a),
  };
}

function stringify(v) {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
