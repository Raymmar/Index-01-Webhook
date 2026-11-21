// Real web EventCard and native Message/Confirm, generated hooks and shared
// preference persistence. Native device chrome is replaced for browser execution.
// Run from workspace root: node artifacts/index-mobile/tests/scoped-deletion.mjs
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const bundles = {};
for (const platform of ['web', 'mobile']) {
  const root = resolve(platform === 'web' ? 'artifacts/ring-inbox' : 'artifacts/index-mobile');
  const require = createRequire(root + '/package.json');
  const modules = {
    'expo-router': 'export const router={};export const useLocalSearchParams=()=>({});',
    'react-native-safe-area-context': 'export const useSafeAreaInsets=()=>({top:0,bottom:0});',
    '@expo/vector-icons': 'export const Feather=()=>null;',
    './KeyboardAwareScrollViewCompat': "export {ScrollView as KeyboardAwareScrollViewCompat} from 'react-native';",
    '@/components/recording': 'export const Recording=()=>null;',
    '@/components/linked-tasks': 'export const LinkedTasks=()=>null;',
    '@/lib/session': 'export const useInboxPages=()=>({});export const useLive=()=>"";export const deviceZone=()=>"UTC";',
    './items': 'export const ActionItemRow=()=>null;',
  };
  const result = await build({
    absWorkingDir: root, stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider,useInfiniteQuery} from '@tanstack/react-query';
      import {useGetOrganizer,useListEvents,listEvents,getListEventsQueryKey} from '@workspace/api-client-react';
      import {${platform === 'web' ? 'EventCard' : 'Message'}} from '${platform === 'web' ? './src/pages/inbox' : './app/(tabs)/inbox'}';
      const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
      window.refresh=()=>client.invalidateQueries();
      function App(){
        const org=useGetOrganizer(), events=useListEvents();
        const notes=useInfiniteQuery({queryKey:[...getListEventsQueryKey({view:'notes'}),'infinite'],initialPageParam:null,queryFn:()=>listEvents({view:'notes'}),getNextPageParam:()=>undefined});
        return <><div data-testid="counts">{org.data?.items.length}:{events.data?.items.length}:{notes.data?.pages[0].items.length}</div>
          {events.data?.items.map(e=>${platform === 'web'
            ? '<EventCard key={e.id} e={e} items={org.data?.items.filter(i=>i.sourceEventId===e.id)??[]} highlight={false} embedded={false} localPending={false}/>'
            : '<Message key={e.id} event={e} tz="UTC"/>'})}</>;
      }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);
    `},
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': platform === 'web' ? root + '/src' : root, 'react-native': 'react-native-web',
      react: resolve(require.resolve('react/package.json'),'..'),
      'react-dom': resolve(require.resolve('react-dom/package.json'),'..'),
      '@tanstack/react-query': resolve(require.resolve('@tanstack/react-query/package.json'),'..') },
    define: { 'process.env.NODE_ENV': '"test"', __DEV__: 'true' },
    plugins: [{ name: 'device-chrome', setup(b) {
      b.onResolve({filter:/.*/}, args => Object.hasOwn(modules,args.path) ? {path:args.path,namespace:'fixture'} : undefined);
      b.onLoad({filter:/.*/,namespace:'fixture'}, args => ({contents:modules[args.path],loader:'tsx',resolveDir:root}));
    }}],
  });
  bundles[platform] = result.outputFiles[0].text;
}
let events, tasks, preferences, deletions, saves, failSave, failDelete, settingsMissing, delaySettings;
function reset(count = 3, message = false, task = false) {
  events = [{id:'source',kind:'json',transcription:'Original note',webhookName:'Fixture',receivedAt:'2026-11-16T12:00:00Z',payload:{}}];
  tasks = Array.from({length:count},(_,i)=>({id:'task'+i,sourceEventId:'source',status:['open','completed','dismissed'][i],title:'Task',timezone:'UTC',pinnedAt:i===2?'2026-11-16T12:00:00Z':null}));
  preferences={skipMessageDeleteConfirmation:message,skipTaskDeleteConfirmation:task,skipTaskDismissConfirmation:false};
  deletions=[];saves=[];failSave=false;failDelete=false;settingsMissing=false;delaySettings=false;
}
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://test');
  res.setHeader('content-type','application/json');
  if(url.pathname==='/api/settings'){
    while(delaySettings) await new Promise(r=>setTimeout(r,10));
    if(req.method==='PATCH'){
      let body='';for await(const p of req)body+=p;
      saves.push(JSON.parse(body));
      if(failSave){res.statusCode=500;res.end('{"error":"Save failed"}');return;}
      Object.assign(preferences,JSON.parse(body));
    }
    res.end(JSON.stringify(settingsMissing?{}:preferences));return;
  }
  if(url.pathname==='/api/organizer'){res.end(JSON.stringify({items:tasks,jobs:[],messageCount:events.length}));return;}
  if(url.pathname==='/api/events'){
    res.end(JSON.stringify({items:url.searchParams.get('view')==='notes'?events.filter(e=>!tasks.some(t=>t.sourceEventId===e.id)):events,nextCursor:null}));return;
  }
  if(url.pathname==='/api/events/source/deletion'){
    let body='';for await(const p of req)body+=p;
    const {scope}=JSON.parse(body);deletions.push(scope);
    if(failDelete){res.statusCode=500;res.end('{"error":"Deletion failed"}');return;}
    if(scope!=='tasks') events=[];
    if(scope!=='note') tasks=[];
    res.statusCode=204;res.end();return;
  }
  if(url.pathname.endsWith('.js')){res.setHeader('content-type','text/javascript');res.end(bundles[url.pathname.slice(1,-3)]);return;}
  res.setHeader('content-type','text/html');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/'+url.pathname.slice(1)+'.js"></script>');
}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:'/repl/tools/bin/chromium',args:['--no-sandbox']});
const errors=[];
async function open(platform) {
  const page=await browser.newPage({viewport:{width:platform==='mobile'?375:1000,height:850},hasTouch:platform==='mobile',isMobile:platform==='mobile'});
  page.on('pageerror',e=>{errors.push(e.message);console.error(platform,e.message);});
  await page.goto('http://127.0.0.1:'+server.address().port+'/'+platform);
  await page.getByRole('button',{name:'Message actions',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-testid="counts"]').textContent.split(':').every(x=>x!==''));
  return page;
}
async function menu(page,platform,scope){
  await page.getByRole('button',{name:'Message actions',exact:true}).click();
  await page.getByRole(platform==='web'?'menuitem':'button',{name:'Delete '+scope,exact:true}).click();
}
const confirmButton=(page,scope)=>page.getByRole('button',{name:'Delete '+scope,exact:true});
async function settled(page,text){
  await page.waitForFunction(text=>document.querySelector('[data-testid="counts"]').textContent===text,text);
  if(new URL(page.url()).pathname==='/mobile') {
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).count(),0);
    assert.equal(await page.getByText(/Deleted “|Undo available|Restoring…/).count(),0);
  }
}
try{
  for(const platform of ['web','mobile']){
    reset(0);
    let page=await open(platform);
    await page.getByRole('button',{name:'Message actions',exact:true}).click();
    for(const scope of ['tasks','all']){
      const action=page.getByRole(platform==='web'?'menuitem':'button',{name:'Delete '+scope,exact:true});
      assert.equal(platform==='web'?await action.getAttribute('aria-disabled'):await action.isDisabled(),platform==='web'?'true':true);
    }
    await page.close();
    for(const message of [false,true]) for(const task of [false,true]){
      reset(3,message,task);page=await open(platform);
      await menu(page,platform,'all');
      if(!(message&&task)){
        await confirmButton(page,'all').waitFor();
        assert.equal(deletions.length,0);
        await page.getByRole('button',{name:'Cancel',exact:true}).click();
        assert.equal(deletions.length,0);
        await menu(page,platform,'all');
        await confirmButton(page,'all').click();
      }
      await settled(page,'0:0:0');
      assert.deepEqual(deletions,['all']);assert.deepEqual(saves,[]);
      await page.close();
    }
    for(const scope of ['note','tasks']){
      reset();page=await open(platform);await menu(page,platform,scope);
      await confirmButton(page,scope).click();
      await settled(page,scope==='note'?'3:0:0':'0:1:1');
      assert.deepEqual(deletions,[scope]);await page.close();
    }
    reset();settingsMissing=true;page=await open(platform);
    await menu(page,platform,'all');await confirmButton(page,'all').waitFor();assert.equal(deletions.length,0);
    await page.close();
    reset(3,true,true);delaySettings=true;page=await open(platform);
    await menu(page,platform,'all');await confirmButton(page,'all').waitFor();assert.equal(deletions.length,0);
    delaySettings=false;await page.close();
    reset();failSave=true;page=await open(platform);
    await menu(page,platform,'all');await page.getByRole('checkbox').click();await confirmButton(page,'all').click();
    await page.getByText(platform==='web'?/Could not save your choice/:/Save failed/).waitFor();
    assert.equal(deletions.length,0);assert.deepEqual(preferences,{skipMessageDeleteConfirmation:false,skipTaskDeleteConfirmation:false,skipTaskDismissConfirmation:false});
    failSave=false;failDelete=true;
    await confirmButton(page,'all').click();
    await page.getByText(platform==='web'?'Could not delete. Try again.':'Deletion failed',{exact:true}).waitFor();
    assert.equal(events.length,1);assert.equal(tasks.length,3);
    failDelete=false;await confirmButton(page,'all').click();await settled(page,'0:0:0');
    assert.ok(saves.every(s=>s.skipMessageDeleteConfirmation&&s.skipTaskDeleteConfirmation&&!('skipTaskDismissConfirmation' in s)));
    await page.close();
    console.log('PASS '+platform+': zero-task disablement, all four consent combinations, cancel, all scopes, missing settings, failed saves/deletes, counts and Notes refresh');
  }
  // Swipe deletion of an original uses only the message preference, not task consent.
  for(const skip of [false,true]){
    reset(3,skip,!skip);
    const page=await open('mobile');
    const box=await page.getByTestId('swipe-task-message-source').boundingBox();
    const x=box.x+box.width-24,y=box.y+45;
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(const part of [.2,.6,1])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-box.width*.6*part,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    if(!skip){
      await confirmButton(page,'note').waitFor();assert.deepEqual(deletions,[]);
      await confirmButton(page,'note').click();
    }
    await settled(page,'3:0:0');assert.deepEqual(deletions,['note']);assert.deepEqual(saves,[]);
    await page.close();
  }
  // Skipped confirmation failures must still surface a visible retry, for every scope.
  for(const scope of ['note','tasks','all']){
    reset(3,true,true);failDelete=true;
    const page=await open('mobile');
    await menu(page,'mobile',scope);
    await page.getByRole('dialog').getByRole('alert').getByText('Deletion failed',{exact:true}).waitFor();
    assert.deepEqual(deletions,[scope]);assert.equal(events.length,1);assert.equal(tasks.length,3);
    failDelete=false;
    await confirmButton(page,scope).click();
    await settled(page,scope==='note'?'3:0:0':scope==='tasks'?'0:1:1':'0:0:0');
    assert.deepEqual(deletions,[scope,scope]);assert.deepEqual(saves,[]);
    await page.close();
  }
  // A choice saved by one platform is consumed by a fresh client on the other.
  for(const [from,to] of [['web','mobile'],['mobile','web']]){
    reset();let page=await open(from);await menu(page,from,'all');await page.getByRole('checkbox').click();await confirmButton(page,'all').click();await settled(page,'0:0:0');await page.close();
    const saved={...preferences};reset();preferences=saved;page=await open(to);
    await menu(page,to,'all');await settled(page,'0:0:0');assert.deepEqual(saves,[]);await page.close();
  }
  // Simulate the shared SSE invalidation in already-connected clients.
  reset();
  const web=await open('web'),mobile=await open('mobile');
  await menu(web,'web','tasks');await confirmButton(web,'tasks').click();await settled(web,'0:1:1');
  await mobile.evaluate(()=>window.refresh());await settled(mobile,'0:1:1');
  await web.close();await mobile.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: remembered deletion consent in both cross-platform directions');
}finally{await browser.close();await new Promise(r=>server.close(r));}
