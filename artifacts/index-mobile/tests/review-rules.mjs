// Actual rule pages (web + mobile) with shared hooks against an isolated fake API.
// Only account/device chrome and routing are stubbed; no app auth bypass.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('artifacts/index-mobile');
const shots = process.env.RULE_SHOTS;
import { realpathSync } from 'node:fs';
const WOUTER = realpathSync(resolve('artifacts/ring-inbox/node_modules/wouter'));
const stubs = {
  '@clerk/react': `import {useSyncExternalStore} from 'react'; export const useAuth=()=>({userId:useSyncExternalStore(cb=>{window.addEventListener('fixture-account',cb);return()=>window.removeEventListener('fixture-account',cb)},()=>window.__account)});`,
  '@clerk/expo': `export {useAuth} from '@clerk/react';`,
  'expo-router': `import {useSyncExternalStore} from 'react';
    const sub=cb=>{window.addEventListener('fixture-route',cb);return()=>window.removeEventListener('fixture-route',cb)};
    const go=(to,replace)=>{const r=typeof to==='string'?{pathname:to,params:{}}:{params:{},...to};window.__routes=replace?[...window.__routes.slice(0,-1),r]:[...window.__routes,r];window.dispatchEvent(new Event('fixture-route'));};
    export const useRoute=()=>useSyncExternalStore(sub,()=>window.__routes[window.__routes.length-1]);
    export const useLocalSearchParams=()=>useRoute().params;
    export const router={canGoBack:()=>window.__routes.length>1,back(){window.__routes=window.__routes.slice(0,-1);window.dispatchEvent(new Event('fixture-route'))},push:t=>go(t,false),replace:t=>go(t,true)};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:0,bottom:0});`,
  '@expo/vector-icons': `export const Feather=()=> <span/>;`,
  './KeyboardAwareScrollViewCompat': `export {ScrollView as KeyboardAwareScrollViewCompat} from 'react-native';`,
};
const bundle = await build({
  absWorkingDir: root, stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {Router,Switch,Route} from '${WOUTER}/src/index.js'; import {memoryLocation} from '${WOUTER}/src/memory-location.js';
    import {useRoute} from 'expo-router';
    import MList from './app/settings-prompts'; import MRule from './app/settings-rule'; import MExtraction from './app/settings-extraction';
    import WList from '../ring-inbox/src/pages/settings-prompts'; import WRule from '../ring-inbox/src/pages/settings-rule'; import WExtraction from '../ring-inbox/src/pages/settings-extraction';
    window.__account='owner'; window.__routes=[{pathname:'/settings-prompts',params:{}}];
    const realFetch=window.fetch;
    window.fetch=(input,init={})=>realFetch(input,{...init,headers:{...init.headers,'x-fixture-account':window.__account}});
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    // Mirrors the shared SSE refresh for the /api/rules prefix.
    window.__refreshRules=()=>client.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/rules')});
    window.__switch=a=>{client.clear();window.__account=a;window.dispatchEvent(new Event('fixture-account'));};
    window.__keys=()=>client.getQueryCache().getAll().map(q=>q.queryKey);
    const mem=memoryLocation({path:'/settings/prompts'}); window.__webPath=()=>mem.history?mem.history.at(-1):location.pathname;
    window.__webNav=mem.navigate;
    function Web(){return <Router hook={mem.hook}><Switch>
      <Route path="/settings/prompts/extraction" component={WExtraction}/><Route path="/settings/prompts/new" component={WRule}/>
      <Route path="/settings/prompts/:id" component={WRule}/><Route path="/settings/prompts" component={WList}/>
      <Route>{()=> <div data-testid="elsewhere">elsewhere</div>}</Route></Switch></Router>;}
    function Mobile(){const r=useRoute();window.__mobileRoute=r;
      if(r.pathname==='/settings-rule')return <MRule key={r.params.id??'new'}/>;
      if(r.pathname==='/settings-extraction')return <MExtraction/>;
      if(r.pathname==='/settings-prompts')return <MList/>;
      return <div data-testid="elsewhere">{r.pathname} {JSON.stringify(r.params)}</div>;}
    const Page=new URLSearchParams(location.search).get('mode')==='web'?Web:Mobile;
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Page/></QueryClientProvider>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { 'react-native': 'react-native-web', react: resolve(root,'node_modules/react'), 'react-dom':resolve(root,'node_modules/react-dom'), '@tanstack/react-query':resolve(root,'node_modules/@tanstack/react-query') },
  define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true', global: 'globalThis' },
  plugins: [{ name: 'chrome', setup(b) {
    b.onResolve({ filter: /.*/ }, a => Object.hasOwn(stubs, a.path) ? { path: a.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: root }));
  } }],
});

