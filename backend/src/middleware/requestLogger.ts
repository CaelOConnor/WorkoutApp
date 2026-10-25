import type { RequestHandler } from 'express';

// Logs one line per request when it's done, like 'DELETE /workouts/3/sets/5 204 12ms'.
// Only the method and URL, never bodies or headers, which contain passwords and tokens.
// log and now are parameters so tests can capture the lines and use a fake clock.
export function requestLogger(
  log: (line: string) => void,
  now: () => number = () => performance.now() // unlike Date.now(), never jumps if the clock changes
): RequestHandler {
  return (req, res, next) => {
    const start = now();
    // originalUrl is the full path. Inside a router, req.url would only be the part after the mount point.
    const request = `${req.method} ${req.originalUrl}`;
    // Runs when the response ends. writableFinished is false if the client gave up first.
    res.on('close', () => {
      const ms = Math.round(now() - start);
      log(
        res.writableFinished ? `${request} ${res.statusCode} ${ms}ms` : `${request} aborted by client after ${ms}ms`
      );
    });
    next();
  };
}