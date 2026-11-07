import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch(process.platform === 'win32'
  ? {channel:'msedge',headless:true} : {headless:true});
await mkdir('test-results',{recursive:true});
const results = [];
const pageErrors = [];

async function check(name,run) {
  try {
    await run();
    results.push({name,passed:true});
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({name,passed:false,error:error.stack || String(error)});
    console.error(`FAIL ${name}: ${error.stack || error}`);
  }
}
async function setup({width=390,height=844,reducedMotion='no-preference'}={}) {
  const context = await browser.newContext({viewport:{width,height},hasTouch:width<600,reducedMotion});
  const page = await context.newPage();
  page.on('pageerror',error=>pageErrors.push(error.stack || error.message));
  const url = new URL(base);
  url.searchParams.set('agent','1');
  url.searchParams.set('seed','42');
  await page.goto(url.href);
  await page.waitForFunction(()=>typeof window.athanor?.whenIdle === 'function');
  await page.evaluate(()=>window.athanor.reset({seed:42}));
  return {context,page};
}
const idle = page => page.evaluate(async()=>{
  await window.athanor.whenIdle();
  return window.athanor.snapshot();
});
const ghostCount = page => page.locator('.motion-layer').count();
const noHorizontalOverflow = page => page.evaluate(()=>({
  viewport:innerWidth,document:document.documentElement.scrollWidth,
  body:document.body.scrollWidth,
}));

