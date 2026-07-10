import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "frames_cine");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const htmlPath = path.join(__dirname, "scene.html");

const server = http.createServer((req, res) => {
  if (
    req.method === "GET" &&
    (req.url === "/" ||
      req.url.startsWith("/?") ||
      req.url.startsWith("/index"))
  ) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(htmlPath));
    return;
  }
  if (req.method === "POST" && req.url === "/frame") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        const sep = body.indexOf("|");
        const idx = parseInt(body.slice(0, sep), 10);
        const dataUrl = body.slice(sep + 1);
        const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        const buf = Buffer.from(b64, "base64");
        const name = "f_" + String(idx + 1).padStart(5, "0") + ".jpg";
        fs.writeFileSync(path.join(OUT, name), buf);
        res.writeHead(200);
        res.end("ok");
      } catch (e) {
        res.writeHead(500);
        res.end("err");
      }
    });
    return;
  }
  if (req.method === "GET" && req.url === "/count") {
    const n = fs.readdirSync(OUT).filter((f) => f.endsWith(".jpg")).length;
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(String(n));
    return;
  }
  res.writeHead(404);
  res.end("nf");
});

server.listen(4599, () =>
  console.log("scene-server on http://localhost:4599  ->  " + OUT),
);
