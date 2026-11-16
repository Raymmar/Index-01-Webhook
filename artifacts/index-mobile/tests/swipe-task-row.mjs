// Actual RN Web row in a standalone test harness, never bypassing app authentication.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const bundle = await build({
  absWorkingDir: resolve('artifacts/index-mobile'),
  stdin: { resolveDir: resolve('artifacts/index-mobile'), loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ScrollView, Pressable, Text, View} from 'react-native';
    import {SwipeTaskRow} from './components/swipe-task-row';
    window.counts = {pin:0,delete:0,edit:0};
    function App() { const [disabled,setDisabled]=React.useState(false); window.setDisabled=setDisabled;
      const [allowPendingPin,setAllowPendingPin]=React.useState(false);window.setAllowPendingPin=setAllowPendingPin;
      const [pinEnabled,setPinEnabled]=React.useState(true);window.setPinEnabled=setPinEnabled;
      return <ScrollView style={{height:600}}>
      <SwipeTaskRow id="test" disabled={disabled} allowPendingPin={allowPendingPin} pinEnabled={pinEnabled} onPin={()=>window.counts.pin++} onDelete={()=>window.counts.delete++}>
        {guard=><><Pressable onPress={()=>guard(()=>window.counts.edit++)} style={{height:140,padding:30}}><Text>Test task</Text></Pressable><View onTouchStart={e=>e.stopPropagation()} style={{height:80}}><Text>Media control area</Text></View></>}
      </SwipeTaskRow><View style={{height:2000}}/></ScrollView>; }
    createRoot(document.getElementById('root')).render(<App/>);
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { 'react-native': 'react-native-web' },
  define: { 'process.env.NODE_ENV': '"test"', __DEV__: 'true' },
  plugins: [{ name: 'theme-only', setup(b) {
    b.onResolve({filter:/^\.\/ui$/}, () => ({path:'theme',namespace:'test'}));
    b.onLoad({filter:/.*/,namespace:'test'}, () => ({contents:'export const c={card:"white",secondary:"#eee",accent:"green",destructive:"red"};export const s={muted:{}};'}));
  }}],
});
const server = createServer((req,res) => {
  res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');
}).listen(0, '127.0.0.1');
await new Promise(r=>server.once('listening',r));
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',args:['--no-sandbox'],headless:true});
try {
  const page = await browser.newPage({viewport:{width:402,height:874},hasTouch:true,isMobile:true});
  page.on('pageerror', e=>console.log(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByText('Test task').waitFor();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type,x=180,y=70) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y}]});
  async function drag(points,cancel=false) {
    await touch('touchStart');
    for(const [x,y] of points) {await touch('touchMove',x,y);await page.waitForTimeout(25);}
    await touch(cancel?'touchCancel':'touchEnd');
    await page.waitForTimeout(50);
  }
  const counts = () => page.evaluate(()=>window.counts);
  await drag([[210,70],[250,70],[285,70]]);
  assert.deepEqual(await counts(),{pin:1,delete:0,edit:0});
  await drag([[150,70],[110,70],[75,70]]);
  assert.deepEqual(await counts(),{pin:1,delete:1,edit:0});
  await drag([[220,70],[285,70],[195,70]]);
  await drag([[220,70],[285,70]],true);
  assert.deepEqual(await counts(),{pin:1,delete:1,edit:0});
  await page.waitForTimeout(550);
  await page.getByText('Test task').tap();
  assert.equal((await counts()).edit,1);
  await page.evaluate(()=>window.setDisabled(true));
  await drag([[210,70],[250,70],[285,70]]);
  assert.deepEqual(await counts(),{pin:1,delete:1,edit:1});
  await page.evaluate(()=>window.setAllowPendingPin(true));
  for (let i=0;i<5;i++) {
    await drag([[210,70],[250,70],[285,70]]);
    assert.equal((await counts()).pin,2+i);
  }
  await drag([[150,70],[110,70],[75,70]]);
  assert.equal((await counts()).delete,1);
  await page.evaluate(()=>{window.setAllowPendingPin(false);window.setDisabled(false);window.setPinEnabled(false);});
  await drag([[210,70],[250,70],[285,70]]);
  assert.equal((await counts()).pin,6);
  await drag([[150,70],[110,70],[75,70]]);
  assert.equal((await counts()).delete,2);
  await touch('touchStart',180,180);
  for (const x of [150,110,75]) { await touch('touchMove',x,180); await page.waitForTimeout(25); }
  await touch('touchEnd');
  assert.equal((await counts()).delete,2);
  await page.evaluate(()=>window.setDisabled(false));
  await drag([[180,50],[180,25],[180,5]]);
  assert.deepEqual(await counts(),{pin:6,delete:2,edit:1});
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('*')].some(e=>e.scrollTop>0)));
  console.log('PASS: browser touch pin/delete, canceled/reversed drags, vertical drag, ordinary edit tap, no swipe-triggered edit');
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
