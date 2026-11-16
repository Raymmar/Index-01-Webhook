import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const bundle = await build({
  absWorkingDir: resolve('artifacts/index-mobile'),
  stdin: { resolveDir: resolve('artifacts/index-mobile'), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SwipeDelete} from '../ring-inbox/src/components/swipe-delete';
    window.calls={parent:0,child:0,click:0};window.fail=false;
    createRoot(document.getElementById('root')).render(
      <SwipeDelete onDelete={async()=>{if(window.fail)throw Error('failed');window.calls.parent++}}>
        <div style={{height:140,width:380}} onClick={()=>window.calls.click++}>Message</div>
        <SwipeDelete onDelete={async()=>{window.calls.child++}}><div style={{height:140}}>Task</div></SwipeDelete>
        <textarea aria-label="Task title" defaultValue="Editable task title with selectable text" style={{width:380,height:60}} />
        <p style={{height:60}}>Selectable transcript content</p>
        <audio controls style={{width:380}} />
      </SwipeDelete>);
  `},
  alias: { react: resolve('artifacts/index-mobile/node_modules/react') },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  define: {'process.env.NODE_ENV':'"test"'},
});
const server=createServer((req,res)=>{
  res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');
  res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');
}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/repl/tools/bin/chromium',args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:402,height:874},hasTouch:true,isMobile:true});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByText('Message',{exact:true}).waitFor();
  const cdp=await page.context().newCDPSession(page);
  async function swipe(y, xs, cancel=false) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:240,y}]});
    for(const x of xs){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});await page.waitForTimeout(25);}
    await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
    await page.waitForTimeout(50);
  }
  const counts=()=>page.evaluate(()=>window.calls);
  await swipe(60,[210,170,130]);
  assert.deepEqual(await counts(),{parent:1,child:0,click:0});
  await swipe(210,[210,170,130]);
  assert.deepEqual(await counts(),{parent:1,child:1,click:0});
  await swipe(60,[270,310,350]);
  await swipe(60,[210,130,230]);
  await swipe(60,[210,130],true);
  assert.deepEqual(await counts(),{parent:1,child:1,click:0});
  await page.evaluate(()=>window.fail=true);
  await swipe(60,[210,170,130]);
  await page.getByRole('alert').waitFor();
  assert.equal((await counts()).parent,1);
  await page.evaluate(()=>window.fail=false);
  await swipe(60,[210,170,130]);
  assert.equal((await counts()).parent,2);
  for (const selector of ['textarea','p','audio']) {
    const box=await page.locator(selector).boundingBox();
    const y=box.y+box.height/2;
    await page.mouse.move(280,y);
    await page.mouse.down();
    await page.mouse.move(100,y,{steps:10});
    await page.mouse.up();
    await swipe(y,[210,170,130]);
  }
  // Even dragging noninteractive message chrome with a mouse must not delete.
  await page.mouse.move(280,60); await page.mouse.down();
  await page.mouse.move(100,60,{steps:10}); await page.mouse.up();
  assert.equal((await counts()).parent,2);
  assert.equal((await counts()).child,1);
  console.log('PASS: web delete touch, no right swipe, canceled/reversed drags, nested task isolation, failure and retry');
} finally { await browser.close();await new Promise(r=>server.close(r)); }
