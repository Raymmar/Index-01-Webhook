// Real Dashboard, generated network hooks and cache; isolated HTTP fixtures, no auth bypass.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const fixture = id => ({id,title:`Task ${id}`,status:'open',pinnedAt:null,createdAt:'2026-01-01T00:00:00Z',dueAt:id==='b'?'2099-01-01T00:00:00Z':null,sourceEventId:'source',timezone:'UTC'});
let items=[fixture('a'),fixture('b')], calls=[], hold=false, fail=false, writeThenFail=false, release;
const bundle=await build({
  absWorkingDir:resolve('artifacts/index-mobile'),
  stdin:{resolveDir:resolve('artifacts/index-mobile'),loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import Dashboard from './app/(tabs)/index';
    const qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    window.refresh=()=>qc.invalidateQueries();
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={qc}><Dashboard/></QueryClientProvider>);
  `},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
  alias:{'react-native':'react-native-web'},
  define:{'process.env.NODE_ENV':'"development"',__DEV__:'true'},
  plugins:[{name:'isolated-shell',setup(b){
    const stub=(filter,name,contents)=>{b.onResolve({filter},()=>({path:name,namespace:'fixture'}));b.onLoad({filter:new RegExp('^'+name+'$'),namespace:'fixture'},()=>({loader:'tsx',resolveDir:resolve('artifacts/index-mobile'),contents}));};
    stub(/^expo-router$/,'router','export const router={navigate(){}};');
    stub(/^@expo\/vector-icons$/,'icons','import React from "react";export const Feather=()=>null;');
    stub(/(?:@\/lib\/session)$/,'session','export const useLive=()=>"live";export const deviceZone=()=>"UTC";');
    stub(/@\/hooks\/use-horizontal-swipe$/,'calendar','export const useHorizontalSwipe=()=>({panHandlers:{}});');
    stub(/@\/components\/item-editor$/,'editor','export const ItemEditor=()=>null;');
    stub(/^(?:@\/components\/ui|\.\/ui)$/,'ui',`
      import React from 'react';import {View,Text,Pressable} from 'react-native';
      export const c={card:'white',pin:'blue',pinForeground:'white',destructive:'red',destructiveForeground:'white'};
      export const s={row:{flexDirection:'row'},card:{},between:{flexDirection:'row'},muted:{},text:{},error:{}};
      export const Copy=({children,...props})=><Text {...props}>{children}</Text>;
      export const Page=({children})=><View style={{width:320}}>{children}</View>;
      export const Button=({label,onPress,disabled,testID})=><Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} testID={testID}><Text>{label}</Text></Pressable>;
      export const IconButton=({label,onPress,disabled})=><Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} style={{width:44,height:44}}><Text>·</Text></Pressable>;
      export const Sheet=({children})=><View>{children}</View>;
      export const Confirm=({onConfirm,onClose})=><View testID="confirmation"><Button label="Confirm delete" onPress={onConfirm}/><Button label="Cancel delete" onPress={onClose}/></View>;
      export const Empty=()=>null;export const Skeleton=()=>null;export const Failure=()=>null;
      export const errorMessage=e=>e.data?.error||e.message;
    `);
    stub(/^react-native-safe-area-context$/,'insets','export const useSafeAreaInsets=()=>({bottom:0});');
  }}],
});
const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/api/organizer')return res.end(JSON.stringify({items,jobs:[],messageCount:1}));
  if(req.url==='/api/settings')return res.end(JSON.stringify({timezone:'UTC'}));
  if(req.url==='/api/events')return res.end(JSON.stringify({items:[]}));
  const match=req.url.match(/^\/api\/items\/([^/]+)(\/pin|\/restore)?$/);
  if(match){
    const [,id,action]=match;
    calls.push({id,method:req.method,action});
    if(hold)await new Promise(r=>{release=r;});
    const item=items.find(i=>i.id===id);
    if(action==='/pin'){
      if(!fail || writeThenFail)item.pinnedAt=req.method==='POST'?new Date().toISOString():null;
      if(fail){res.statusCode=500;return res.end(JSON.stringify({error:'Pin request failed'}));}
      return res.end(JSON.stringify(item));
    }
    if(action==='/restore'){items.push(fixture(id));return res.end(JSON.stringify(fixture(id)));}
    items=items.filter(i=>i.id!==id);res.statusCode=204;return res.end();
  }
  res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');
  res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');
}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/repl/tools/bin/chromium',args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:402,height:1100},hasTouch:true,isMobile:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const row=id=>page.getByTestId('swipe-task-'+id);
  await row('a').waitFor();
  const cdp=await page.context().newCDPSession(page);
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  async function swipe(id,direction=1,fraction=.55){
    const box=await row(id).boundingBox(), x=direction>0?box.x+30:box.x+box.width-30,y=box.y+box.height/2;
    await touch('touchStart',x,y);
    for(const part of [.2,.6,1])await touch('touchMove',x+direction*box.width*fraction*part,y);
    await touch('touchEnd');await page.waitForTimeout(260);
  }
  const order=()=>page.locator('[data-testid^="swipe-task-"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.testid));
  const settle=()=>page.waitForFunction(()=>[...document.querySelectorAll('[data-testid^="swipe-content-"]')].every(n=>getComputedStyle(n).opacity==='1'));
  async function refresh(){await page.evaluate(()=>window.refresh());await settle();}
  assert.deepEqual(await order(),['swipe-task-b','swipe-task-a']);
  for(const expected of [true,false,true]){
    await swipe('a');await settle();
    assert.equal(!!items.find(i=>i.id==='a').pinnedAt,expected);
    await refresh();
    assert.equal(await row('a').getByText('Pinned',{exact:true}).count(),expected?1:0);
    assert.equal((await order())[0],expected?'swipe-task-a':'swipe-task-b');
  }
  // Menu "Repin" stays explicit and does not toggle off.
  await page.waitForTimeout(550);
  await page.getByRole('button',{name:'Actions for Task a',exact:true}).click();
  await page.getByRole('button',{name:'Repin task',exact:true}).click();await settle();
  assert.ok(items.find(i=>i.id==='a').pinnedAt);
  await page.getByRole('button',{name:'Actions for Task a',exact:true}).click();
  await page.getByRole('button',{name:'Unpin task',exact:true}).click();await settle();
  assert.equal(items.find(i=>i.id==='a').pinnedAt,null);
  await page.getByRole('button',{name:'Actions for Task a',exact:true}).click();
  await page.getByRole('button',{name:'Pin task',exact:true}).click();await settle();
  assert.ok(items.find(i=>i.id==='a').pinnedAt);
  await page.getByRole('button',{name:'Actions for Task a',exact:true}).click();
  await page.getByRole('button',{name:'Unpin task',exact:true}).click();await settle();
  // Accept a second right swipe while POST is pending: queue intended unpin, not repin.
  hold=true;const start=calls.length;
  await swipe('a');assert.equal(calls.length,start+1);
  assert.equal(await row('a').getByText('Pinned',{exact:true}).count(),0);
  await swipe('a');assert.equal(calls.length,start+1);
  hold=false;release();await settle();
  assert.deepEqual(calls.slice(start).map(c=>c.method),['POST','DELETE']);
  await refresh();assert.equal(items.find(i=>i.id==='a').pinnedAt,null);
  // Three accepted intents collapse to pinned, without a stale unconditional repin.
  hold=true;const three=calls.length;
  await swipe('a');await swipe('a');await swipe('a');
  hold=false;release();await settle();
  assert.equal(calls.length,three+1);assert.ok(items.find(i=>i.id==='a').pinnedAt);
  for(const ambiguous of [false,true]){
    fail=true;writeThenFail=ambiguous;
    const before=items.find(i=>i.id==='a').pinnedAt;
    await swipe('a');await settle();
    await page.getByRole('alert').getByText('Pin request failed').waitFor();
    assert.equal(!!items.find(i=>i.id==='a').pinnedAt,ambiguous?!before:!!before);
    assert.equal(await row('a').getByText('Pinned',{exact:true}).count(),items.find(i=>i.id==='a').pinnedAt?1:0);
    fail=false;writeThenFail=false;
  }
  // Failed operation discards pending intent, clears the lock, and permits a retry.
  hold=true;fail=true;
  await swipe('a');await swipe('a');
  const failedCalls=calls.length;hold=false;release();await settle();
  assert.equal(calls.length,failedCalls);
  fail=false;await swipe('a');await settle();await refresh();
  // Halfway must not open confirmation; above halfway does, with no early DELETE.
  const deletes=()=>calls.filter(c=>!c.action&&c.method==='DELETE').length;
  await swipe('a',-1,.5);assert.equal(await page.getByTestId('confirmation').count(),0);
  await swipe('a',-1);assert.equal(deletes(),0);
  await page.getByTestId('confirmation').waitFor();
  await page.getByRole('button',{name:'Cancel delete'}).click();
  assert.equal(await row('a').count(),1);
  await swipe('a',-1);
  await page.getByRole('button',{name:'Confirm delete'}).click();
  await row('a').waitFor({state:'detached'});
  assert.equal(await page.locator('[data-testid^="task-undo-message"],[data-testid^="undo-task-"]').count(),0);
  await refresh();assert.equal(await row('a').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: actual Dashboard touch toggle, explicit repin/unpin, delayed/coalesced pending intents, failures/reconciliation/retry, badge/order refetch persistence, strict-half confirmation and quiet deletion');
}finally{await browser.close();await new Promise(r=>server.close(r));}
