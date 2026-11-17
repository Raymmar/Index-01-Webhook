// Isolated real Dashboard + generated API hooks. No authentication bypass or app route.
// Run from artifacts/ring-inbox: node tests/task-deletion-browser.mjs
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const require = createRequire(resolve("../../node_modules/.pnpm/node_modules/package.json"));
const { chromium } = require("playwright");
const output = resolve("../../generated-artifacts/web-task-deletion");
await mkdir(output, { recursive: true });
const source = `
  import React, {useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
  import {TaskDeletionProvider} from './src/components/task-deletion-provider';
  import {InboxDrawerContext} from './src/hooks/use-inbox-drawer';
  import {Toaster} from './src/components/ui/toaster';
  import Dashboard from './src/pages/dashboard';
  import {EventCard} from './src/pages/inbox';
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  function Harness(){
    const [visible,setVisible]=useState(true),[owner,setOwner]=useState('one');
    return <QueryClientProvider client={client}>
      <button onClick={()=>setVisible(v=>!v)}>Toggle dashboard</button>
      <button onClick={()=>setOwner('two')}>Change owner</button>
      <TaskDeletionProvider key={owner}><InboxDrawerContext.Provider value={{openInbox(){}}}>
        {visible && <Dashboard/>}
        {['message-one','message-two'].map(id=><EventCard key={id} e={{id,kind:'text',transcription:id,webhookName:'Test',receivedAt:'2026-11-16T10:00:00Z',payload:{}}} items={[]} highlight={false} embedded={true} localPending={false}/>)}
      </InboxDrawerContext.Provider></TaskDeletionProvider><Toaster/>
    </QueryClientProvider>
  }
  createRoot(document.getElementById('root')).render(<Harness/>);
`;
await build({
  configFile: false, logLevel: "warn", plugins: [react(), {
    name: "isolated-undo-harness",
    resolveId(id) { if (id === "undo-harness") return resolve("undo-harness.tsx"); },
    load(id) { if (id === resolve("undo-harness.tsx")) return source; },
  }],
  resolve: { alias: { "@": resolve("src") }, dedupe: ["react", "react-dom", "@tanstack/react-query"] },
  build: { outDir: output, emptyOutDir: true, rollupOptions: { input: "undo-harness", output: { entryFileNames: "app.js" } } },
});