// ---- fake API ----
const db = new Map(); const runs = new Map(); let seq = 0; let delayOverview = 0;
const now = () => new Date('2025-03-04T10:00:00Z').toISOString();
const acct = a => { if (!db.has(a)) db.set(a, new Map()); return db.get(a); };
function reset() { db.clear(); runs.clear(); seq = 0; delayOverview = 0; }
const send = (res, code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(body === undefined ? '' : JSON.stringify(body)); };
const read = async req => { let t = ''; for await (const c of req) t += c; return t ? JSON.parse(t) : {}; };
const server = createServer(async (req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
  const a = req.headers['x-fixture-account']; const url = new URL(req.url, 'http://x'); const p = url.pathname.split('/').filter(Boolean);
  if (url.pathname === '/api/settings') return send(res, 200, { isOwner: true, allowed: true, allowSignups: false, timezone: 'UTC', aiProvider: 'replit', aiModel: 'm', directKeyConfigured: false, managedConfigured: true, availableModels: [] });
  if (url.pathname === '/api/prompts') { const i = { taskRules: 'T', dateRules: 'D', titleStyle: 'S', personalContext: '' }; return send(res, 200, { instructions: i, defaults: i, skill: 'skill' }); }
  if (p[0] !== 'api' || p[1] !== 'rules') { res.setHeader('content-type', 'text/html'); res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script src="/app.js"></script>'); return; }
  const rules = acct(a);
  if (p.length === 2) {
    if (req.method === 'GET') return send(res, 200, [...rules.values()]);
    const body = await read(req); const id = `r${++seq}`;
    const r = { ...body, id, revision: 1, createdAt: now(), updatedAt: now(), nextRunAt: null, overview: '', overviewUpdatedAt: null };
    rules.set(id, r); runs.set(id, []); return send(res, 201, r);
  }
  const r = rules.get(p[2]); if (!r) return send(res, 404, { error: 'Rule not found' });
  if (p.length === 3) {
    if (req.method === 'GET') return send(res, 200, r);
    if (req.method === 'DELETE') { if ([...rules.values()].some(x => x.inputRuleIds.includes(r.id))) return send(res, 409, { error: 'Used as input by another rule' }); rules.delete(r.id); return send(res, 204); }
    const body = await read(req);
    if (body.inputRuleIds.includes(r.id)) return send(res, 400, { error: 'Rule inputs would create a cycle' });
    Object.assign(r, body, { revision: r.revision + 1 }); return send(res, 200, r);
  }
  if (p[3] === 'overview') {
    const body = await read(req); if (delayOverview) await new Promise(x => setTimeout(x, delayOverview));
    if (body.revision !== r.revision) return send(res, 409, { error: 'Overview changed elsewhere' });
    Object.assign(r, { overview: body.text, overviewUpdatedAt: now(), revision: r.revision + 1 }); return send(res, 200, r);
  }
  if (p[3] === 'runs' && p.length === 4) {
    if (req.method === 'GET') return send(res, 200, runs.get(r.id));
    const run = { id: `run${++seq}`, ruleId: r.id, status: 'pending', createdAt: now(), completedAt: null, windowStart: now(), windowEnd: now(), report: null, error: null, sources: [], changedTaskIds: [], undoneAt: null, ruleRevision: r.revision };
    runs.get(r.id).unshift(run); return send(res, 202, run);
  }
  if (p[5] === 'undo') { const run = runs.get(r.id).find(x => x.id === p[4]); run.undoneAt = now(); return send(res, 200, run); }
  send(res, 404, { error: 'nope' });
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
const text = (page, t) => page.waitForFunction(t => document.body.innerText.includes(t), t, { timeout: 5000 });
const until = (fn, msg) => (async () => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 30)); } assert.fail(msg); })();

