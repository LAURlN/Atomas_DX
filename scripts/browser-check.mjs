import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const url = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge', headless: true } : { headless: true });
await mkdir('test-results', { recursive: true });
const failures = [];
async function check(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`); } }
async function setup(viewport = { width:390, height:844 }) {
  const context = await browser.newContext({ viewport, hasTouch:viewport.width < 600, reducedMotion:'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(`Browser error: ${error.message}`));
  await page.goto(url);
  await page.locator('[data-action="begin"]').click();
  return { context, page };
}
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('athanor.run.v1')));
async function fixture(page, kind) {
  await page.evaluate(async kind => {
    const engine = await import(new URL('./src/engine.js', location.href));
    const s = engine.createGame(71);
    if (kind === 'reward') { s.essence=5; s.inventory=['solvent','twin','catalyst']; }
    if (kind === 'overflow') {
      s.ring=Array.from({length:18},(_,i)=>({id:`p${100+i}`,kind:'ingredient',rank:i+1}));
      s.incoming={id:'p120',kind:'ingredient',rank:1};s.nextId=200;s.highest=18;
    }
    localStorage.setItem('athanor.run.v1',JSON.stringify(s));
  },kind);
  await page.reload();
}
try {
  await check('mobile direct-tap reaction and reload persistence', async () => {
    const {context,page}=await setup();
    assert.equal(await page.locator('.inventory-slot').count(),3);
    const before=await saved(page);
    await page.locator('[data-action="gap"][data-index="2"]').click();
    const after=await saved(page);
    assert.equal(after.turns,1);assert.equal(after.last.pairs,2);assert.equal(after.ring.length,2);
    await page.reload();assert.deepEqual(await saved(page),after);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'test-results/mobile.png',fullPage:true});
    await context.close();
  });
  await check('consumable target cancellation, confirmation and save', async () => {
    const {context,page}=await setup();
    const before=await saved(page);
    await page.locator('[data-action="consumable"][data-index="0"]:visible').click();
    await page.locator('[data-action="target"]').first().click();
    await page.locator('[data-action="cancel-target"]').click();
    assert.deepEqual(await saved(page),before);
    await page.locator('[data-action="consumable"][data-index="0"]:visible').click();
    await page.locator('[data-action="target"]').first().click();
    await page.locator('[data-action="confirm-target"]').click();
    const after=await saved(page);assert.equal(after.inventory[0],null);assert.equal(after.ring.length,before.ring.length-1);
    await page.reload();assert.deepEqual(await saved(page),after);
    await context.close();
  });
  await check('reward draft persists, full inventory replacement is explicit', async () => {
    const {context,page}=await setup();await fixture(page,'reward');
    await page.locator('[data-action="gap"][data-index="2"]').click();
    const pending=await saved(page);assert.ok(pending.pendingReward);
    await page.reload();assert.deepEqual(await saved(page),pending);
    const index=pending.pendingReward.options.findIndex(o=>o.type==='consumable');
    // A three-relic draft is valid: test the relic route, otherwise test replacement.
    if(index>=0){
      const item=pending.pendingReward.options[index].id;
      await page.locator(`[data-action="reward"][data-index="${index}"]`).click();
      assert.deepEqual(await saved(page),pending);
      await page.locator('[data-action="replace"][data-index="1"]').click();
      assert.equal((await saved(page)).inventory[1],item);
    }else{
      await page.locator('[data-action="reward"][data-index="0"]').click();
      assert.ok((await saved(page)).relics.length);
    }
    assert.equal((await saved(page)).pendingReward,null);
    await context.close();
  });
  await check('fatal warning, overflow death, restart and archive preservation', async () => {
    const {context,page}=await setup();await fixture(page,'overflow');
    await page.locator('[data-action="gap"][data-index="0"]').click();
    assert.ok((await saved(page)).over);
    await page.reload();assert.ok((await saved(page)).over);
    await page.locator('[data-action="new"][data-starter="standard"]').click();
    const fresh=await saved(page);assert.equal(fresh.over,false);assert.equal(fresh.turns,0);assert.deepEqual(fresh.relics,[]);
    assert.ok(fresh.eligibleRelics.includes('phoenix'));
    await context.close();
  });
  await check('desktop help, direct placement and layout', async () => {
    const {context,page}=await setup({width:1440,height:1000});
    await page.locator('[data-action="help"]').first().click();
    await page.getByRole('button',{name:'Close help'}).click();
    await page.locator('[data-action="gap"][data-index="2"]').click();
    assert.equal((await saved(page)).turns,1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'test-results/desktop.png',fullPage:true});await context.close();
  });
  await check('isolated agent API previews and acts through real rules without touching player saves', async () => {
    const {context,page}=await setup();
    const normal=await saved(page);
    await page.goto(url+'?agent=1&seed=42');
    const result=await page.evaluate(()=>{
      const api=window.athanor;api.reset({seed:42});
      const before=api.snapshot();
      const action=api.actions().find(a=>a.type==='place'&&a.gap===2);
      const preview=api.preview(action);
      const still=api.snapshot();
      const after=api.act(action);
      before.state.ring.length=0;
      return {action,preview,still,after,current:api.snapshot()};
    });
    assert.ok(result.action);assert.equal(result.still.state.turns,0);
    assert.deepEqual(result.preview.state,result.after.state);
    assert.equal(result.current.state.turns,1);assert.equal(result.current.state.last.pairs,2);
    assert.deepEqual(await saved(page),normal);
    await page.reload();assert.equal(await page.evaluate(()=>window.athanor.snapshot().state.turns),1);
    await page.goto(url);assert.deepEqual(await saved(page),normal);
    assert.equal(await page.evaluate(()=>typeof window.athanor),'undefined');
    await context.close();
  });
  await check('malformed run and archive recover to a playable vessel', async () => {
    const {context,page}=await setup();
    await page.evaluate(()=>{localStorage.setItem('athanor.run.v1','{"version":1}');localStorage.setItem('athanor.archive.v1','{"unlockedStarters":null,"unlockedRelics":null,"discoveries":null}');});
    await page.reload();await page.locator('[data-action="begin"]').click();
    await page.locator('[data-action="gap"][data-index="2"]').click();
    assert.equal((await saved(page)).turns,1);await context.close();
  });
} finally { await browser.close(); }
if(failures.length){ console.error(failures);process.exitCode=1; }
else console.log('All browser checks passed.');
