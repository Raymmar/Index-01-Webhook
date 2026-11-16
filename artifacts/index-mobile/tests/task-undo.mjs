// Exercise the real hook + message UI using generated hooks against a fake HTTP server.
// No app authentication bypass: this is an isolated component harness.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

let deleteFails = false, restoreStatus = 200, delayRestore = false;
let deleteCalls = 0, restoreCalls = 0;
const bundle = await build({
  absWorkingDir: resolve('artifacts/index-mobile'),
  stdin: { resolveDir: resolve('artifacts/index-mobile'), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {useTaskUndo} from './hooks/use-task-undo';
    import {TaskUndoMessages} from './components/task-undo-messages';
    function App(){
      const undo=useTaskUndo(()=>window.changes++, e=>e.data?.error||e.message);
      window.changes=window.changes||0;window.undo=undo;
      return <TaskUndoMessages undo={undo}/>;
    }
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><App/></QueryClientProvider>);
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { 'react-native': 'react-native-web' },
  define: { 'process.env.NODE_ENV': '"test"', __DEV__: 'true' },
  plugins: [{ name: 'harness-theme', setup(b) {
    b.onResolve({filter:/^react-native-safe-area-context$/},()=>({path:'insets',namespace:'fixture'}));
    b.onLoad({filter:/^insets$/,namespace:'fixture'},()=>({contents:'export const useSafeAreaInsets=()=>({bottom:0});'}));
    b.onResolve({filter:/^\.\/ui$/},()=>({path:'ui',namespace:'fixture'}));
    b.onLoad({filter:/^ui$/,namespace:'fixture'},()=>({loader:'tsx',resolveDir:resolve('artifacts/index-mobile'),contents:`
      import React from 'react';import {Pressable,Text} from 'react-native';
      export const s={card:{backgroundColor:'white',padding:12},text:{},error:{},between:{}};
      export const Button=({label,onPress,disabled,testID})=><Pressable accessibilityRole="button" testID={testID} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>;
      export const IconButton=({label,onPress,disabled})=><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}><Text>Close</Text></Pressable>;
    `}));
  }}],
});
const server=createServer(async(req,res)=>{
  if(req.url.startsWith('/api/items/')){
    res.setHeader('content-type','application/json');
    if(req.method==='DELETE'){
      deleteCalls++;res.statusCode=deleteFails?500:204;
      res.end(deleteFails?JSON.stringify({error:'Delete failed'}):undefined);
    } else {
      restoreCalls++;
      if(delayRestore) await new Promise(r=>setTimeout(r,200));
      res.statusCode=restoreStatus;
      res.end(JSON.stringify(restoreStatus===200?{id:req.url.split('/')[3]}:{error:restoreStatus===410?'Undo period expired':'Restore failed'}));
    }
    return;
  }
  res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');
  res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');
}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/repl/tools/bin/chromium',args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:402,height:874}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.undo);
  const remove=id=>page.evaluate(async id=>{try{await window.undo.remove({id,title:'Task '+id});return null;}catch(e){return e.data.error;}},id);
  const undo=id=>page.locator('[data-testid="undo-task-'+id+'"]');
  deleteFails=true;
  assert.equal(await remove('failed'),'Delete failed');
  assert.equal(await page.locator('[data-testid^="task-undo-message"]').count(),0);
  deleteFails=false;
  await remove('a');await remove('b');
  assert.equal(await page.locator('[data-testid^="task-undo-message"]').count(),2);
  restoreStatus=500;
  await undo('a').click();
  await page.getByRole('alert').getByText('Restore failed').waitFor();
  assert.equal(await undo('a').count(),1);
  restoreStatus=200;delayRestore=true;
  const before=restoreCalls;
  await page.evaluate(()=>{void window.undo.undo('a');void window.undo.undo('a');});
  await page.getByText('Restored “Task a”.',{exact:true}).waitFor();
  assert.equal(restoreCalls,before+1);
  assert.equal(await undo('b').count(),1);
  restoreStatus=410;
  await undo('b').click();
  await page.getByText('Undo expired for “Task b”.',{exact:true}).waitFor();
  assert.equal(await undo('b').count(),0);
  await remove('c');
  // Simulate returning after the app was suspended without allowing the interval to tick.
  const calls=restoreCalls;
  await page.evaluate(()=>{const now=Date.now();Date.now=()=>now+16_000;void window.undo.undo('c');});
  await page.getByText('Undo expired for “Task c”.',{exact:true}).waitFor();
  assert.equal(restoreCalls,calls);
  assert.equal(await undo('c').count(),0);
  assert.ok(await page.locator('[aria-live="polite"]').count());
  assert.ok(await page.evaluate(()=>window.changes>=7));
  assert.deepEqual(errors,[]);
  console.log('PASS: delete failure, rapid independent deletions, restore failure/retry, duplicate taps, server expiry, suspended-app expiry, live messages and refresh callbacks');
} finally {await browser.close();await new Promise(r=>server.close(r));}