let tasks = ["one", "two", "three", "four", "five", "six"].map(id => ({
  id, title: `Task ${id}`, kind: "task", status: "open", dueAt: null,
  sourceEventId: "original", sourceDeleted: false, needsReview: false,
  createdAt: "2026-11-16T10:00:00Z",
}));
const deleted = new Map(), requests = [];
const preferences = { timezone: "UTC", skipTaskDismissConfirmation: false, skipTaskDeleteConfirmation: false, skipMessageDeleteConfirmation: false };
let deleteFails = false, restoreStatus = 200, delayRestore = false;
const server = createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    const method = req.method;
    requests.push({ url: req.url, method });
    res.setHeader("content-type", "application/json");
    if (req.url.includes("/settings")) {
      if (method === "PATCH") {
        let body = ""; for await (const part of req) body += part;
        Object.assign(preferences, JSON.parse(body));
      }
      res.end(JSON.stringify(preferences)); return;
    }
    if (req.url.startsWith("/api/events/") && method === "DELETE") { res.writeHead(204); res.end(); return; }
    if (req.url.startsWith("/api/items/")) {
      const id = req.url.split("/")[3];
      if (method === "DELETE") {
        if (deleteFails) { res.writeHead(500); res.end('{"error":"Delete failed"}'); return; }
        deleted.set(id, tasks.find(t => t.id === id)); tasks = tasks.filter(t => t.id !== id);
        res.writeHead(204); res.end(); return;
      }
      if (req.url.endsWith("/restore")) {
        if (delayRestore) await new Promise(r => setTimeout(r, 250));
        res.statusCode = restoreStatus;
        if (restoreStatus === 200) { tasks.push(deleted.get(id)); res.end(JSON.stringify(deleted.get(id))); }
        else res.end('{"error":"Restore failed"}');
        return;
      }
      if (method === "PATCH") {
        let body = ""; for await (const part of req) body += part;
        const patch = JSON.parse(body);
        tasks = tasks.map(t => t.id === id ? { ...t, ...patch } : t);
        res.end(JSON.stringify(tasks.find(t => t.id === id))); return;
      }
    }
    res.end(JSON.stringify(req.url.includes("settings") ? { timezone: "UTC" }
      : req.url.includes("organizer") ? { items: tasks, jobs: [], messageCount: 1 }
      : { events: [], total: 1 }));
    return;
  }
  if (req.url === "/app.js") {
    res.setHeader("content-type", "text/javascript"); res.end(await readFile(resolve(output, "app.js"))); return;
  }
  res.setHeader("content-type", "text/html");
  res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/app.js"></script>');
}).listen(0, "127.0.0.1");
await new Promise(r => server.once("listening", r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, hasTouch: true });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const row = id => page.getByTestId(`row-item-${id}`);
  const notice = id => page.getByTestId(`task-deletion-${id}`);
  const undo = id => page.getByTestId(`button-undo-delete-${id}`);
  async function menu(id, action) {
    await page.getByTestId(`button-menu-${id}`).click();
    await page.getByTestId(`menu-${action}-${id}`).click();
    await page.getByRole("alertdialog").waitFor();
    await page.getByTestId("button-confirm").click();
  }
  await row("one").waitFor({ timeout: 5000 }).catch(async error => {
    console.error({ errors, requests, body: await page.locator("body").textContent() });
    throw error;
  });
  // Dismissal remains PATCH, not deletion, and works from the closed list.
  await page.getByTestId("button-menu-six").click();
  await page.getByTestId("menu-dismiss-six").click();
  await page.getByTestId("checkbox-skip-dismiss-confirmation").check();
  await page.getByTestId("button-cancel-confirm").click();
  assert.equal(preferences.skipTaskDismissConfirmation, false, "Cancel must not remember a choice");
  await menu("six", "dismiss");
  await row("six").waitFor({ state: "detached" });
  assert.equal(await notice("six").count(), 0);
  assert.equal(requests.filter(r => r.method === "DELETE").length, 0);
  await page.getByRole("button", { name: "Completed & dismissed", exact: true }).click();
  await page.getByTestId("button-menu-six").click();
  await page.getByTestId("menu-restore-six").click();
  await page.getByRole("button", { name: "Show open items", exact: true }).click();
  await row("six").waitFor();
  // Menu failure leaves the row and exposes an error.
  deleteFails = true; await menu("one", "delete");
  await page.getByTestId("button-confirm").waitFor();
  await page.waitForFunction(() => document.body.textContent.includes("Could not save your choice or finish the action"));
  assert.equal(await row("one").count(), 1); assert.equal(await notice("one").count(), 0);
  deleteFails = false;
  // Failed actions keep the dialog open for retry.
  await page.getByTestId("button-confirm").click();
  await undo("one").waitFor(); await row("one").waitFor({ state: "detached" });
  assert.equal(await row("two").count(), 1);
  assert.equal(await page.getByTestId("stat-messages").textContent(), "1");
  // Notice survives Dashboard unmount, rather than dying with the deleted row.
  await page.getByRole("button", { name: "Toggle dashboard" }).click();
  await undo("one").waitFor();
  await page.getByRole("button", { name: "Toggle dashboard" }).click();
  // A touch swipe uses the same deletion/Undo flow.
  await row("two").locator("[data-swipe-delete]").evaluate(node => {
    const event = (type, x) => node.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 1, isPrimary: true, pointerType: "touch", button: 0,
      clientX: x, clientY: 40,
    }));
    event("pointerdown", 250); event("pointerup", 100);
  });
  await page.getByRole("alertdialog").waitFor();
  await page.getByTestId("button-confirm").click();
  await undo("two").waitFor(); await row("two").waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-testid^="task-deletion-"]').count(), 2);
  restoreStatus = 500;
  await undo("one").click();
  await notice("one").getByRole("alert").waitFor();
  assert.equal(await undo("one").isEnabled(), true);
  restoreStatus = 200; delayRestore = true;
  const count = requests.filter(r => r.url.endsWith("/restore")).length;
  // Keyboard operability, pending feedback and duplicate-click protection.
  await undo("one").focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Undo removal of Task one", exact: true, disabled: true }).waitFor();
  await row("one").waitFor();
  await notice("one").waitFor({ state: "detached" });
  assert.equal(requests.filter(r => r.url.endsWith("/restore")).length, count + 1);
  restoreStatus = 410; await undo("two").click();
  await notice("two").waitFor({ state: "detached" });
  assert.equal(await undo("two").count(), 0);
  await menu("three", "delete"); await undo("three").waitFor();
  await page.clock.fastForward(15_001);
  await notice("three").waitFor({ state: "detached" });
  assert.equal(await undo("three").count(), 0);
  assert.equal(await page.locator('[data-testid^="task-deletion-"]').count(), 0);
  // The remembered choice is stored by the server, not browser storage.
  await page.getByTestId("button-menu-four").click();
  await page.getByTestId("menu-delete-four").click();
  await page.getByTestId("checkbox-skip-dismiss-confirmation").check();
  await page.getByTestId("button-confirm").click();
  await row("four").waitFor({ state: "detached" });
  assert.equal(preferences.skipTaskDeleteConfirmation, true);
  const second = await browser.newPage();
  await second.goto(`http://127.0.0.1:${server.address().port}`);
  await second.getByTestId("button-menu-five").click();
  await second.getByTestId("menu-delete-five").click();
  await second.getByTestId("row-item-five").waitFor({ state: "detached" });
  assert.equal(await second.getByRole("alertdialog").count(), 0, "Fresh device must honor saved preference");
  assert.equal(preferences.skipTaskDismissConfirmation, false, "Preferences are independent");
  await page.getByTestId("button-message-actions-message-one").click();
  await page.getByTestId("button-delete-message-message-one").click();
  await page.getByTestId("checkbox-skip-message-delete-confirmation").check();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete message", exact: true }).click();
  await page.getByRole("alertdialog").waitFor({ state: "detached" });
  assert.equal(preferences.skipMessageDeleteConfirmation, true);
  // Simulate the same settings invalidation performed by SSE through a reload
  // in a separate browser context, with no shared localStorage.
  await second.reload();
  await second.getByTestId("button-message-actions-message-two").click();
  const messageDeleted = second.waitForResponse(response => response.url().endsWith("/api/events/message-two") && response.request().method() === "DELETE");
  await second.getByTestId("button-delete-message-message-two").click();
  await messageDeleted;
  assert.equal(await second.getByRole("alertdialog").count(), 0);
  await second.close();
  assert.equal(requests.filter(r => r.method === "DELETE" && !r.url.startsWith("/api/items/")).length, 2);
  await page.getByRole("button", { name: "Change owner" }).click();
  assert.equal(await page.locator('[data-testid^="task-deletion-"]').count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: real Dashboard menu/swipe deletion, dismissal vs deletion, source/sibling preservation, row unmount, independent notices, generated restore hook, keyboard Undo, errors/retry, pending state, server/local expiry, owner reset");
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
