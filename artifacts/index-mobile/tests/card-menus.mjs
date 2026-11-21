// Actual mobile cards, UI buttons, sheets and swipe guards in React Native Web.
// Only device chrome, router/session and unrelated editor/audio are isolated.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = resolve('artifacts/index-mobile');
const longTitle = 'Review the unusually long project proposal and confirm every outstanding detail with the team before the next meeting';
const items = [
  { id: 'short', title: 'Short task' },
  { id: 'pinned', title: longTitle, pinnedAt: '2026-11-20T00:00:00Z', sourceDeleted: true, needsReview: true, originalTimeText: 'next Thursday after the meeting' },
  { id: 'deleted', title: 'Deleted source task', sourceDeleted: true },
].map(item => ({ status: 'open', createdAt: '2026-11-20T00:00:00Z', sourceEventId: 'source', timezone: 'UTC', dueAt: null, ...item }));
const events = ['normal', 'pending', 'processing', 'failed', 'deleted'].map(id => ({
  id, kind: 'json', transcription: 'Original message with a long transcript. '.repeat(5),
  receivedAt: '2026-11-20T14:30:00Z', webhookName: 'A very long webhook name that must not displace the payload control',
  audioSize: 4096, payload: { original: true }, ...(id === 'deleted' ? { deletedAt: '2026-11-21T00:00:00Z' } : {}),
}));
const stubs = {
  'expo-router': 'export const router={navigate(){},setParams(){}};export const useLocalSearchParams=()=>({});',
  'react-native-safe-area-context': 'export const useSafeAreaInsets=()=>({top:0,bottom:0});',
  '@expo/vector-icons': `import React from 'react';export const Feather=({name,size})=><span data-icon={name} data-size={size} style={{width:size,height:size,display:'inline-block'}}>⋮</span>;`,
  './KeyboardAwareScrollViewCompat': "export {ScrollView as KeyboardAwareScrollViewCompat} from 'react-native';",
  '@/lib/session': 'export const useInboxPages=()=>({});export const useLive=()=>"live";export const deviceZone=()=>"UTC";',
  '@/components/item-editor': 'export const ItemEditor=()=>null;',
  './item-editor': 'export const ItemEditor=()=>null;',
  '@/components/recording': 'export const Recording=()=>null;',
};
const bundle = await build({
  absWorkingDir: root, stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import Dashboard from './app/(tabs)/index';
    import {Message} from './app/(tabs)/inbox';
    import {Sheet} from './components/ui';
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    const events=${JSON.stringify(events)};
    const message=e=><Message key={e.id} event={e} tz="UTC" job={['pending','processing','failed'].includes(e.id)?{status:e.id,eventId:e.id,error:'Understanding error'}:undefined}/>;
    const mode=new URLSearchParams(location.search).get('mode');
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}>
      {mode==='dashboard'?<Dashboard/>:mode==='sheet'?<Sheet visible title="Original message" onClose={()=>{}}>{message(events[0])}</Sheet>:<div style={{padding:22}}>{events.map(message)}</div>}
    </QueryClientProvider>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { 'react-native': 'react-native-web' },
  define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true', global: 'globalThis' },
  plugins: [{ name: 'device-chrome', setup(b) {
    b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: root }));
  } }],
});
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/organizer') return res.end(JSON.stringify({ items, jobs: [], messageCount: events.length }));
  if (req.url === '/api/settings') return res.end(JSON.stringify({ timezone: 'UTC' }));
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(bundle.outputFiles[0].text); }
  res.setHeader('content-type', 'text/html');
  res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script src="/app.js"></script>');
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
try {
  const errors = [];
  await mkdir('generated-artifacts/card-menus', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 900 }, hasTouch: true, isMobile: true });
  page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  const url = `http://127.0.0.1:${server.address().port}`;
  async function geometry(row, label) {
    const button = row.getByRole('button', { name: label, exact: true });
    const box = await button.boundingBox();
    const card = await row.locator(':scope > div').last().locator(':scope > div').boundingBox();
    assert.ok(box && card);
    assert.equal(box.width, 22);
    assert.equal(box.height, 22);
    const title = row.getByRole('button', { name: /^Edit / });
    if (await title.count()) {
      const titleBox = await title.boundingBox();
      assert.ok(Math.abs(box.y - titleBox.y) <= 1, 'menu aligns with task title');
    } else assert.ok(Math.abs(box.y - card.y - 14) <= 1, 'menu stays at the card top');
    assert.ok(Math.abs(card.x + card.width - box.x - box.width - 14) <= 1, 'shared right inset');
    assert.equal(await button.locator('[data-icon]').getAttribute('data-icon'), 'more-vertical');
    assert.equal(await button.locator('[data-icon]').getAttribute('data-size'), '18');
    assert.equal(await button.evaluate(n => getComputedStyle(n).paddingLeft), '0px');
    return box;
  }
  async function noOverlap(a, b) {
    const x = await a.boundingBox(), y = await b.boundingBox();
    assert.ok(x.x + x.width <= y.x + 1 || x.y + x.height <= y.y + 1 || y.y + y.height <= x.y + 1);
  }
  for (const width of [320, 375, 402]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url + '?mode=dashboard');
    await page.getByTestId('swipe-task-short').waitFor();
    for (const item of items) {
      const row = page.getByTestId('swipe-task-' + item.id);
      await geometry(row, 'Actions for ' + item.title);
      await noOverlap(row.getByRole('button', { name: 'Edit ' + item.title, exact: true }), row.getByRole('button', { name: 'Actions for ' + item.title, exact: true }));
    }
    if (width === 375) await page.screenshot({ path: 'generated-artifacts/card-menus/dashboard.png' });
    await page.getByRole('button', { name: 'Actions for ' + longTitle, exact: true }).click();
    await page.getByRole('button', { name: 'Repin task', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Original message', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.goto(url);
    await page.getByTestId('swipe-task-message-normal').waitFor();
    for (const event of events) {
      const row = page.getByTestId('swipe-task-message-' + event.id);
      if (event.deletedAt) {
        assert.equal(await row.getByRole('button', { name: 'Message actions', exact: true }).count(), 0);
      } else {
        await geometry(row, 'Message actions');
        const menu = row.getByRole('button', { name: 'Message actions', exact: true });
        await noOverlap(row.getByText('Nov 20 · 2:30 PM', { exact: true }), menu);
        await noOverlap(row.getByText(({ pending: 'Queued', processing: 'Processing', failed: 'Understanding failed' })[event.id] ?? 'Message', { exact: true }), menu);
      }
    }
    if (width === 375) await page.screenshot({ path: 'generated-artifacts/card-menus/inbox.png', fullPage: true });
    const normal = page.getByTestId('swipe-task-message-normal');
    await normal.getByRole('button', { name: 'Message actions', exact: true }).click();
    for (const name of ['Delete note', 'Delete tasks', 'Delete all']) await page.getByRole('button', { name, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await normal.getByRole('button', { name: 'Payload +', exact: true }).click();
    await normal.getByText(/"original": true/).waitFor();
  }
  // A drag starting on the relocated button must not open its action sheet.
  const row = page.getByTestId('swipe-task-message-normal');
  await row.scrollIntoViewIfNeeded();
  const menu = await row.getByRole('button', { name: 'Message actions', exact: true }).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  for (const [type, dx] of [['touchStart', 0], ['touchMove', -20], ['touchMove', -50], ['touchEnd', -50]]) {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: menu.x + 22 + dx, y: menu.y + 22 }] });
  }
  await page.waitForTimeout(600);
  assert.equal(await page.getByRole('button', { name: 'Delete note', exact: true }).count(), 0);
  await row.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('button', { name: 'Delete note', exact: true }).waitFor();
  await page.goto(url + '?mode=sheet');
  await page.getByText('Original message', { exact: true }).waitFor();
  await page.waitForTimeout(400); // Native-web Modal slides in before measuring.
  await geometry(page.getByTestId('swipe-task-message-normal'), 'Message actions');
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('button', { name: 'Delete note', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: 22pt title-aligned menus, 320/375/402px layouts, pinned/deleted notices, all processing states, payload, guarded touch presses and original-message sheet');
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
