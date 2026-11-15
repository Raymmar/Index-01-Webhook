// pnpm --filter @workspace/ring-inbox exec node tests/performance/profile.mjs
// Requires Chromium on PATH; builds a production-only fixture, never an app route.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";

const output = path.resolve("../../generated-artifacts/inbox-performance");
const baseline = process.argv.includes("--baseline");
await mkdir(output, { recursive: true });
await build({
  configFile: false, root: process.cwd(), logLevel: "warn",
  plugins: [
    ...(baseline ? [{
      name: "baseline-source",
      load(id) {
        const files = ["src/pages/inbox.tsx", "src/hooks/use-inbox-feed.ts", "src/components/feed-scroll-anchor.tsx", "src/index.css"];
        const file = files.find(file => id === path.resolve(file));
        if (file) return execFileSync("git", ["show", `HEAD:artifacts/ring-inbox/${file}`], { encoding: "utf8" });
      },
    }] : []),
    react(), tailwindcss(),
  ],
  resolve: { alias: { "@": path.resolve("src") }, dedupe: ["react", "react-dom", "@tanstack/react-query"] },
  build: { outDir: output, emptyOutDir: true, minify: true, rollupOptions: { input: "tests/performance/fixture.tsx", output: { entryFileNames: "fixture.js", assetFileNames: "[name][extname]" } } },
});
const server = createServer(async (req, res) => {
  try {
    const file = new URL(req.url, "http://localhost").pathname;
    if (file === "/") {
      res.setHeader("Content-Type", "text/html");
      return res.end('<link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>');
    }
    if (!/^\/[\w.-]+$/.test(file)) { res.writeHead(404); return res.end(); }
    res.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "text/javascript");
    res.end(await readFile(path.join(output, file)));
  } catch { res.writeHead(404); res.end(); }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const userData = await mkdtemp(path.join(output, "chromium-"));
const chrome = spawn(process.env.CHROMIUM ?? "chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio", "--remote-debugging-port=0", `--user-data-dir=${userData}`, "--window-size=1280,900", "about:blank"]);
try {
  let stderr = "";
  const endpoint = await new Promise((resolve, reject) => {
    chrome.stderr.on("data", chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) resolve(match[1]);
    });
    chrome.on("error", reject);
    chrome.on("exit", () => reject(new Error(stderr)));
  });
  const socket = new WebSocket(endpoint);
  await once(socket, "open");
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") console.error(JSON.stringify(message.params));
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") console.error(JSON.stringify(message.params));
    if (message.id) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(message.error) : resolve(message.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const results = [];
  for (const count of [500, 2000]) for (const embedded of [true, false]) {
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?count=${count}&embedded=${embedded}` }, sessionId);
    for (let n = 0; n < 300 && !await evaluate("!!window.fixture"); n++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await evaluate("document.querySelectorAll('article').length"), count);
    await new Promise(resolve => setTimeout(resolve, 1200));
    const mountMs = await evaluate("fixture.mountMs");
    const scrolling = await evaluate("fixture.scroll()");
    const refreshMs = [];
    for (let n = 0; n < 5; n++) refreshMs.push(await evaluate("fixture.refresh()"));
    results.push({ count, embedded, mountMs, scrolling, refreshMs, nodes: await evaluate("document.querySelectorAll('*').length") });
    console.log(JSON.stringify(results.at(-1)));
    if (!baseline && count === 2000) {
      assert.equal(await evaluate(`(async () => {
        fixture.enableAudio();
        const audio = document.querySelector('[data-testid="audio-note-0"]');
        await audio.play();
        const card = document.querySelector('[data-testid="card-event-note-50"]');
        card.scrollIntoView({block:'center'});
        await new Promise(resolve => setTimeout(resolve, 300));
        const payload = card.querySelector('[aria-controls]');
        payload.click();
        const input = card.querySelector('textarea[data-testid^="input-title-"]');
        input.focus();
        // Native input edit, without saving or touching a backend.
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Unsaved edit');
        input.dispatchEvent(new Event('input', {bubbles:true}));
        await new Promise(requestAnimationFrame);
        const before = card.getBoundingClientRect().top;
        const time = audio.currentTime;
        await fixture.refresh();
        fixture.prioritize();
        await new Promise(resolve => setTimeout(resolve, 150));
        if (document.querySelector('[data-testid="card-event-note-50"]') !== card) throw Error('Card remounted');
        if (document.activeElement !== input || input.value !== 'Unsaved edit') throw Error('Focus or edit lost');
        if (!payload.getAttribute('aria-expanded') || payload.getAttribute('aria-expanded') !== 'true') throw Error('Payload closed');
        if (card.querySelector('pre').hidden || !card.querySelector('pre').textContent.includes('sequence')) throw Error('Payload missing');
        if (card.querySelectorAll('li').length !== 3) throw Error('Linked action rows lost');
        // Headless Chromium in this container has no audio output clock.
        // Verify element, playback state and position survive; not audibility.
        if (audio !== document.querySelector('[data-testid="audio-note-0"]') || audio.paused || audio.currentTime < time || audio.error) throw Error('Audio playback state lost');
        if (Math.abs(card.getBoundingClientRect().top - before) > 2) throw Error('Visible card shifted: ' + (card.getBoundingClientRect().top - before));
        audio.pause();
        return true;
      })()`), true);
      console.log(`State retention and scroll anchoring passed (${embedded ? "embedded" : "page"})`);
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?count=2000&embedded=${embedded}&event=note-1900` }, sessionId);
      for (let n = 0; n < 300 && !await evaluate("!!window.fixture"); n++) await new Promise(resolve => setTimeout(resolve, 100));
      await new Promise(resolve => setTimeout(resolve, 1600));
      assert.equal(await evaluate(`(() => {
        const card = document.querySelector('[data-testid="card-event-note-1900"]');
        const rect = card.getBoundingClientRect();
        return card.classList.contains('border-accent') && rect.top < innerHeight && rect.bottom > 0;
      })()`), true, "Deep-linked card is highlighted and visible");
      console.log(`Deep-link highlighting passed (${embedded ? "embedded" : "page"})`);
    }
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  socket.close();
} finally {
  chrome.kill();
  server.close();
  await once(chrome, "exit").catch(() => {});
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
