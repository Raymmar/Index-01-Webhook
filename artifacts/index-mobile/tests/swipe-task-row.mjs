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
       const [width,setWidth]=React.useState(320);window.setWidth=setWidth;
       const [pinned,setPinned]=React.useState(false);window.setPinned=setPinned;
      return <ScrollView style={{height:600}}>
       <View style={{width}}><SwipeTaskRow id="test" pinned={pinned} disabled={disabled} allowPendingPin={allowPendingPin} pinEnabled={pinEnabled} onPin={()=>window.counts.pin++} onDelete={()=>window.counts.delete++}>
        {guard=><><Pressable onPress={()=>guard(()=>window.counts.edit++)} style={{height:140,padding:30}}><Text>Test task</Text></Pressable><View onTouchStart={e=>e.stopPropagation()} style={{height:80}}><Text>Media control area</Text></View></>}
       </SwipeTaskRow></View><View style={{height:2000}}/></ScrollView>; }
    createRoot(document.getElementById('root')).render(<App/>);
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { 'react-native': 'react-native-web' },
   // RN Web replaces Animated with an instant mock in "test" mode.
   define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true' },
  plugins: [{ name: 'theme-only', setup(b) {
    b.onResolve({filter:/^@expo\/vector-icons$/}, () => ({path:'icons',namespace:'icons'}));
    b.onLoad({filter:/.*/,namespace:'icons'}, () => ({loader:'tsx',resolveDir:resolve('artifacts/index-mobile'),contents:'import React from "react";export const Feather=({name})=><span data-icon={name}/>;'}));
    b.onResolve({filter:/^\.\/ui$/}, () => ({path:'theme',namespace:'test'}));
    b.onLoad({filter:/.*/,namespace:'test'}, () => ({contents:'export const c={card:"white",pin:"blue",pinForeground:"white",destructive:"red",destructiveForeground:"white"};export const s={muted:{}};'}));
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
   const touch = (type,x=200,y=70) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y}]});
  async function drag(points,cancel=false) {
    await touch('touchStart');
    for(const [x,y] of points) {await touch('touchMove',x,y);await page.waitForTimeout(25);}
    await touch(cancel?'touchCancel':'touchEnd');
     await page.waitForTimeout(260);
  }
  const counts = () => page.evaluate(()=>window.counts);
   for (const [x, label, color, icon] of [[260,'Pin','rgb(0, 0, 255)','map-pin'],[140,'Delete','rgb(255, 0, 0)','trash-2']]) {
    await touch('touchStart'); await touch('touchMove',x,70);
    await page.waitForTimeout(40);
    const action=page.getByTestId('swipe-action-test');
    assert.equal((await action.textContent()).trim(),label);
    assert.equal(await action.evaluate(node=>getComputedStyle(node).backgroundColor),color);
    assert.equal(await action.locator(`[data-icon="${icon}"]`).count(),1);
    await touch('touchCancel'); await page.waitForTimeout(350);
    assert.ok(Number(await action.evaluate(node=>getComputedStyle(node).opacity))<0.02);
  }
  assert.deepEqual(await counts(),{pin:0,delete:0,edit:0});
   // Resize the actual same row; card height remains 220 throughout.
   let accepted=0;
   for (const width of [240,320,360]) {
     await page.evaluate(w=>window.setWidth(w),width);
     await page.waitForTimeout(80);
     assert.equal((await page.getByTestId('swipe-task-test').boundingBox()).width,width);
     for (const direction of [1,-1]) {
       for (const delta of [-2,0,2]) {
         const before=await counts();
         await drag([[200+direction*30,70],[200+direction*(width/2+delta),70]]);
         const after=await counts();
         assert.equal(after[direction===1?'pin':'delete']-before[direction===1?'pin':'delete'],delta>0?1:0,`${width} ${direction} ${delta}`);
       }
     }
     accepted++;
   }
   assert.deepEqual(await counts(),{pin:accepted,delete:accepted,edit:0});
   // Natural tracking, no early resistance; action waits for return to finish.
   await touch('touchStart'); await touch('touchMove',385,70);
   const offset=()=>page.getByTestId('swipe-content-test').evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).m41);
   assert.ok(Math.abs(await offset()-185)<1);
   assert.equal((await counts()).pin,accepted);
   // CDP may wait for the synthetic tap delay on touchEnd; sample inside the page.
   await page.evaluate(()=>{
     window.frames=[];
     document.addEventListener('touchend',()=>{
       const start=performance.now();
       function sample(){
         const x=new DOMMatrix(getComputedStyle(document.querySelector('[data-testid="swipe-content-test"]')).transform).m41;
         window.frames.push({x,pin:window.counts.pin});
         if(performance.now()-start<260)requestAnimationFrame(sample);
       }
       requestAnimationFrame(sample);
     },{once:true,capture:true});
   });
   await touch('touchEnd');await page.waitForTimeout(280);
   const frames=await page.evaluate(()=>window.frames);
   assert.ok(frames.some(f=>f.x>1 && f.x<184),JSON.stringify(frames));
   assert.ok(frames.every(f=>f.x>=0 && f.x<=185));
   assert.ok(frames.filter(f=>f.x>0.1).every(f=>f.pin===accepted));
   accepted++;
   assert.ok(Math.abs(await offset())<0.1);
   await drag([[240,70],[385,70],[210,70]]);
   await drag([[240,70],[385,70]],true);
   await drag([[160,70],[15,70],[190,70]]);
   await drag([[160,70],[15,70]],true);
   // Width changes during a gesture are applied at release, not cached at mount.
   await page.evaluate(()=>window.setWidth(240));await page.waitForTimeout(80);
   await touch('touchStart');await touch('touchMove',345,70);
   await page.evaluate(()=>window.setWidth(360));await page.waitForTimeout(80);
   await touch('touchEnd');await page.waitForTimeout(260);
   const baseline=await counts();
   assert.deepEqual(baseline,{pin:accepted,delete:3,edit:0});
   // Short fast flick cannot use velocity to bypass distance.
   await touch('touchStart');await touch('touchMove',280,70);await touch('touchEnd');
   await page.waitForTimeout(260);
   assert.deepEqual(await counts(),baseline);
   await page.evaluate(()=>window.setPinned(true));
   await touch('touchStart');await touch('touchMove',260,70);
   assert.equal((await page.getByTestId('swipe-action-test').textContent()).trim(),'Unpin');
   await touch('touchCancel');await page.waitForTimeout(260);
   // Adding another finger cancels rather than committing the previous distance.
   await touch('touchStart');await touch('touchMove',385,70);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:385,y:70,id:0},{x:250,y:90,id:1}]});
   await touch('touchEnd');await page.waitForTimeout(260);
   assert.deepEqual(await counts(),baseline);
  await page.waitForTimeout(550);
  await page.getByText('Test task').tap();
  assert.equal((await counts()).edit,1);
  await page.evaluate(()=>window.setDisabled(true));
   await drag([[240,70],[385,70]]);
   assert.equal((await counts()).pin,accepted);
  await page.evaluate(()=>window.setAllowPendingPin(true));
  for (let i=0;i<5;i++) {
     await drag([[240,70],[385,70]]);
     assert.equal((await counts()).pin,accepted+1+i);
  }
   await drag([[160,70],[15,70]]);
   assert.equal((await counts()).delete,3);
  await page.evaluate(()=>{window.setAllowPendingPin(false);window.setDisabled(false);window.setPinEnabled(false);});
   await drag([[240,70],[385,70]]);
   assert.equal((await counts()).pin,accepted+5);
   await drag([[160,70],[15,70]]);
   assert.equal((await counts()).delete,4);
   await touch('touchStart',200,180);
   for (const x of [160,100,15]) { await touch('touchMove',x,180); await page.waitForTimeout(25); }
  await touch('touchEnd');
   assert.equal((await counts()).delete,4);
  await page.evaluate(()=>window.setDisabled(false));
   await drag([[200,50],[200,25],[200,5]]);
   assert.deepEqual(await counts(),{pin:accepted+5,delete:4,edit:1});
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('*')].some(e=>e.scrollTop>0)));
   console.log('PASS: actual-touch strict half-width boundaries at 240/320/360, resize, tracking/return, Pin/Unpin labels, reversal/cancel, fast flick, pending actions, Inbox left-only, media isolation, edit/tap suppression and vertical scroll');
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
