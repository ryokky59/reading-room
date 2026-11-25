// A local stand-in for the outside world, so the E2E tests never reach the network.
// - Seeded feeds point here and are always empty but healthy: 「今すぐ取得」 must not leave them
//   with a fetch error, or they would all move to 「止まっているフィード」 on the Board.
// - FAVICON_SERVICE points here too, and answers by host the way DuckDuckGo does. Any other host
//   has no icon, so its badge falls back to the initial. redirect.example is answered with a
//   redirect; GET /favicons/redirected/count tells how many requests reached where it points.
import { createServer } from "node:http";

const port = Number(process.env.E2E_STUB_PORT);
if (!port) throw new Error("E2E_STUB_PORT is required");

// A 1×1 PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// Requests that reached where redirect.example's redirect points: the app must never follow it.
let redirected = 0;

createServer((req, res) => {
  if (req.url?.startsWith("/e2e/feeds/")) {
    res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>E2E</title><link>http://localhost:${port}/</link></channel></rss>`);
  } else if (req.url === "/favicons/good.example.ico") {
    res.writeHead(200, { "content-type": "image/png" }).end(png);
  } else if (req.url === "/favicons/notfound.example.ico") {
    // A host DuckDuckGo has nothing for: a 404 with a placeholder image as its body.
    res.writeHead(404, { "content-type": "image/png" }).end(png);
  } else if (req.url === "/favicons/empty.example.ico") {
    res.writeHead(200, { "content-type": "text/plain" }).end();
  } else if (req.url === "/favicons/redirect.example.ico") {
    res.writeHead(302, { location: `http://localhost:${port}/favicons/redirected.png` }).end();
  } else if (req.url === "/favicons/redirected.png") {
    redirected++;
    res.writeHead(200, { "content-type": "image/png" }).end(png);
  } else if (req.url === "/favicons/redirected/count") {
    res.writeHead(200, { "content-type": "text/plain" }).end(String(redirected));
  } else if (req.url !== "/favicons/hang.example.ico") {
    res.writeHead(404).end();
  }
  // hang.example never gets an answer.
}).listen(port, "127.0.0.1");