try {
  for (const mode of ['web', 'mobile']) {
    for (const width of mode === 'web' ? [1100, 375] : [375]) {
      reset();
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const browserConfirmations = [];
      page.on('dialog', d => { if (d.type() === 'confirm') browserConfirmations.push(d.message()); return d.accept(); });
      const web = mode === 'web';
      const id = t => page.getByTestId(t);
      const chip = label => page.getByTestId(`filter-${label}`);
      const setTrigger = async (value, label) => web ? id('select-trigger').selectOption(value) : chip(label).click();
      const setOutput = async (value, label) => web ? id(`output-${value}`).click() : chip(label).click();
      const setEnabled = async on => web ? id('toggle-rule-enabled').setChecked(on) : chip(on ? 'on' : 'off').first().click();
      await page.goto(`${base}/?mode=${mode}`);

      // List: permanent core entry, empty state, no sample rules created.
      await id('link-extraction').waitFor();
      await text(page, 'Cannot be disabled');
      await id('text-no-rules').waitFor();
      assert.equal(acct('owner').size, 0);
      await id('link-extraction').click();
      await id('input-taskRules').waitFor();
      if (web) {
        await id('input-taskRules').fill('Unsaved extraction instructions');
        await page.getByRole('button', { name: /Prompts/ }).first().click();
        const dialog = page.getByRole('alertdialog');
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await id('input-taskRules').inputValue(), 'Unsaved extraction instructions');
        await page.getByRole('button', { name: /Prompts/ }).first().click();
        await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
        await id('link-extraction').click();
        await id('input-taskRules').waitFor();
      }
      await page.getByRole('button', { name: /Back to prompts|Prompts/ }).first().click();
      await id('link-new-rule').waitFor();

      // Create with defaults: manual, disabled, report.
      await id('link-new-rule').click();
      await id('input-rule-name').waitFor();
      assert.ok(await id('button-save-rule').isDisabled(), 'create disabled until valid');
      if (web) { assert.equal(await id('select-trigger').inputValue(), 'manual'); assert.equal(await id('toggle-rule-enabled').isChecked(), false); assert.equal(await id('output-report').getAttribute('aria-pressed'), 'true'); }
      await id('input-rule-name').fill('Evening threads');
      await id('input-rule-prompt').fill('Connect what I said today into themes.');
      await setTrigger('quiet', 'After a quiet period');
      await id('input-quiet-minutes').fill('45');
      await text(page, 'at least two new messages');
      await setOutput('tasks', 'Tasks');
      await text(page, 'never deleted');
      await text(page, 'combining duplicates by dismissing');
      await id('input-quiet-minutes').fill('0');
      await text(page, 'Quiet minutes must be 1 to 1440');
      assert.ok(await id('button-save-rule').isDisabled());
      await id('input-quiet-minutes').fill('45');
      await id('button-save-rule').click();
      await id('text-no-runs').waitFor().catch(() => text(page, 'No runs yet.'));
      const [r1] = [...acct('owner').values()];
      assert.deepEqual([r1.enabled, r1.trigger, r1.quietMinutes, r1.output, r1.lookbackHours], [false, 'quiet', 45, 'tasks', 24]);

      // Edit: enable, hourly interval, save.
      await setEnabled(true);
      await setTrigger('hourly', 'Every few hours');
      await id('input-interval-hours').fill('6');
      await id('button-save-rule').click();
      await until(() => r1.enabled && r1.trigger === 'hourly' && r1.intervalHours === 6, 'edit saved');
      await setTrigger('daily', 'Daily');
      await id('input-daily-time').fill('07:30');
      await id('button-save-rule').click();
      await until(() => r1.trigger === 'daily' && r1.dailyTime === '07:30', 'daily saved');

      // Duplicate starts disabled and can take the original as an input.
      await id('button-duplicate-rule').click();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="input-rule-name"]')].some(e => e.value === 'Evening threads copy'));
      if (web) assert.equal(await id('toggle-rule-enabled').isChecked(), false);
      await id('input-rule-name').fill('Weekly overview');
      await setOutput('overview', 'Overview');
      if (web) await id(`toggle-input-${r1.id}`).click(); else await chip('on').nth(3).click();
      await id('button-save-rule').click();
      await until(() => acct('owner').size === 2, 'duplicate created');
      const r2 = [...acct('owner').values()][1];
      assert.deepEqual([r2.enabled, r2.output, r2.inputRuleIds, r2.trigger], [false, 'overview', [r1.id], 'daily']);
      await text(page, 'Overview');

      // History: reports, errors, sources, undo, run now.
      runs.get(r2.id).push(
        { id: 'runA', ruleId: r2.id, status: 'completed', createdAt: now(), completedAt: now(), windowStart: now(), windowEnd: now(), report: 'You keep returning to the garden plan.', error: null, sources: [{ kind: 'message', id: 'evt9', label: 'Garden voice note' }, { kind: 'review', id: r1.id, label: 'Evening threads' }, { kind: 'task', id: 't1', label: 'Buy seeds' }], changedTaskIds: ['t1', 't2'], undoneAt: null, ruleRevision: r2.revision },
        { id: 'runB', ruleId: r2.id, status: 'failed', createdAt: now(), completedAt: now(), windowStart: now(), windowEnd: now(), report: null, error: 'Model timed out', sources: [], changedTaskIds: [], undoneAt: null, ruleRevision: 0 });
      r2.overview = 'Garden first, taxes second.'; r2.revision++;
      await page.evaluate(() => window.__refreshRules());
      await text(page, 'You keep returning to the garden plan.');
      await text(page, 'Model timed out');
      await text(page, 'earlier version');
      await page.waitForFunction(() => document.querySelector('[data-testid="input-overview"]')?.value === 'Garden first, taxes second.');
      if (web) await page.getByText('3 sources').click();
      await text(page, 'Garden voice note');
      await id('button-undo-runA').click();
      await text(page, 'undone');
      assert.ok(runs.get(r2.id).find(x => x.id === 'runA').undoneAt);
      await id('button-run-now').click();
      await text(page, 'Queued');
      assert.equal(runs.get(r2.id)[0].status, 'pending');

      // Overview edit + save; conflict shows inline error and keeps the draft.
      await id('input-overview').fill('Garden first. Taxes on Friday.');
      await id('button-save-overview').click();
      await until(() => r2.overview === 'Garden first. Taxes on Friday.', 'overview saved');
      await id('input-overview').fill('My local overview');
      r2.overview = 'Remote rewrite'; r2.revision++;
      await page.evaluate(() => window.__refreshRules());
      await id('text-overview-stale').waitFor();
      assert.equal(await id('input-overview').inputValue(), 'My local overview');
      await id('button-save-overview').click();
      await text(page, 'Overview changed elsewhere');
      assert.equal(await id('input-overview').inputValue(), 'My local overview');
      assert.ok(await id('input-overview').evaluate(el => el.scrollHeight <= el.clientHeight + 1), 'overview has no inner scroll');

      // Late overview save across account switch must not leak or clear the draft.
      await page.getByRole('button', { name: /Revert overview|Revert/ }).last().click();
      await id('input-overview').fill('Late owner overview');
      delayOverview = 400;
      await id('button-save-overview').click();
      await page.evaluate(() => window.__switch('other'));
      await page.waitForTimeout(600);
      delayOverview = 0;
      assert.ok(!(await page.locator('body').innerText()).includes('Late owner overview'), 'owner overview must not render for other account');
      await page.evaluate(() => window.__switch('owner'));
      await id('input-overview').waitFor();

      // Dirty rule prompt survives SSE refresh and account switching; clean field adopts.
      await page.evaluate(() => window.__refreshRules());
      r2.prompt = 'Remote prompt'; r2.revision++;
      await page.evaluate(() => window.__refreshRules());
      await page.waitForFunction(() => document.querySelector('[data-testid="input-rule-prompt"]')?.value === 'Remote prompt');
      await id('input-rule-prompt').fill('Unsaved local prompt');
      r2.prompt = 'Newer remote prompt'; r2.revision++;
      await page.evaluate(() => window.__refreshRules());
      await page.waitForTimeout(150);
      assert.equal(await id('input-rule-prompt').inputValue(), 'Unsaved local prompt');
      await page.evaluate(() => window.__switch('other'));
      await text(page, web ? 'Could not load this rule' : 'Rule not found');
      await page.evaluate(() => window.__switch('owner'));
      await page.waitForFunction(() => document.querySelector('[data-testid="input-rule-prompt"]')?.value === 'Unsaved local prompt');
      assert.ok(await id('button-run-now').isDisabled(), 'run disabled while dirty');
      // Self-input cycle rejection from the server shows inline.
      if (web) await page.getByRole('button', { name: 'Revert', exact: true }).click(); else await page.getByText('Revert changes').click();
      if (shots) await page.screenshot({ path: `${shots}/rule-${mode}-${width}.png`, fullPage: true });

      // Delete: blocked while used as input, explains what is removed.
      await (web ? page.getByRole('link', { name: /Prompts/ }) : page.getByRole('button', { name: 'Back to prompts' })).first().click().catch(() => {});
      if (web) await page.evaluate(id => window.__webNav(`/settings/prompts/${id}`), r1.id);
      else await page.evaluate(id => { window.__routes = [{ pathname: '/settings-prompts', params: {} }, { pathname: '/settings-rule', params: { id } }]; window.dispatchEvent(new Event('fixture-route')); }, r1.id);
      await page.waitForFunction(() => document.querySelector('[data-testid="input-rule-name"]')?.value === 'Evening threads');
      await id('button-delete-rule').click();
      await text(page, 'Your messages and tasks are not touched');
      await text(page, 'This rule is an input to Weekly overview');
      if (web) await id('button-confirm-delete-rule').click(); else await page.getByRole('button', { name: 'Delete rule' }).last().click();
      await text(page, 'Used as input by another rule');
      assert.equal(acct('owner').size, 2);
      assert.deepEqual(errors, []);
      assert.deepEqual(browserConfirmations, [], 'in-app actions must not open browser confirmations');
      if (width === 375) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 376), mode + ' no horizontal overflow at 375');
      console.log(`PASS: ${mode}@${width} core entry, create defaults/validation, edit/triggers, duplicate disabled, rule inputs, history/report/error/sources/undo/run now, overview edit+conflict+late save, SSE/account draft retention, delete guard`);
      await page.close();
    }
  }
} finally { await browser.close(); await new Promise(r => server.close(r)); }
