// Real editor, sheet, gestures, Recording, and generated queries against isolated HTTP
// fixtures. Only native bridges/auth/session are stubbed; app authentication is untouched.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('artifacts/index-mobile');
const task = (id, extra = {}) => ({
  id, title: `Task ${id}`, sourceEventId: id, timezone: 'UTC', kind: 'task',
  status: 'open', dueAt: null, pinnedAt: null, needsReview: false,
  originalTimeText: null, createdAt: '2026-01-01T00:00:00Z', ...extra,
});
const longText = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}: Keep the full original context readable and selectable.`).join('\n\n');
const sources = {
  a: { transcription: 'First original transcript.\nKeep this second line.', audioUrl: '/audio/a' },
  b: { transcription: 'Text-only original context.', audioUrl: null },
  audio: { transcription: null, audioUrl: '/audio/only' },
  empty: { transcription: ' \n ', audioUrl: null },
  deleted: { deletedAt: '2026-01-01', transcription: 'DO NOT SHOW DELETED TEXT', audioUrl: '/audio/deleted' },
  long: { transcription: longText, audioUrl: '/audio/long' },
  slow: { transcription: 'Delayed original context.', audioUrl: null },
  retry: { transcription: 'Recovered original context.', audioUrl: null },
};
let fail = false, release, requests = [], saves = [], audioRequests = [];
const bundle = await build({
  absWorkingDir: root,
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {ItemEditor} from './components/item-editor';
    import Dashboard from './app/(tabs)/index';
    import {LinkedTasks} from './components/linked-tasks';
    const qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    const task=(id,extra={})=>({id,title:'Task '+id,sourceEventId:id,timezone:'UTC',kind:'task',status:'open',dueAt:null,...extra});
    function App(){
      const [mode,setMode]=React.useState(null);
      window.openEditor=(ids,extra={})=>{qc.clear();setMode({ids,extra,key:Date.now()});};
      window.openEntry=entry=>{qc.clear();setMode({entry,key:Date.now()});};
      window.refresh=()=>qc.invalidateQueries();
      window.closeCount=0;
      if(!mode)return null;
      if(mode.entry==='dashboard')return <Dashboard key={mode.key}/>;
      if(mode.entry==='inbox')return <LinkedTasks key={mode.key} eventId="a" tz="UTC"/>;
      return <ItemEditor key={mode.key} item={mode.ids.length?task(mode.ids[0],mode.extra):undefined} tasks={mode.ids.map(id=>task(id))} tz="UTC" onClose={()=>{window.closeCount++;setMode(null);}}/>;
    }
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={qc}><App/></QueryClientProvider>);
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { 'react-native': 'react-native-web' },
  define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true', global: 'globalThis' },
  plugins: [{ name: 'native-bridges', setup(b) {
    const stub = (filter, name, contents) => {
      b.onResolve({ filter }, () => ({ path: name, namespace: 'fixture' }));
      b.onLoad({ filter: new RegExp('^' + name + '$'), namespace: 'fixture' }, () => ({ loader: 'tsx', resolveDir: root, contents }));
    };
    stub(/^expo-router$/, 'router', 'export const router={navigate(){}};');
    stub(/^@expo\/vector-icons$/, 'icons', 'import React from "react";export const Feather=()=>null;');
    stub(/^react-native-safe-area-context$/, 'insets', 'export const useSafeAreaInsets=()=>({top:0,bottom:0});');
    stub(/^react-native-keyboard-controller$/, 'keyboard', 'export {ScrollView as KeyboardAwareScrollView} from "react-native";');
    stub(/^@react-native-community\/datetimepicker$/, 'date', 'export default ()=>null;');
    stub(/(?:@\/lib\/session|^\.\/session)$/, 'session', 'export const origin=location.origin;export const useLive=()=>"live";export const deviceZone=()=>"UTC";');
    stub(/^@clerk\/expo$/, 'auth', 'export const useAuth=()=>({getToken:async()=>"fixture-token"});');
    stub(/^@\/hooks\/use-horizontal-swipe$/, 'swipe-observer', `
      import {useHorizontalSwipe as actual} from './hooks/use-horizontal-swipe';
      export function useHorizontalSwipe(onSwipe,enabled){
        window.navigateTask=onSwipe;
        return actual(onSwipe,enabled);
      }
    `);
    stub(/^expo-audio$/, 'audio', `
      import React from 'react';
      window.media={plays:0,pauses:0,restarts:0,mounts:0,unmounts:0};
      export const setAudioModeAsync=async()=>{};
      export function useAudioPlayer(){
        const [player]=React.useState(()=>({playing:false,currentTime:0,replace(){},
          play(){this.playing=true;window.media.plays++},pause(){this.playing=false;window.media.pauses++},
          async seekTo(){window.media.restarts++}}));
        React.useEffect(()=>{window.media.mounts++;return()=>{window.media.unmounts++}},[]);
        return player;
      }
      export const useAudioPlayerStatus=()=>({duration:60,currentTime:0,playing:false});
    `);
  } }],
});
const server = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/organizer') return res.end(JSON.stringify({ items: [task('a'), task('b')], jobs: [], messageCount: 2 }));
  if (req.url === '/api/settings') return res.end(JSON.stringify({ timezone: 'UTC' }));
  if (req.url.startsWith('/api/events/')) {
    const id = req.url.split('/').at(-1); requests.push(id);
    if (id === 'slow') await new Promise(r => { release = r; });
    if (id === 'retry' && fail) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'Source request failed' })); }
    return res.end(JSON.stringify({ id, ...sources[id] }));
  }
  if (req.url.startsWith('/audio/')) {
    audioRequests.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader('content-type', 'audio/wav'); return res.end('fixture-audio');
  }
  if (req.url.startsWith('/api/items')) {
    let body = ''; for await (const part of req) body += part;
    saves.push({ url: req.url, data: JSON.parse(body) });
    return res.end(JSON.stringify({ ...task('a'), ...JSON.parse(body) }));
  }
  res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : '<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script src="/app.js"></script>');
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.openEditor);
  const open = async (ids, extra = {}) => {
    await page.evaluate(({ ids, extra }) => window.openEditor(ids, extra), { ids, extra });
    await page.getByText(ids.length ? 'Edit task' : 'New task', { exact: true }).waitFor();
    await page.waitForTimeout(400); // Let RN Web's modal slide finish before touch coordinates.
  };
  const cdp = await page.context().newCDPSession(page);
  async function drag(locator, dx, dy = 0) {
    // A previous selectable-text drag can leave the browser selection active.
    // Dismiss it as a user would before beginning a separate navigation gesture.
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox(), x = Math.max(150, Math.min(260, box.x + box.width * .65)), y = Math.max(5, box.y) + 10;
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', x, y);
    for (const part of [.25, .5, .75, 1]) { await touch('touchMove', x + dx * part, y + dy * part); await page.waitForTimeout(25); }
    await page.waitForTimeout(80);
    await touch('touchEnd'); await page.waitForTimeout(450);
  }
  // Exercise the editor's existing navigation callback separately from native
  // gesture recognition; actual touch events above cover source-area isolation.
  const move = direction => page.evaluate(direction => window.navigateTask(direction), direction);
  for (const entry of ['dashboard', 'inbox']) {
    await page.evaluate(entry => window.openEntry(entry), entry);
    await page.getByRole('button', { name: 'Edit Task a', exact: true }).click({ timeout: 8000 }).catch(async error => {
      console.error(entry, await page.locator('body').innerText()); throw error;
    });
    await page.getByText('First original transcript.', { exact: false }).waitFor();
    assert.equal(await page.getByText('Original recording', { exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForTimeout(400);
  }
  await open(['a', 'b']);
  const transcript = page.getByText('First original transcript.', { exact: false });
  await transcript.waitFor();
  assert.equal(await transcript.evaluate(n => getComputedStyle(n).userSelect), 'text');
  assert.equal(await transcript.evaluate(n => getComputedStyle(n).fontSize), '16px');
  assert.equal(await transcript.evaluate(n => getComputedStyle(n).lineHeight), '26px');
  assert.ok((await page.getByRole('button', { name: 'Save task', exact: true }).boundingBox()).y < (await page.getByText('Original recording', { exact: true }).boundingBox()).y);
  assert.ok((await page.getByText('Original recording', { exact: true }).boundingBox()).y < (await transcript.boundingBox()).y);
  await drag(transcript, -110);
  assert.equal(await page.getByRole('textbox', { name: 'Task title' }).inputValue(), 'Task a');
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await page.waitForFunction(() => window.media.plays === 1);
  assert.deepEqual(audioRequests.at(-1), { url: '/audio/a', auth: 'Bearer fixture-token' });
  await page.getByLabel('Restart recording', { exact: true }).click();
  assert.equal(await page.evaluate(() => window.media.restarts), 1);
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  assert.equal(await page.evaluate(() => window.media.pauses), 1);
  const unmounts = await page.evaluate(() => window.media.unmounts);
  await move('next');
  await page.getByText('Text-only original context.', { exact: true }).waitFor();
  assert.equal(await transcript.count(), 0);
  assert.equal(await page.getByText('Original recording', { exact: true }).count(), 0);
  assert.ok(await page.evaluate(n => window.media.unmounts > n, unmounts));
  await move('previous');
  await transcript.waitFor();

  await open(['audio']);
  await page.getByText('No transcript was included.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await page.waitForFunction(() => window.media.plays === 2);
  assert.equal(audioRequests.at(-1).url, '/audio/only');
  await open(['empty']);
  await page.getByText('No transcript was included.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Play recording' }).count(), 0);
  await open(['deleted']);
  await page.getByText('Original content deleted', { exact: true }).waitFor();
  assert.equal(await page.getByText('DO NOT SHOW DELETED TEXT').count(), 0);
  assert.equal(await page.getByText('Original transcript', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Play recording' }).count(), 0);
  const before = requests.length;
  await open(['a'], { sourceDeleted: true });
  await page.getByText('Original content deleted', { exact: true }).waitFor();
  assert.equal(requests.length, before);

  await open(['slow', 'b']);
  await page.getByText('Loading original content…', { exact: true }).waitFor();
  await move('next');
  await page.getByText('Text-only original context.', { exact: true }).waitFor();
  release();
  await page.waitForTimeout(100);
  assert.equal(await page.getByText('Delayed original context.', { exact: true }).count(), 0);
  fail = true; await open(['retry']);
  await page.getByRole('alert').waitFor();
  fail = false; await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByText('Recovered original context.', { exact: true }).waitFor();

  await open(['long', 'b']);
  const long = page.getByText(longText, { exact: true }); await long.waitFor();
  await mkdir('generated-artifacts', { recursive: true });
  await page.screenshot({ path: 'generated-artifacts/task-source-top.png' });
  await drag(long, 0, -200);
  assert.equal(await page.getByRole('textbox', { name: 'Task title' }).inputValue(), 'Task long');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('*')].some(n => n.scrollTop > 0)));
  await long.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    let parent = node.parentElement; while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
    parent.scrollTop = parent.scrollHeight;
  });
  assert.equal(await page.evaluate(() => getSelection().toString()), longText);
  assert.ok(await long.evaluate(n => n.getBoundingClientRect().bottom <= innerHeight));
  await page.screenshot({ path: 'generated-artifacts/task-source-bottom.png' });
  await page.getByRole('textbox', { name: 'Task title' }).fill('Changed long task');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByText('Save changes before closing?', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await move('next');
  await page.getByText('Save changes before switching tasks?', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByText('Text-only original context.', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Task title' }).fill('Saved text task');
  await page.getByRole('textbox', { name: 'Due date in saved timezone' }).fill('2026-12-01T12:30');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Edit task', { exact: true }).waitFor({ state: 'detached' });
  assert.deepEqual(saves.at(-1), { url: '/api/items/b', data: { title: 'Saved text task', dueAt: '2026-12-01T12:30:00.000Z', needsReview: false } });
  const reads = requests.length;
  await open([]);
  assert.equal(await page.getByText('Original transcript', { exact: true }).count(), 0);
  assert.equal(requests.length, reads);
  await page.getByRole('textbox', { name: 'Task title' }).fill('New task title');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.getByText('New task', { exact: true }).waitFor({ state: 'detached' });
  assert.equal(saves.at(-1).url, '/api/items');
  assert.deepEqual(errors, []);
  console.log('PASS: Dashboard/inbox entry, audio+transcript, text-only, audio-only, empty/deleted, loading/retry, late-source switching, keyed player cleanup, media controls, source touch isolation, full long-text scroll/selection, dirty confirmation, navigation callbacks, save and new-task exclusion. Native audio bridge stubbed; physical playback and navigation gesture recognition not verified.');
} finally {
  release?.();
  await browser.close();
  await new Promise(r => server.close(r));
}
