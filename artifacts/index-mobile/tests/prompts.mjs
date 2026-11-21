// Actual prompt pages and shared state, with account/device chrome isolated.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('artifacts/index-mobile');
const defaults = { taskRules: 'Extract clear actions.', dateRules: 'Use message receipt time.', titleStyle: 'Short titles.', personalContext: '' };
const owners = new Map([['owner', { ...defaults }], ['other', { ...defaults, personalContext: 'Other account' }]]);
const stubs = {
  '@clerk/react': `import {useSyncExternalStore} from 'react'; export const useAuth=()=>({userId:useSyncExternalStore(cb=>{window.addEventListener('fixture-account',cb);return()=>window.removeEventListener('fixture-account',cb)},()=>window.__promptAccount)});`,
  '@clerk/expo': `export {useAuth} from '@clerk/react';`,
  'expo-router': `export const router={canGoBack:()=>false,back(){},replace(){}};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:0,bottom:0});`,
  '@expo/vector-icons': `import React from 'react';export const Feather=()=> <span/>;`,
  './KeyboardAwareScrollViewCompat': `export {ScrollView as KeyboardAwareScrollViewCompat} from 'react-native';`,
};
const bundle = await build({
  absWorkingDir: root, stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import Mobile from './app/settings-extraction';
    import Web from '../ring-inbox/src/pages/settings-extraction';
    window.__promptAccount='owner';
    const realFetch=window.fetch;
    window.fetch=(input,init={})=>realFetch(input,{...init,headers:{...init.headers,'x-fixture-account':window.__promptAccount}});
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    window.__refreshPrompts=()=>client.invalidateQueries({predicate:q=>q.queryKey[0]==='/api/prompts'});
    window.__switchPrompts=account=>{client.clear();window.__promptAccount=account;window.dispatchEvent(new Event('fixture-account'));};
    const Page=new URLSearchParams(location.search).get('mode')==='web'?Web:Mobile;
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Page/></QueryClientProvider>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { 'react-native': 'react-native-web', react: resolve(root,'node_modules/react'), 'react-dom':resolve(root,'node_modules/react-dom'), '@tanstack/react-query':resolve(root,'node_modules/@tanstack/react-query') },
  define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true', global: 'globalThis' },
  plugins: [{ name: 'device-and-account-chrome', setup(b) {
    b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: root }));
  } }],
});
let failSave = false, saves = 0;
const server = createServer(async (req,res) => {
  if(req.url==='/app.js'){res.setHeader('content-type','application/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(req.url==='/api/prompts'){
    res.setHeader('content-type','application/json');
    const owner=req.headers['x-fixture-account'];
    if(req.method==='PUT'){
      if(failSave){res.statusCode=500;res.end(JSON.stringify({error:'Fixture save failure'}));return;}
      let text='';for await(const chunk of req)text+=chunk;
      owners.set(owner,JSON.parse(text));saves++;
    }
    res.end(JSON.stringify({instructions:owners.get(owner),defaults,skill:JSON.stringify(owners.get(owner))}));return;
  }
  res.setHeader('content-type','text/html');
  res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script src="/app.js"></script>');
}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/repl/tools/bin/chromium',args:['--no-sandbox']});
try{
  for(const mode of ['web','mobile']){
    owners.set('owner',{...defaults});failSave=false;
    const page=await browser.newPage({viewport:{width:mode==='web'?1100:375,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
    const field=page.getByTestId('input-personalContext');
    await field.waitFor();
    const save=page.getByRole('button',{name:'Save',exact:true});
    assert.ok(await save.isDisabled());
    await field.fill('My editable context');
    await save.click();
    await page.waitForFunction(()=>document.body.textContent.includes('Saved'));
    assert.equal(owners.get('owner').personalContext,'My editable context');
    await field.fill('');
    await save.click();
    await page.waitForFunction(()=>document.body.textContent.includes('Saved'));
    assert.equal(owners.get('owner').personalContext,'');
    owners.set('owner',{...defaults,personalContext:'Changed on another device'});
    await page.evaluate(()=>window.__refreshPrompts());
    assert.equal(await field.inputValue(),'Changed on another device');
    await field.fill('Unsaved local work');
    owners.set('owner',{...defaults,personalContext:'A newer remote change'});
    await page.evaluate(()=>window.__refreshPrompts());
    assert.equal(await field.inputValue(),'Unsaved local work');
    const beforeReset=saves;
    await page.getByRole('button',{name:'Reset to defaults',exact:true}).click();
    assert.equal(await field.inputValue(),'');
    assert.equal(saves,beforeReset);
    failSave=true;await save.click();
    await page.getByText('Fixture save failure',{exact:true}).waitFor();
    failSave=false;
    await field.fill('x'.repeat(6001));
    assert.ok(await save.isDisabled());
    assert.ok(await field.evaluate(el => el.scrollHeight <= el.clientHeight + 1), mode+' long text must fit without an inner scrollbar');
    await field.fill(('A readable paragraph with a date and a task. ').repeat(50));
    await field.press('Control+End');
    await field.pressSequentially(' Typed text remains editable.');
    assert.ok((await field.inputValue()).endsWith(' Typed text remains editable.'), (await field.inputValue()).slice(-160));
    assert.ok(await field.evaluate(el => el.scrollHeight <= el.clientHeight + 1), mode+' wrapped text must fit');
    await page.setViewportSize({width:320,height:900});
    await page.waitForTimeout(100);
    assert.ok(await field.evaluate(el => el.scrollHeight <= el.clientHeight + 1), mode+' resized field must fit');
    const tallHeight=await field.evaluate(el=>el.clientHeight);
    await field.fill('Short');
    assert.ok(await field.evaluate(el=>el.clientHeight)<tallHeight, mode+' field shrinks after deleting text');
    await field.fill('Owner-only unsaved context');
    await page.evaluate(()=>window.__switchPrompts('other'));
    await page.waitForFunction(()=>document.querySelector('[data-testid=\"input-personalContext\"]')?.value==='Other account');
    await page.evaluate(()=>window.__switchPrompts('owner'));
    await page.waitForFunction(()=>document.querySelector('[data-testid=\"input-personalContext\"]')?.value==='Owner-only unsaved context');
    assert.deepEqual(errors,[]);
    console.log('PASS: '+mode+' prompt edit/save/empty/reset/failure/length guard, clean SSE refresh, dirty draft protection and account isolation');
    await page.close();
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
