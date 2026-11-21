// Real linked-task component and API hooks; native sheet/editor chrome is stubbed.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('artifacts/index-mobile');
const base = { kind: 'task', status: 'open', dueAt: null, createdAt: '2026-11-16T12:00:00Z', sourceEventId: 'note', timezone: 'UTC' };
let items = [{ ...base, id: 'one', title: 'First task' }, { ...base, id: 'two', title: 'Second task', dueAt: '2026-11-17T12:00:00Z' }, { ...base, id: 'other', title: 'Unrelated', sourceEventId: 'other-note' }];
let removed;
const bundle = await build({
  absWorkingDir: root, stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {LinkedTasks} from './components/linked-tasks';
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    window.refresh=()=>client.invalidateQueries();
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><LinkedTasks eventId="note" tz="UTC"/></QueryClientProvider>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { 'react-native': 'react-native-web' },
  define: { 'process.env.NODE_ENV': '"test"', __DEV__: 'true' },
  plugins: [{ name: 'native-chrome', setup(b) {
    b.onResolve({ filter: /^\.\/item-editor$/ }, () => ({ path: 'editor', namespace: 'fixture' }));
    b.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: 'ui', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'tsx', resolveDir: root, contents: path === 'editor'
      ? `import React from 'react';export const ItemEditor=({item,onClose})=><button onClick={onClose}>Editing {item.title}</button>;`
      : `import React from 'react';
        export const c={};export const s={};export const errorMessage=e=>e.message;
        export const Copy=({children})=><span>{children}</span>;
        export const IconButton=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
        export const Button=({label,onPress,disabled,testID})=><button data-testid={testID} disabled={disabled} onClick={onPress}>{label}</button>;
        export const Sheet=({children})=><section>{children}</section>;
        export const Confirm=({title,onConfirm,onClose})=><section role="dialog"><button onClick={onConfirm}>Confirm {title}</button><button onClick={onClose}>Cancel</button></section>;
      ` }));
  } }],
});
const server = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/settings') { res.end('{}'); return; }
  if (req.url === '/api/organizer') { res.end(JSON.stringify({ items, jobs: [], messageCount: 2 })); return; }
  if (req.url.startsWith('/api/items/')) {
    const id = req.url.split('/')[3];
    if (req.method === 'DELETE') { removed = items.find(i => i.id === id); items = items.filter(i => i.id !== id); res.writeHead(204); res.end(); return; }
    if (req.url.endsWith('/restore')) { items.push(removed); res.end(JSON.stringify(removed)); return; }
    let body = ''; for await (const part of req) body += part;
    items = items.map(i => i.id === id ? { ...i, ...JSON.parse(body) } : i);
    res.end(JSON.stringify(items.find(i => i.id === id))); return;
  }
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  res.setHeader('content-type', 'text/html');
  res.end('<div id="root"></div><script src="/app.js"></script>');
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByTestId('linked-task-one').waitFor();
  assert.equal(await page.getByTestId('linked-task-other').count(), 0);
  await page.getByTestId('edit-linked-task-one').click();
  await page.getByText('Editing First task').click();
  await page.getByRole('button', { name: 'Complete First task', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen First task', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Actions for Second task' }).click();
  await page.getByRole('button', { name: 'Dismiss task', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Dismiss task' }).click();
  await page.getByTestId('linked-task-two').getByText(/Dismissed/).waitFor();
  await page.getByRole('button', { name: 'Actions for Second task' }).click();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Delete task' }).click();
  await page.getByTestId('linked-task-two').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).count(), 0);
  assert.equal(await page.getByText(/^Deleted “/).count(), 0);
  // Same cache invalidation used by SSE: additions and removals update the list.
  items = [{ ...base, id: 'new', title: 'New server task' }];
  await page.evaluate(() => window.refresh());
  await page.getByTestId('linked-task-new').waitFor();
  assert.equal(await page.getByTestId('linked-task-one').count(), 0);
  items = [];
  await page.evaluate(() => window.refresh());
  await page.getByTestId('linked-tasks-note').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('PASS: source grouping, editor entry, completion, dismissal, quiet deletion, live cache refresh, empty notes');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