try {
  await check('a gap tap and an empty annulus click each immediately place the incoming piece',async()=>{
    const {context,page}=await setup();
    try {
      const expected=await page.evaluate(()=>window.athanor.preview({type:'place',gap:2}).state);
      await page.locator('[data-action="gap"][data-index="2"]').click();
      const tapped=await page.evaluate(()=>window.athanor.snapshot());
      assert.equal(tapped.state.turns,1,'a gap tap should commit without a separate confirmation');
      assert.deepEqual((await idle(page)).state,expected);
      await page.evaluate(()=>window.athanor.reset({seed:42}));
      const bounds=await page.locator('.vessel').boundingBox();
      assert.ok(bounds);
      const angle=-Math.PI/2+(2-.5)*Math.PI*2/5+0.15;
      const point={x:bounds.x+bounds.width*(.5+190/420*Math.cos(angle)),
        y:bounds.y+bounds.height*(.5+190/420*Math.sin(angle))};
      const target=await page.evaluate(({x,y})=>{
        const element=document.elementFromPoint(x,y);
        return {gap:!!element?.closest('[data-action="gap"]'),piece:!!element?.closest('.ring-piece'),vessel:!!element?.closest('.vessel')};
      },point);
      assert.equal(target.gap,false,'test must click the annulus, outside the visible gap buttons');
      assert.equal(target.piece,false,'test must not click an ingredient');
      assert.equal(target.vessel,true);
      await page.mouse.click(point.x,point.y);
      const clicked=await idle(page);
      assert.equal(clicked.state.turns,1,'an empty annulus click should commit immediately');
      assert.deepEqual(clicked.state,expected);
    } finally {await context.close();}
  });

  await check('normal-motion reaction animates, locks duplicate actions and settles exactly to preview',async()=>{
    const {context,page}=await setup();
    try {
      const started = await page.evaluate(()=>{
        const api=window.athanor;
        const action={type:'place',gap:2};
        const preview=api.preview(action);
        const accepted=api.act(action);
        const second=api.act(action);
        return {preview,accepted,second,snapshot:api.snapshot(),resolving:document.querySelector('#app').hasAttribute('data-resolving')};
      });
      assert.equal(started.accepted.accepted,true);
      assert.equal(started.accepted.busy,true);
      assert.equal(started.resolving,true);
      assert.equal(started.second.accepted,false);
      assert.equal(started.second.reason,'busy');
      assert.deepEqual(started.second.state,started.accepted.state);
      assert.equal(started.snapshot.state.turns,1);
      const motion = await page.evaluate(async()=>{
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const layer=document.querySelector('.motion-layer');
        const active=document.getAnimations().filter(animation=>{
          const target=animation.effect?.target;
          return ['running','pending'].includes(animation.playState)
            && animation.effect?.getTiming().iterations!==Infinity
            && target instanceof Element
            && target.closest('.motion-layer,.motion-ghost,.ring-piece,.incoming');
        });
        return {layer:!!layer,children:layer?.childElementCount||0,animations:active.length};
      });
      assert.ok(motion.layer || motion.animations>0,'a visible transition layer or active particle animation must exist');
      if(motion.layer) assert.ok(motion.children>0,'the transition layer must contain visual effects');
      const settled=await idle(page);
      assert.equal(settled.busy,false);
      assert.deepEqual(settled.state,started.preview.state);
      assert.equal(await ghostCount(page),0);
      assert.equal(await page.locator('#app[data-resolving]').count(),0);
    } finally {await context.close();}
  });

  await check('reloading during motion preserves the already committed reaction',async()=>{
    const {context,page}=await setup();
    try {
      const committed=await page.evaluate(()=>{
        const result=window.athanor.act({type:'place',gap:2});
        return {busy:result.busy,state:result.state,saved:JSON.parse(localStorage.getItem('athanor.playtest.run.v1'))};
      });
      assert.equal(committed.busy,true);
      assert.deepEqual(committed.saved,committed.state);
      await page.reload();
      await page.waitForFunction(()=>!!window.athanor);
      const settled=await idle(page);
      assert.deepEqual(settled.state,committed.state);
      assert.equal(settled.busy,false);
      assert.equal(await ghostCount(page),0);
    } finally {await context.close();}
  });

  await check('reset during motion cancels ghosts and prevents old completion from changing the new run',async()=>{
    const {context,page}=await setup();
    try {
      const result=await page.evaluate(async()=>{
        const api=window.athanor;
        const placed=api.act({type:'place',gap:2});
        const oldIdle=api.whenIdle();
        const reset=api.reset({seed:31415});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const staleLayers=document.querySelectorAll('.motion-layer').length;
        await oldIdle;
        await api.whenIdle();
        // Flush completion callbacks that might have been queued by cancellation.
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return {startedBusy:placed.busy,reset,staleLayers,after:api.snapshot(),layers:document.querySelectorAll('.motion-layer').length};
      });
      assert.equal(result.startedBusy,true);
      assert.equal(result.reset.state.seed,31415);
      assert.equal(result.after.state.turns,0);
      assert.equal(result.after.busy,false);
      assert.deepEqual(result.after.state,result.reset.state);
      assert.equal(result.staleLayers,0,'a queued old transition must not begin after reset');
      assert.equal(result.layers,0);
    } finally {await context.close();}
  });

  await check('loading a fixture during motion cancels the old transition safely',async()=>{
    const {context,page}=await setup();
    try {
      const result=await page.evaluate(async()=>{
        const api=window.athanor;
        const original=api.snapshot().state;
        api.act({type:'place',gap:2});
        const oldIdle=api.whenIdle();
        const loaded=api.loadRun(original);
        await oldIdle;
        await api.whenIdle();
        return {loaded,after:api.snapshot()};
      });
      assert.deepEqual(result.after.state,result.loaded.state);
      assert.equal(result.after.state.turns,0);
      assert.equal(result.after.busy,false);
      assert.equal(await ghostCount(page),0);
    } finally {await context.close();}
  });

  await check('reduced-motion play settles promptly with no leftover animation layer',async()=>{
    const {context,page}=await setup({reducedMotion:'reduce'});
    try {
      const result=await page.evaluate(async()=>{
        const api=window.athanor;
        const expected=api.preview({type:'place',gap:2}).state;
        const start=performance.now();
        const accepted=api.act({type:'place',gap:2});
        await api.whenIdle();
        return {accepted:accepted.accepted,elapsed:performance.now()-start,expected,after:api.snapshot()};
      });
      assert.equal(result.accepted,true);
      assert.ok(result.elapsed<400,`reduced-motion transition took ${result.elapsed} ms`);
      assert.equal(result.after.busy,false);
      assert.deepEqual(result.after.state,result.expected);
      assert.equal(await ghostCount(page),0);
    } finally {await context.close();}
  });

  await check('reward controls become usable after the reaction finishes',async()=>{
    const {context,page}=await setup();
    try {
      const result=await page.evaluate(async()=>{
        const api=window.athanor;
        const state=api.snapshot().state;
        state.essence=5;
        api.loadRun(state);
        const accepted=api.act({type:'place',gap:2});
        const busyReward=api.act({type:'reward',index:0});
        await api.whenIdle();
        return {accepted,busyReward,settled:api.snapshot()};
      });
      assert.equal(result.accepted.busy,true);
      assert.ok(result.accepted.state.pendingReward);
      assert.equal(result.busyReward.accepted,false);
      assert.equal(result.busyReward.reason,'busy');
      assert.equal(result.settled.busy,false);
      await page.locator('[data-action="reward"]').first().waitFor({state:'visible'});
      assert.equal(await page.locator('[data-action="reward"]').first().isEnabled(),true);
      // Prefer the relic offer so full vial inventory does not introduce another modal.
      const index=result.settled.state.pendingReward.options.findIndex(o=>o.type==='relic');
      assert.ok(index>=0);
      await page.locator(`[data-action="reward"][data-index="${index}"]`).click();
      const after=await idle(page);
      assert.equal(after.state.pendingReward,null);
      assert.equal(after.state.relics.length,1);
    } finally {await context.close();}
  });

  for(const viewport of [{width:320,height:780,name:'mobile'},{width:1440,height:1000,name:'desktop'}]) {
    await check(`${viewport.name} vivid layout fits the viewport and renders after a real reaction`,async()=>{
      const {context,page}=await setup(viewport);
      try {
        await page.evaluate(()=>window.athanor.act({type:'place',gap:2}));
        await idle(page);
        const sizes=await noHorizontalOverflow(page);
        assert.ok(sizes.document<=sizes.viewport,JSON.stringify(sizes));
        assert.ok(sizes.body<=sizes.viewport,JSON.stringify(sizes));
        assert.equal(await ghostCount(page),0);
        await page.screenshot({path:`test-results/motion-${viewport.name}.png`,fullPage:true});
      } finally {await context.close();}
    });
  }
} finally {
  await browser.close();
  if(pageErrors.length) results.push({name:'browser console errors',passed:false,errors:pageErrors});
  await writeFile('test-results/motion-check.json',JSON.stringify({base,passed:results.every(r=>r.passed),results},null,2)+'\n');
}
if(results.some(result=>!result.passed)) process.exitCode=1;
else console.log('All animation and vivid-layout checks passed.');
