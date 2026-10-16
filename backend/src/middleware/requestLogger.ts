import type { RequestHandler } from 'express';

// Logs one line per request once it's over: 'DELETE /workouts/3/sets/5 204 12ms', or
// 'GET /workouts aborted by client after 10004ms' when the client hung up before the answer (the
// app gives up after 10 s). Added to find out what the phone actually sends, e.g. how many DELETEs
// one tap causes. Only the method and URL are logged: never bodies or headers, which hold
// passwords and tokens.
//
// `log` and `now` are parameters (dependency injection) so a test can collect the lines and use a
// fake clock; the app passes console.log and the default clock.
// performance.now() is milliseconds since the process started, with fractions, and unlike
// Date.now() it never jumps when the system clock is changed.
export function requestLogger(
  log: (line: string) => void,
  now: () => number = () => performance.now()
): RequestHandler {
  return (req, res, next) => {
    const start = now();
    // Read before routing: a router mounted at /workouts sees req.url as just '/3/sets/5', but
    // originalUrl keeps the whole path (and query string) as the client sent it.
    const request = `${req.method} ${req.originalUrl}`;
    // 'close' fires once per response, both after a normal finish and when the connection drops
    // first. writableFinished says which: true only if the whole response was handed off.
    res.on('close', () => {
      const ms = Math.round(now() - start);
      log(
        res.writableFinished ? `${request} ${res.statusCode} ${ms}ms` : `${request} aborted by client after ${ms}ms`
      );
    });
    next();
  };
}
