// Run: pnpm --filter @workspace/ring-inbox exec node tests/task-text/browser.mjs
// Actual web + React Native Web components, synthetic requests only.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const mobile = path.resolve("../index-mobile");
const mobileRequire = createRequire(path.join(mobile, "package.json"));
const output = path.resolve("../../generated-artifacts/task-text");
await mkdir(output, { recursive: true });
await build({
  configFile: false, root: process.cwd(), logLevel: "warn",
  plugins: [{
    name: "isolated-native-web",
    resolveId(id, importer) {
      if (id === "@react-native-community/datetimepicker") return "\0date-picker";
      if (id === "react-native-safe-area-context") return "\0safe-area";
      if (id === "react-native-keyboard-controller") return "\0keyboard";
      if (id === "@expo/vector-icons") return "\0icons";
    },
    load(id) {
      if (id === "\0date-picker") return "export default function DatePicker() {return null}";
      if (id === "\0safe-area") return "export const useSafeAreaInsets=()=>({top:0,left:0,right:0,bottom:0}); export const SafeAreaProvider=({children})=>children;";
      if (id === "\0keyboard") return "export {ScrollView as KeyboardAwareScrollView} from 'react-native';";
      if (id === "\0icons") return "export const Feather=()=>null;";
      if (id === path.join(mobile, "components/recording.tsx")) return "export function Recording() {return null}";
    },
    transform(code, id) {
      if (id === path.join(mobile, "hooks/use-horizontal-swipe.ts")) {
        // Exercise the editor's navigation callback without claiming that a
        // Chromium harness validates native responder/finger behavior.
        return code.replace("const latest =", "globalThis.navigateTask = onSwipe; const latest =");
      }
    },
  }, react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: mobileRequire.resolve("react-native-web") },
      { find: "@react-native-community/datetimepicker", replacement: "\0date-picker" },
      { find: "react-native-safe-area-context", replacement: "\0safe-area" },
      { find: "react-native-keyboard-controller", replacement: "\0keyboard" },
      { find: "@expo/vector-icons", replacement: "\0icons" },
      { find: "@/constants/colors", replacement: path.join(mobile, "constants/colors.ts") },
      { find: "@/hooks/use-horizontal-swipe", replacement: path.join(mobile, "hooks/use-horizontal-swipe.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  define: { __DEV__: "false", "process.env.EXPO_OS": '"web"' },
  build: { outDir: output, emptyOutDir: true, rollupOptions: { input: "tests/task-text/fixture.tsx", output: { entryFileNames: "fixture.js", assetFileNames: "[name][extname]" } } },
});
const files = await import("node:fs/promises").then(fs => fs.readdir(output));
const css = files.filter(f => f.endsWith(".css")).map(f => `<link rel="stylesheet" href="/${f}">`).join("");
const server = createServer(async (req, res) => {
  try {
    const file = req.url?.slice(1);
    if (!file) { res.setHeader("content-type", "text/html"); res.end(`${css}<div id="root"></div><script type="module" src="/fixture.js"></script>`); return; }
    res.setHeader("content-type", file.endsWith(".css") ? "text/css" : file.endsWith(".ttf") ? "font/ttf" : "text/javascript");
    res.end(await readFile(path.join(output, file)));
  } catch { res.writeHead(404); res.end(); }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const userData = await mkdtemp(path.join(output, "chromium-"));
const chrome = spawn(process.env.CHROMIUM ?? "chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${userData}`, "about:blank"]);
try {
  let stderr = "";
  const endpoint = await new Promise((resolve, reject) => {
    chrome.stderr.on("data", chunk => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
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
    if (message.id) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(message.error) : resolve(message.result); }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const viewport = width => send("Emulation.setDeviceMetricsOverride", { width, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await viewport(375);
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 }, sessionId);
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` }, sessionId);
  for (let n = 0; n < 150 && !await evaluate("!!document.querySelector('textarea')"); n++) await wait(100);
  await evaluate(`window.check = (condition, message) => { if (!condition) throw Error(message); };
    window.tick = () => new Promise(r => setTimeout(r, 100));
    window.field = id => document.querySelector('[data-testid="'+id+'"]');
    window.edit = async (node, value) => {
      node.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,value);
      node.dispatchEvent(new Event('input',{bubbles:true}));
      await tick();
    };
    window.fits = node => { check(node.scrollHeight <= node.clientHeight + 1, 'Text clipped: '+ node.scrollHeight + '/' + node.clientHeight+' width='+node.clientWidth+' style='+node.getAttribute('style')); check(getComputedStyle(node).overflowY === 'hidden', 'Inner scrollbar'); };
  `);
  await evaluate(`(async () => {
    const row=field('input-title-long'); fits(row); check(row.clientHeight>100,'Initial long row did not grow');
    window.narrowHeight=row.clientHeight;
    const composer=field('input-new-title'); window.minHeight=composer.clientHeight;
    await edit(composer,fixture.long); fits(composer); check(composer.clientHeight>minHeight,'Paste did not grow');
    await edit(composer,'First paragraph'); composer.setSelectionRange(composer.value.length,composer.value.length);
  })()`);
  // Real keyboard Enter, not a scripted change event.
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }, sessionId);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, sessionId);
  await evaluate(`(async () => {
    await tick(); const composer=field('input-new-title'); check(composer.value==='First paragraph\\n','Enter did not insert newline: '+JSON.stringify(composer.value)); check(fixture.requests.length===0,'Enter submitted');
    await edit(composer,'First paragraph\\n\\nSecond paragraph');
    field('button-add').click(); await tick(); await tick();
    check(fixture.tasks.find(t=>t.id==='created').title==='First paragraph\\n\\nSecond paragraph','Create lost paragraphs');
    check(composer.value==='','Composer did not reset'); check(composer.clientHeight===minHeight,'Empty composer did not shrink');
    const row=field('input-title-long');
    await edit(row,'Updated first\\n\\nLast'); fits(row); row.blur(); await tick(); await tick();
    check(fixture.tasks[0].title==='Updated first\\n\\nLast','Blur lost paragraphs');
    await edit(row,'Do not save');
  })()`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
  await evaluate(`(async () => {
    await tick(); const row=field('input-title-long');
    check(row.value==='Updated first\\n\\nLast','Escape did not restore');
    check(fixture.tasks[0].title===row.value,'Escape saved');
    await edit(row,''); row.blur(); await tick(); check(row.value===fixture.tasks[0].title,'Blank edit did not restore');
    await edit(row,fixture.long); row.blur(); await tick(); await tick();
  })()`);
  await viewport(1280); await wait(150);
  await evaluate(`fits(field('input-title-long')); check(field('input-title-long').clientHeight<narrowHeight,'Wider row did not shrink');`);
  await viewport(375); await wait(150);
  await evaluate(`(async () => { document.querySelector('#open-mobile').click(); await tick(); await tick(); const node=field('input-task-title'); check(!!node,'Mobile editor absent'); fits(node); check(node.clientHeight>105,'Initial mobile long content clipped'); window.mobileLongHeight=node.clientHeight; await edit(node,'Short'); check(node.getBoundingClientRect().height===105,'Mobile minimum changed'); await edit(node,''); check(node.getBoundingClientRect().height===105,'Empty mobile minimum changed'); await edit(node,'Mobile first\\n\\nMobile second'); check(node===document.activeElement,'Focus lost'); check(node.maxLength===500,'Mobile limit changed'); field('button-save-task').click(); await tick(); await tick(); check(fixture.tasks[0].title==='Mobile first\\n\\nMobile second','Mobile save lost paragraphs'); check(field('input-title-long').value===fixture.tasks[0].title,'Web did not receive mobile paragraphs'); document.querySelector('#open-mobile').click(); await tick(); check(field('input-task-title').value===fixture.tasks[0].title,'Reopen lost paragraphs'); await edit(field('input-task-title'),fixture.long); fits(field('input-task-title')); })()`);
  await viewport(1280); await wait(150);
  await evaluate(`fits(field('input-task-title')); check(field('input-task-title').clientHeight<mobileLongHeight,'Mobile wider layout did not shrink');`);
  await viewport(375); await wait(150);
  await evaluate(`(async()=>{ const node=field('input-task-title'); await edit(node,'x'.repeat(500)); fits(node); node.setSelectionRange(250,250); document.fonts.dispatchEvent(new Event('loadingdone')); await tick(); check(node.selectionStart===250 && document.activeElement===node,'Font resize changed selection'); field('button-close').click(); await tick(); check(document.body.textContent.includes('Save changes before closing'),'Unsaved navigation prompt missing'); field('button-keep-editing').click(); await tick(); check(field('input-task-title').value==='x'.repeat(500),'Keep editing lost text'); field('button-close').click(); await tick(); field('button-discard-changes').click(); await tick(); check(fixture.tasks[0].title==='Mobile first\\n\\nMobile second','Discard saved changes'); })()`);
  await evaluate(`(async()=>{
    document.querySelector('#open-mobile').click(); await tick();
    await edit(field('input-task-title'),fixture.long);
    field('input-task-title').blur();
    navigateTask('next'); await tick();
    check(document.body.textContent.includes('Save changes before switching'),'Unsaved switch prompt missing');
    field('button-discard-changes').click(); await tick();
    check(field('input-task-title').value==='Short task','Switch did not load next task');
    check(field('input-task-title').getBoundingClientRect().height===105,'Switch to short did not shrink');
    navigateTask('previous'); await tick();
    check(field('input-task-title').value==='Mobile first\\n\\nMobile second','Switch back lost saved value');
    await edit(field('input-task-title'), Array(50).fill('line').join('\\n')); fits(field('input-task-title'));
    const save=field('button-save-task'); save.scrollIntoView({block:'center'}); await tick();
    const rect=save.getBoundingClientRect(); check(rect.top>=0 && rect.bottom<=innerHeight,'Save not reachable by outer scrolling');
    field('button-close').click(); await tick(); field('button-discard-changes').click(); await tick();
  })()`);
  // A screenshot of the isolated components, not a claim of authenticated UI.
  const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
  await writeFile(path.join(output, "browser.png"), Buffer.from(image.data, "base64"));
  console.log("PASS: web and mobile-browser initial long values, Enter, paragraph save/reopen, blur, Escape, blank validation, paste/deletion, width changes, 105px minimum, font resize/focus/selection, 500-character limit, task-switch callback, unsaved prompt/discard and outer scroll reachability");
  socket.close();
} finally {
  chrome.kill(); server.close(); await once(chrome, "exit").catch(() => {});
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
