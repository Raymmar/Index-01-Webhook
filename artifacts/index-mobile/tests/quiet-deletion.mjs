// Real mobile screens, Confirm, deletion hooks and query cache, rendered in Chromium.
// Only native chrome/session/editor are stubbed; HTTP fixtures never touch user data.
// This is browser verification, not native-device validation.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = resolve('artifacts/index-mobile');
const title = id => `Task ${id}: A long mobile title that wraps across several lines while leaving task actions reachable`;
const task = id => ({ id, title: title(id), status: 'open', sourceEventId: 'source', timezone: 'UTC', createdAt: '2026-01-01T00:00:00Z' });
let items, preferences, failDelete, calls, saves, mode;
function reset(skip, screen) {
  items = Array.from({length: 9}, (_, i) => task(String(i)));
  preferences = {skipTaskDeleteConfirmation: skip, skipTaskDismissConfirmation: !skip, skipMessageDeleteConfirmation: !skip};
  failDelete = false; calls = []; saves = []; mode = screen;
}
const bundle = await build({
  absWorkingDir: root, stdin: {resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {View,Text} from 'react-native';
    import Dashboard from './app/(tabs)/index';
    import {LinkedTasks} from './components/linked-tasks';
    const qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    window.deletionFixture={refresh:()=>qc.invalidateQueries()};
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={qc}>
      {location.pathname==='/dashboard'?<Dashboard/>:<View style={{padding:22,paddingTop:70}}><LinkedTasks eventId="source" tz="UTC"/></View>}
      <button data-testid="navigation" onClick={()=>document.querySelector('[data-testid="navigation"]').textContent='Navigation works'}>Navigate</button>
    </QueryClientProvider>);
  `}, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: {'react-native': 'react-native-web'},
  define: {'process.env.NODE_ENV': '"test"', __DEV__: 'true'},
  plugins: [{name: 'native-chrome', setup(b) {
    const modules = {
      'expo-router': 'export const router={navigate(){}};',
      'react-native-safe-area-context': 'export const useSafeAreaInsets=()=>({top:0,bottom:0});',
      '@expo/vector-icons': 'export const Feather=()=>null;',
      '@/lib/session': 'export const useLive=()=>"live";export const deviceZone=()=>"UTC";',
      './KeyboardAwareScrollViewCompat': "export {ScrollView as KeyboardAwareScrollViewCompat} from 'react-native';",
      '@/components/item-editor': 'export const ItemEditor=()=>null;',
      './item-editor': 'export const ItemEditor=()=>null;',
    };
    b.onResolve({filter:/.*/}, args => Object.hasOwn(modules,args.path)?{path:args.path,namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'}, args => ({contents:modules[args.path],loader:'tsx',resolveDir:root}));
  }}],
});
const server = createServer(async (req,res) => {
  res.setHeader('content-type','application/json');
  if(req.url==='/api/settings') {
    if(req.method==='PATCH') {
      let body=''; for await(const part of req) body+=part;
      saves.push(JSON.parse(body)); Object.assign(preferences,JSON.parse(body));
    }
    return res.end(JSON.stringify({timezone:'UTC',...preferences}));
  }
  if(req.url==='/api/organizer') return res.end(JSON.stringify({items,jobs:[],messageCount:1}));
  if(req.url.startsWith('/api/events')) return res.end(JSON.stringify({items:[]}));
  if(req.url.startsWith('/api/items/')) {
    const id=req.url.split('/')[3]; calls.push({id,method:req.method});
    if(failDelete) {res.statusCode=500;return res.end('{"error":"Could not delete this task. Try again."}');}
    if(req.method==='DELETE') {items=items.filter(i=>i.id!==id);res.statusCode=204;return res.end();}
    let body=''; for await(const part of req)body+=part;
    items=items.map(i=>i.id===id?{...i,...JSON.parse(body)}:i);
    return res.end(JSON.stringify(items.find(i=>i.id===id)));
  }
  res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');
  return res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%}#root{display:flex;flex-direction:column}</style><div id="root"></div><script src="/app.js"></script>');
}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:'/repl/tools/bin/chromium',args:['--no-sandbox']});
const errors=[];
const deletes=()=>calls.filter(c=>c.method==='DELETE').length;
async function quiet(page) {
  assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).count(),0);
  assert.equal(await page.getByText(/Deleted “|Undo available|Restoring…/).count(),0);
  assert.equal(await page.locator('[data-testid^="task-undo-message"],[data-testid^="undo-"]').count(),0);
  assert.equal(await page.getByRole('dialog').count(),0);
}
async function request(page,id) {
  await page.getByRole('button',{name:`Actions for ${title(id)}`,exact:true}).click();
  await page.getByRole('button',{name:'Delete task',exact:true}).click();
}
try {
  for(const screen of ['dashboard','linked']) for(const skip of [false,true]) {
    reset(skip,screen);
    const page=await browser.newPage({viewport:{width:375,height:720},hasTouch:true,isMobile:true});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${screen}`);
    const row=id=>page.getByTestId(`${screen==='dashboard'?'swipe-task':'linked-task'}-${id}`);
    await row('0').waitFor();
    if(screen==='dashboard') {
      await row('0').scrollIntoViewIfNeeded();
      const box=await row('0').boundingBox(), x=box.x+box.width-24, y=box.y+box.height/2;
      const cdp=await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(const part of [.2,.6,1]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-box.width*.6*part,y}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } else await request(page,'0');
    if(!skip) {
      await page.getByRole('button',{name:'Cancel',exact:true}).waitFor(); assert.equal(deletes(),0);
      assert.equal(await page.getByText(/Undo is available/).count(),0);
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      // Swipe rows intentionally suppress accidental follow-up taps for 500ms.
      if(screen==='dashboard') await page.waitForTimeout(550);
      await request(page,'0'); await page.getByRole('button',{name:'Delete task',exact:true}).click();
    }
    await row('0').waitFor({state:'detached'}); await quiet(page); assert.equal(deletes(),1);
    // Failure opens the existing actionable dialog even when confirmations are skipped.
    failDelete=true;await request(page,'1');
    if(!skip) await page.getByRole('button',{name:'Delete task',exact:true}).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.ok(items.some(i=>i.id==='1'));assert.equal(deletes(),2);
    failDelete=false;await page.getByRole('button',{name:'Delete task',exact:true}).click();
    await row('1').waitFor({state:'detached'}); await quiet(page);
    // Account-backed opt-out is saved only for task deletion, not dismissal/message deletion.
    await request(page,'2');
    if(!skip) {
      await page.getByRole('checkbox').click();
      await page.getByRole('button',{name:'Delete task',exact:true}).click();
      assert.deepEqual(saves,[{skipTaskDeleteConfirmation:true}]);
    }
    await row('2').waitFor({state:'detached'}); await quiet(page);
    for(const id of ['3','4','5']) {
      await request(page,id);await row(id).waitFor({state:'detached'});await quiet(page);
    }
    await page.evaluate(()=>window.deletionFixture.refresh());
    assert.equal(await row('0').count(),0);
    assert.equal(await page.getByRole('button',{name:`Actions for ${title('6')}`,exact:true}).isEnabled(),true);
    // Remaining rows can still be reached by scrolling, and navigation remains clickable.
    await row('8').scrollIntoViewIfNeeded();await row('8').getByRole('button',{name:`Actions for ${title('8')}`,exact:true}).click();
    await page.getByRole('button',{name:'Dismiss task',exact:true}).click();
    if(skip) {
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      assert.equal(calls.filter(c=>c.method==='PATCH').length,0);
    } else {
      await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
      assert.equal(calls.filter(c=>c.method==='PATCH').length,1);
      assert.equal(items.find(i=>i.id==='8').status,'dismissed');
    }
    await page.getByTestId('navigation').click();await page.getByText('Navigation works',{exact:true}).waitFor();
    if(screen==='dashboard'&&skip) {
      await mkdir('generated-artifacts/quiet-deletion',{recursive:true});
      await page.screenshot({path:'generated-artifacts/quiet-deletion/dashboard-375px.png'});
    }
    await page.close();
    console.log(`PASS ${screen}, confirmations ${skip?'skipped':'enabled'}: quiet consecutive deletes, long titles, failure/retry, account preference independence, scroll and navigation`);
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();await new Promise(r=>server.close(r));}
