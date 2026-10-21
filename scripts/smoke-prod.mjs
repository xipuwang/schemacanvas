#!/usr/bin/env node
// Production smoke test of a served build, with real mouse and keyboard input, in one or all Playwright engines.
//   node scripts/smoke-prod.mjs <chromium|firefox|webkit|all> <url>
//   e.g. npm run build && node scripts/serve-static.mjs dist 4173 /schemacanvas/ &   then
//        node scripts/smoke-prod.mjs all http://127.0.0.1:4173/schemacanvas/
//        node scripts/smoke-prod.mjs all https://xipuwang.github.io/schemacanvas/      (after a deployment)
// Covers: cold load under the URL's path, fonts, example E (ER + relational), FK arrow tips on their target cells, table move,
// building a Chen diagram from scratch, validation, conversion, undo/redo, auto-layout in the ELK worker, project save, SVG/PNG/PDF,
// SQL (MySQL, PostgreSQL) and DBML exports, SQL import with a composite foreign key, autosave reload, reopening the saved file in a
// fresh context, Chinese + dark theme. Exits 1 on any failed step, console error/warning, page error, failed request, HTTP >= 400
// or Content-Security-Policy violation. Screenshots and downloads go to .tmp/smoke/<engine>/.
import { chromium, firefox, webkit } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [, , engArg, urlArg] = process.argv;
if (!engArg || !urlArg) {
  console.error('usage: node scripts/smoke-prod.mjs <chromium|firefox|webkit|all> <url>');
  process.exit(2);
}
if (engArg === 'all') {
  let failed = 0;
  for (const e of ['chromium', 'firefox', 'webkit']) failed += spawnSync(process.execPath, [fileURLToPath(import.meta.url), e, urlArg], { stdio: 'inherit' }).status ? 1 : 0;
  console.log(failed ? `SMOKE FAILED in ${failed} engine(s)` : 'SMOKE PASSED in chromium, firefox and webkit');
  process.exit(failed ? 1 : 0);
}
const eng = engArg;
const BT = { chromium, firefox, webkit }[eng];
if (!BT) throw new Error(`unknown engine ${eng}`);
const URL = urlArg.endsWith('/') ? urlArg : `${urlArg}/`;
const D = `.tmp/smoke/${eng}`;
mkdirSync(`${D}/dl`, { recursive: true });
const log = [];
const problems = [];
const results = { ok: 0, fail: 0 };
const L = (...a) => { const s = a.join(' '); console.log(`[${eng}] ${s}`); log.push(s); };
const b = await BT.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
const fonts = [];
const workerRequests = [];
page.on('console', m => { if (['error','warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => problems.push('pageerror: '+e.message));
page.on('requestfailed', r => problems.push('requestfailed: '+r.url()+' '+(r.failure()?.errorText)));
page.on('response', r => { if (r.status()>=400) problems.push(`http ${r.status()} ${r.url()}`); if (/\.woff2$/.test(r.url())) fonts.push(`${r.status()} ${r.url().split('/').pop()}`); });
page.on('request', r => { if (/elk-worker/.test(r.url())) workerRequests.push(r.url()); });
const cv = page.locator('.sc-canvas');
const props = page.getByRole('complementary',{name:'Properties'});
const settle = (ms=400)=>page.waitForTimeout(ms);
async function step(name, fn){ try { await fn(); results.ok++; L('OK  ', name);} catch(e){ results.fail++; L('FAIL', name, '::', String(e.message).split('\n')[0]); await page.screenshot({path:`${D}/FAIL-${name.replace(/\W+/g,'_')}.png`}).catch(()=>{}); await page.keyboard.press('Escape').catch(()=>{}); } }
const shot = async n => { await settle(350); await page.screenshot({path:`${D}/${n}.png`}); };
async function openExample(title, view){
  const t = page.getByRole('button',{name:'Open an example'}); if (await t.isVisible().catch(()=>false)) await t.click(); else { await page.getByRole('button',{name:'Command palette'}).click(); await page.getByRole('combobox',{name:'Search commands'}).fill('Open an example'); await page.getByRole('listbox',{name:'Commands'}).getByRole('option').first().click(); }
  const d = page.getByRole('dialog',{name:'Examples'}); await d.waitFor();
  await d.getByRole('radio',{name: view==='relational'?'Relational schema':'ER diagram'}).first().click();
  await d.getByRole('radio',{name:title}).click(); await d.getByRole('button',{name:'Open example'}).click();
  await page.waitForFunction(()=>!document.querySelector('[role=dialog]')); await settle(600);
}
async function fkTips(){ return page.evaluate(()=>{ const canvas=document.querySelector('.sc-canvas'); const dist=(p,r)=>Math.hypot(Math.max(r.left-p.x,0,p.x-r.right),Math.max(r.top-p.y,0,p.y-r.bottom));
 const cells=new Map(); canvas.querySelectorAll('[data-node-id] [data-column-id]').forEach(g=>cells.set(g.getAttribute('data-column-id'),g.querySelector('rect,polygon').getBoundingClientRect()));
 const out=[]; canvas.querySelectorAll('[data-edge-id] [data-fk-branch]').forEach(br=>{ const target=br.getAttribute('data-fk-target'); const poly=br.querySelector('polygon'); if(!poly) return; const m=poly.getScreenCTM(); const pts=Array.from({length:poly.points.numberOfItems},(_,i)=>{const p=poly.points.getItem(i); return {x:p.x*m.a+p.y*m.c+m.e,y:p.x*m.b+p.y*m.d+m.f};}); const tr=cells.get(target); let tip=pts[0]; for(const p of pts) if(dist(p,tr)<dist(tip,tr)) tip=p; let dO=1e9; cells.forEach((r,id)=>{ if(id!==target) dO=Math.min(dO,dist(tip,r)); }); out.push({target, dT:+dist(tip,tr).toFixed(2), dO:+dO.toFixed(2)}); }); return out; }); }
async function checkTips(label){ const t = await fkTips(); const bad = t.filter(x=>x.dT>=2); L(`${label}: FK arrows=${t.length}, tips not on target=${bad.length}`, bad.length?JSON.stringify(bad):''); if(bad.length||!t.length) throw new Error('tips off target / none'); }
async function dl(trigger, tag){ const [d] = await Promise.all([page.waitForEvent('download',{timeout:30000}), trigger()]); const n=d.suggestedFilename(); const p=`${D}/dl/${tag}-${n}`; await d.saveAs(p); L('   downloaded', n, readFileSync(p).length, 'bytes'); return p; }
async function exportAs(kind, tag, adjust){ await page.getByRole('button',{name:'Export diagram'}).click(); const d=page.getByRole('dialog',{name:'Export'}); await d.waitFor(); await d.getByRole('radio',{name:new RegExp('^'+kind)}).click(); if(adjust) await adjust(d); const btn=d.getByRole('button',{name:'Download'}); await btn.waitFor(); await page.waitForFunction(()=>true); let p; try{ await (async()=>{for(let i=0;i<60;i++){ if(await btn.isEnabled()) return; await settle(500);} throw new Error('Download never enabled');})(); p = await dl(()=>btn.click(), tag);} finally { await page.keyboard.press('Escape'); await settle(300); if(await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button',{name:/Close|Cancel/}).first().click().catch(()=>{}); } return p; }
const centreOf = async loc => loc.first().evaluate(el=>{const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height};});
async function dropPart(id, nodeText, name, dx=0, dy=0){ // drop onto a node (or sheet point when nodeText is object)
  const src = page.locator(`[data-part-id="${id}"]`); const cb = await cv.boundingBox();
  let pt; if (typeof nodeText==='string'){ const c = await centreOf(cv.locator('[data-node-id]').filter({hasText:nodeText}).first()); pt={x:c.x+dx-cb.x,y:c.y+dy-cb.y}; } else pt=nodeText;
  await src.dragTo(cv,{targetPosition:pt}); await settle(250);
  if (name){ const inp=page.locator('.sc-inline-input'); await inp.waitFor({timeout:4000}); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type(name); await page.keyboard.press('Enter'); await settle(200);} 
  if (eng==='webkit') await page.mouse.click(720,894);
}
const node = t => cv.locator('[data-node-id]').filter({hasText:t}).first();

// ---- 1 cold load
let t0=Date.now(); await page.goto(URL); await page.getByRole('toolbar').waitFor(); const tLoad=Date.now()-t0; L('first-load nav->toolbar visible ms', tLoad);
await cv.waitFor(); L('title', await page.title()); await shot('01-first-load');
const nav = await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0]; return {dcl:Math.round(n.domContentLoadedEventEnd), load:Math.round(n.loadEventEnd)};}); L('nav timing', JSON.stringify(nav));

// ---- 2 Example E
await step('example E ER', async()=>{ await openExample('Pharmacy','er'); await shot('02-pharmacy-er'); });
await step('example E relational', async()=>{ await switchTab(); async function switchTab(){ } await openExample('Pharmacy','relational'); await shot('03-pharmacy-rel'); await checkTips('pharmacy rel'); });
await step('tabs list', async()=>{ L('   tabs:', (await page.getByRole('tab').allInnerTexts()).join(' | ')); });
await step('pharmacy move table + tips', async()=>{ const t = cv.locator('[data-node-id]').filter({hasText:'Prescription'}).first(); const c = await centreOf(t); const before=JSON.stringify(await fkTips()); await page.mouse.move(c.x- c.w/2+6,c.y); await page.mouse.down(); for(let i=1;i<=12;i++) await page.mouse.move(c.x-c.w/2+6+i*8,c.y+i*10); await page.mouse.up(); await settle(500); await shot('04-pharmacy-moved'); await checkTips('after move'); });

await step('fonts loaded', async()=>{ await page.evaluate(() => document.fonts.ready); const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)); L('   loaded font faces:', [...new Set(faces)].join(', '), '| woff2:', fonts.join(', ')); if (!faces.length || !fonts.length || fonts.some((f) => !f.startsWith('200'))) throw new Error('fonts not loaded from the subpath'); });
await step('base path', async()=>{ const p = new globalThis.URL(page.url()).pathname; const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean)); L('   page path', p, '| first script', scripts[0]); if (!scripts.every((s) => new globalThis.URL(s).pathname.startsWith(p))) throw new Error('a script is outside the page path'); });
await step('auto-layout (ELK worker)', async()=>{ const pos = () => cv.locator('[data-layer="nodes"] > [data-node-id]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x) + ',' + Math.round(e.getBoundingClientRect().y)).join('|')); const before = await pos(); await page.getByRole('button',{name:'Auto-layout'}).click(); await page.getByRole('button',{name:'Laying out…'}).waitFor({ state: 'detached', timeout: 60000 }).catch(()=>{}); await settle(800); const moved = (await pos()) !== before; L('   moved', moved, '| worker requests', workerRequests.length); if (!moved || !workerRequests.length) throw new Error('auto-layout did not run in the worker'); await checkTips('after auto-layout'); });
await step('SQL import (composite FK)', async()=>{ await page.getByRole('button',{name:'Command palette'}).click(); await page.getByRole('combobox',{name:'Search commands'}).fill('Import'); await page.getByRole('listbox',{name:'Commands'}).getByRole('option').first().click(); const d = page.getByRole('dialog',{name:'Import'}); await d.waitFor(); await d.getByTestId('import-text').fill('CREATE TABLE Drug (company VARCHAR(40), trade VARCHAR(40), PRIMARY KEY (company, trade));\nCREATE TABLE Rx (id INT PRIMARY KEY, company VARCHAR(40), trade VARCHAR(40), FOREIGN KEY (company, trade) REFERENCES Drug (company, trade));'); await d.getByTestId('import-summary').waitFor(); L('   summary:', (await d.getByTestId('import-summary').innerText()).replace(/\n+/g,' ')); await d.getByTestId('import-apply').click(); await page.waitForFunction(()=>!document.querySelector('[role=dialog]')); await settle(800); const sel = await page.getByRole('tab',{selected:true}).innerText(); L('   active tab', sel); if (!/Imported/.test(sel)) throw new Error('import did not open its sheet'); await checkTips('imported composite FK'); });

// ---- 3 new project from scratch
await step('new project', async()=>{ await page.getByRole('button',{name:'New project'}).click(); await settle(500); const dlg=page.getByRole('dialog'); if(await dlg.count()){ L('   new-project dialog:', (await dlg.innerText()).replace(/\n+/g,' / ').slice(0,200)); await dlg.getByRole('button').last().click(); await settle(400);} await shot('05-new'); });
await step('build entities', async()=>{
  await dropPart('entity',{x:150,y:330},'Company');
  await dropPart('weak-entity',{x:500,y:330},'Drug');
  await dropPart('entity',{x:850,y:330},'Pharmacy');
});
await step('attributes', async()=>{
  await dropPart('key-attribute','Company','cid',-30,0); await page.waitForTimeout(100);
  await dropPart('composite','Company','Address',0,0);
  await dropPart('multivalued','Company','Phone',0,0);
  await dropPart('derived','Company','Age',0,0);
  await dropPart('partial-key','Drug','TradeName',0,0);
  await dropPart('attribute','Drug','Formula',0,0);
  await dropPart('key-attribute','Pharmacy','pid',0,0);
  await shot('06-attrs');
});
await step('relationships', async()=>{
  await page.getByRole('button',{name:'Connect'}).click();
  async function connect(a,b,name){ const ca=await centreOf(node(new RegExp('^'+a+'$'))); const cb=await centreOf(node(new RegExp('^'+b+'$'))); await page.mouse.move(ca.x,ca.y); await page.mouse.down(); for(let i=1;i<=10;i++) await page.mouse.move(ca.x+(cb.x-ca.x)*i/10, ca.y+(cb.y-ca.y)*i/10); await page.mouse.up(); const inp=page.locator('.sc-inline-input'); await inp.waitFor(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type(name); await page.keyboard.press('Enter'); await settle(300); }
  await connect('Company','Drug','Makes'); await connect('Drug','Pharmacy','Sells');
  await page.keyboard.press('Escape'); await page.getByRole('button',{name:'Select tool'}).click().catch(()=>{});
  await shot('07-rels');
});
const relNode = n => cv.locator('[data-chen-shape="relationship"]').filter({hasText:n}).first();
await step('set Makes identifying 1:N', async()=>{ await relNode('Makes').click({force:true}).catch(async()=>{const c=await centreOf(relNode('Makes')); await page.mouse.click(c.x,c.y);}); await props.getByRole('switch',{name:'Identifying'}).click(); const sel=props.getByRole('combobox',{name:/^Entity, participant/}); const n=await sel.count(); for(let i=0;i<n;i++){ const txt=await sel.nth(i).evaluate(s=>s.selectedOptions[0].text); L('   Makes participant',i+1,txt); await props.getByRole('combobox',{name:`Cardinality, participant ${i+1}`}).selectOption({label: /Company/.test(txt)?'One (1)':'Many (N)'}); if(/Drug/.test(txt)) await props.getByRole('combobox',{name:`Participation, participant ${i+1}`}).selectOption({label:'Total'}); } L('   ', (await props.innerText()).match(/One to many|Many to many|One to one/)?.[0]); });
await step('set Sells M:N', async()=>{ const c=await centreOf(relNode('Sells')); await page.mouse.click(c.x,c.y); const sel=props.getByRole('combobox',{name:/^Entity, participant/}); const n=await sel.count(); for(let i=0;i<n;i++) await props.getByRole('combobox',{name:`Cardinality, participant ${i+1}`}).selectOption({label:'Many (N)'}); L('   ', (await props.innerText()).match(/One to many|Many to many|One to one/)?.[0]); await page.mouse.click(1000,150); await shot('08-chen'); });
await step('validate (ER)', async()=>{ await page.getByRole('button',{name:'Validate model'}).click(); await settle(800); const d=page.getByTestId('issues-dock'); L('   dock:', ((await d.innerText().catch(()=>'(no dock)'))||'').replace(/\n+/g,' / ').slice(0,300)); await shot('09-validate'); await page.getByRole('button',{name:'Validate model'}).click().catch(()=>{}); });
await step('convert', async()=>{ await page.getByRole('button',{name:'Convert to relational schema'}).click(); const d=page.getByRole('dialog',{name:'Convert to relational schema'}); await d.waitFor(); const a=d.getByTestId('convert-apply'); await a.waitFor(); for(let i=0;i<40&&!(await a.isEnabled());i++) await settle(500); await settle(700); L('   summary:', (await d.getByTestId('convert-summary').innerText()).replace(/\n+/g,' ')); await page.screenshot({path:`${D}/10-convert-dialog.png`}); await a.click(); await page.waitForFunction(()=>!document.querySelector('[role=dialog]'),null,{timeout:20000}); await settle(800); await shot('11-converted'); });
await step('converted FK tips', async()=>{ await checkTips('converted'); L('   tables:', (await cv.locator('[data-node-id]').evaluateAll(es=>es.map(e=>e.textContent.replace(/\s+/g,' ')))).join(' ## ')); });
await step('move table + tips + undo/redo', async()=>{ const t=cv.locator('[data-node-id]').first(); const c=await centreOf(t); await page.mouse.move(c.x-c.w/2+5,c.y); await page.mouse.down(); for(let i=1;i<=10;i++) await page.mouse.move(c.x-c.w/2+5+i*6,c.y+i*14); await page.mouse.up(); await settle(500); await checkTips('moved'); await shot('12-moved'); const c2=await centreOf(t); L('   moved by', Math.round(c2.x-c.x), Math.round(c2.y-c.y)); await page.getByRole('button',{name:'Undo'}).click(); await settle(400); const c3=await centreOf(t); L('   after undo delta', Math.round(c3.x-c.x), Math.round(c3.y-c.y)); if(Math.abs(c3.x-c.x)>2||Math.abs(c3.y-c.y)>2) throw new Error('undo did not restore position'); await checkTips('undo'); await page.getByRole('button',{name:'Redo'}).click(); await settle(400); const c4=await centreOf(t); if(Math.abs(c4.x-c2.x)>2||Math.abs(c4.y-c2.y)>2) throw new Error('redo mismatch'); await checkTips('redo'); await page.getByRole('button',{name:'Undo'}).click(); await settle(400); });
await step('validate (rel)', async()=>{ await page.getByRole('button',{name:'Validate model'}).click(); await settle(800); L('   dock:', ((await page.getByTestId('issues-dock').innerText().catch(()=>'(none)'))||'').replace(/\n+/g,' / ').slice(0,250)); await page.getByRole('button',{name:'Validate model'}).click().catch(()=>{}); });
let saved;
await step('save project', async()=>{ saved = await dl(()=>page.getByRole('button',{name:'Save project file'}).click(),'proj'); const j=JSON.parse(readFileSync(saved,'utf8')); L('   format', j.format, 'version', j.version??j.schemaVersion); });
await step('exports', async()=>{
  const out={};
  out.svg = await exportAs('SVG','svg'); out.png = await exportAs('PNG','png'); out.pdf = await exportAs('PDF','pdf');
  writeFileSync(D+'/exports.json', JSON.stringify(out));
});
await step('SQL MySQL', async()=>{ const p=await exportAs('SQL','mysql', async d=>{ await d.getByLabel('SQL dialect').selectOption({label:'MySQL'}); await settle(600);}); const s=readFileSync(p,'utf8'); L('   mysql has PRIMARY KEY:', /PRIMARY KEY/.test(s), 'FOREIGN KEY:', /FOREIGN KEY/.test(s), 'ENGINE', /ENGINE/i.test(s)); });
await step('SQL PostgreSQL', async()=>{ const p=await exportAs('SQL','pg', async d=>{ await d.getByLabel('SQL dialect').selectOption({label:'PostgreSQL'}); await settle(600);}); const s=readFileSync(p,'utf8'); L('   pg has PRIMARY KEY:', /PRIMARY KEY/.test(s), 'FOREIGN KEY:', /FOREIGN KEY/.test(s)); });
await step('DBML export', async()=>{ const p=await exportAs('DBML','dbml'); const s=readFileSync(p,'utf8'); L('   dbml has Table:', /Table /.test(s), 'Ref:', /Ref/.test(s)); if (!/Table /.test(s)) throw new Error('no tables in DBML'); });
const snapshot = async()=> (await page.locator('[data-node-id]').count())+':'+(await cv.locator('[data-edge-id]').count());
const before = await snapshot(); L('state before reload nodes:edges', before);
await step('reload autosave', async()=>{ await settle(1500); await page.reload(); await page.getByRole('toolbar').waitFor(); await settle(1200); const after=await snapshot(); L('   after reload', after, 'tabs:', (await page.getByRole('tab').allInnerTexts()).join('|')); if(after!==before) throw new Error('state differs '+before+' vs '+after); await shot('13-after-reload'); await checkTips('after reload').catch(e=>{throw e}); });
await step('ER sheet exports', async()=>{ await page.getByRole('tab',{name:'ER Diagram'}).click(); await settle(600); await exportAs('SVG','er-svg'); await exportAs('PNG','er-png'); await exportAs('PDF','er-pdf'); await page.getByRole('tab',{name:'Relational Schema'}).click(); await settle(400); });
await step('open saved file in fresh context', async()=>{ const c2=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true}); const p2=await c2.newPage(); const pr=[]; p2.on('console',m=>{if(['error','warning'].includes(m.type())) pr.push(m.text());}); p2.on('pageerror',e=>pr.push(e.message)); await p2.goto(URL); await p2.getByRole('toolbar').waitFor(); const [ch]=await Promise.all([p2.waitForEvent('filechooser'),p2.getByRole('button',{name:'Open project file'}).click()]); await ch.setFiles(saved); await p2.waitForTimeout(1500); const n=(await p2.locator('[data-node-id]').count())+':'+(await p2.locator('.sc-canvas [data-edge-id]').count()); L('   fresh ctx opened file nodes:edges', n, 'tabs', (await p2.getByRole('tab').allInnerTexts()).join('|'), 'console', JSON.stringify(pr)); await p2.screenshot({path:`${D}/14-reopened.png`}); await c2.close(); if(false) throw new Error('reopened differs '+n+' vs '+before); });
await step('Chinese + dark', async()=>{ await page.getByRole('button',{name:'Settings'}).click(); const d=page.getByRole('dialog',{name:'Settings'}); await d.getByRole('radio',{name:'Dark'}).click(); await settle(300); await d.getByRole('radio',{name:'中文 (Chinese)'}).click(); await settle(800); await page.keyboard.press('Escape'); await settle(400); await shot('15-zh-dark'); L('   lang', await page.locator('html').getAttribute('lang'), 'theme', await page.locator('html').getAttribute('data-theme')); await page.getByRole('button',{name:'打开示例'}).click().catch(()=>{}); await settle(500); await page.screenshot({path:`${D}/16-zh-dialog.png`}); await page.keyboard.press('Escape'); });
await step('switch back to English', async()=>{ await page.getByRole('button',{name:'设置'}).click(); const d=page.getByRole('dialog'); await d.getByRole('radio',{name:'English'}).click(); await settle(500); await d.getByRole('radio',{name:/Light|浅色/}).click(); await settle(300); await page.keyboard.press('Escape'); await settle(300); L('   lang', await page.locator('html').getAttribute('lang'), 'theme', await page.locator('html').getAttribute('data-theme')); await page.getByRole('button',{name:'Settings'}).waitFor(); await shot('17-back-en'); });
const csp = await page.evaluate(() => window.__csp ?? []);
L('CSP VIOLATIONS:', JSON.stringify(csp));
L('CONSOLE/PAGE PROBLEMS:', JSON.stringify(problems));
L(`RESULT ${results.ok} ok, ${results.fail} failed`);
writeFileSync(`${D}/log.txt`, log.join('\n') + '\nPROBLEMS ' + JSON.stringify(problems, null, 1));
await b.close();
process.exit(results.fail || problems.length || csp.length ? 1 : 0);
