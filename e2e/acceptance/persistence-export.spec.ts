/**
 * The product specification section 11 "Persistence" and "Exports" for all five examples (A to E), through the UI:
 * save -> reload (autosave) -> clear site data -> import the downloaded file; SVG / PNG / PDF from the Export dialog,
 * checked on the DOWNLOADED bytes; the exported SVG pixel-compared with the editor.
 *
 *   E2E_PORT=5232 npx playwright test e2e/acceptance/persistence-export.spec.ts --output=.tmp/acceptance/results
 */
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import {
  OUT,
  analyseChenSvg,
  canvasBox,
  cellLocator,
  col,
  comparable,
  decodePng,
  exportVia,
  expect,
  expectTipsOnTargets,
  fkStrings,
  fkTips,
  inspectPdf,
  modelOf,
  nodeBoxes,
  nodeIdOfRelation,
  openApp,
  openExample,
  openProjectFile,
  properties,
  relation,
  relationalDiagram,
  saveProject,
  settle,
  sheet,
  shot,
  svgPaintedBox,
  switchSheet,
  test,
  type PProject,
} from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

const EXAMPLES: Array<{ id: string; title: string; relations: string[]; fks: number; entityNames: string[] }> = [
  { id: 'A', title: 'Composite and multivalued attributes', relations: ['Student', 'Student_ProgrammingLanguages', 'Student_Preference'], fks: 2, entityNames: ['Student'] },
  { id: 'B', title: 'Weak entity', relations: ['Company', 'Drug'], fks: 1, entityNames: ['Company', 'Drug', 'Makes'] },
  { id: 'C', title: 'Recursive 1:N', relations: ['Employee'], fks: 1, entityNames: ['Employee', 'Manages'] },
  { id: 'D', title: 'Recursive M:N', relations: ['Course', 'PreReq'], fks: 2, entityNames: ['Course', 'PreReq'] },
  { id: 'E', title: 'Pharmacy system', relations: ['Company', 'Contact', 'Doctor', 'Drug', 'Patient', 'Pharmacy', 'Prescription', 'Sell'], fks: 9, entityNames: ['Doctor', 'Patient', 'Pharmacy', 'Company', 'Drug', 'Contact', 'Sell', 'Prescription'] },
];

const slug = (s: string): string => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

/** What the user SEES on the current sheet, independent of zoom / pan: shapes, labels, roles, connector pairs. */
async function sheetSignature(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const cv = document.querySelector('.sc-canvas')!;
    const nodes = [...cv.querySelectorAll<SVGGElement>('[data-node-id]')].map((g) => ({
      kind: g.getAttribute('data-node-kind'),
      text: [...g.querySelectorAll('text')].map((t) => t.textContent).join('|'),
      shape: g.querySelector('[data-chen-shape]')?.getAttribute('data-chen-shape') ?? 'table',
      attrs: ['data-weak', 'data-identifying', 'data-multivalued', 'data-derived', 'data-key'].map((a) => g.querySelector(`[${a}]`)?.getAttribute(a) ?? '-').join(','),
      roles: [...g.querySelectorAll('[data-role]')].map((c) => c.getAttribute('data-role')).join(','),
      parts: g.querySelectorAll('rect,ellipse,polygon,line').length,
    }));
    const edges = [...cv.querySelectorAll<SVGGElement>('[data-edge-id]')].map((g) => ({
      kind: g.getAttribute('data-edge-kind'),
      pairs: [...g.querySelectorAll('[data-fk-branch]')].map((b) => `${b.getAttribute('data-fk-branch')}>${b.getAttribute('data-fk-target')}`).join(','),
      line: g.querySelector('[data-chen-line]')?.getAttribute('data-double') ?? '-',
      polylines: g.querySelectorAll('polyline').length,
    }));
    const key = (o: unknown): string => JSON.stringify(o);
    return { nodes: nodes.map(key).sort(), edges: edges.map(key).sort() };
  });
}

async function wipeSiteData(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.map((db) => new Promise<void>((res) => { const r = indexedDB.deleteDatabase(db.name!); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
  });
  await page.goto('about:blank');
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
}

// =====================================================================================================================
test.describe('Persistence: save, autosave restore, import', () => {
  for (const ex of EXAMPLES) {
    test(`${ex.id} ${ex.title}: semantics, positions, shapes and connectors survive reload and import`, async ({ app: page }) => {
      await openApp(page);
      await openExample(page, ex.title);

      // a user edit on top of the example: move something on the relational sheet, widen a cell, rename the project
      await switchSheet(page, 'Relational schema');
      await page.keyboard.press('ControlOrMeta+0');
      await settle(page, 400);
      const p0 = (await saveProject(page)).file.project;
      const d0 = relationalDiagram(p0);
      const m0 = modelOf(p0, d0);
      const first = Object.values(m0.relations!)[0]!;
      const cell = await (async () => {
        const r = await cellLocator(page, first.columns[0]!.id).evaluate((e) => { const q = e.querySelector('rect,polygon')!.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
        return r;
      })();
      await page.mouse.move(cell.x, cell.y);
      await page.mouse.down();
      await page.mouse.move(cell.x + 40, cell.y + 60, { steps: 8 });
      await page.mouse.up();
      await settle(page, 300);
      await switchSheet(page, 'ER diagram');
      await settle(page, 300);
      const chenSigBefore = await sheetSignature(page);
      await switchSheet(page, 'Relational schema');
      await settle(page, 300);
      const relSigBefore = await sheetSignature(page);
      await expectTipsOnTargets(page, ex.fks);

      // --- save (download) ---
      const saved = await saveProject(page);
      expect(saved.dl.name).toMatch(/\.schemacanvas\.json$/);
      await expect(page.getByText('Saved in this browser')).toBeVisible({ timeout: 10_000 });
      await settle(page, 800);

      // semantic constraints in the file
      const rel = modelOf(saved.file.project, relationalDiagram(saved.file.project));
      expect(Object.values(rel.relations!).map((r) => r.name).sort()).toEqual([...ex.relations].sort());
      expect(fkStrings(rel)).toHaveLength(ex.fks);
      expect(saved.file.schemaVersion).toBe(1);
      // the moved table is stored at a different position than in the example (p0 was saved before the drag)
      const movedNode = relationalDiagram(saved.file.project).nodes[nodeIdOfRelation(d0, first.id)]!;
      const orig = d0.nodes[nodeIdOfRelation(d0, first.id)]!;
      expect([movedNode.x, movedNode.y], 'the user drag is part of the saved file').not.toEqual([orig.x, orig.y]);

      // --- reload: autosave restores the same project, the same drawing ---
      await page.reload();
      await expect(page.getByRole('toolbar')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Relational schema' })).toBeVisible();
      await settle(page, 500);
      const afterReload = (await saveProject(page)).file.project;
      expect(comparable(afterReload)).toEqual(comparable(saved.file.project));
      await switchSheet(page, 'Relational schema');
      expect(await sheetSignature(page)).toEqual(relSigBefore);
      await switchSheet(page, 'ER diagram');
      expect(await sheetSignature(page)).toEqual(chenSigBefore);

      // --- clear site data, import the downloaded file through the file chooser ---
      await wipeSiteData(page);
      await expect(page.getByRole('tab', { name: 'Relational schema' })).toHaveCount(0);
      await openProjectFile(page, saved.dl.path);
      await expect(page.getByRole('tab', { name: 'Relational schema' })).toBeVisible();
      await settle(page, 500);
      const imported = (await saveProject(page)).file.project;
      expect(comparable(imported), `${ex.title}: models, node positions, sizes, column widths, routes, conversion record`).toEqual(comparable(saved.file.project));
      await switchSheet(page, 'Relational schema');
      expect(await sheetSignature(page)).toEqual(relSigBefore);
      await expectTipsOnTargets(page, ex.fks);
      await switchSheet(page, 'ER diagram');
      expect(await sheetSignature(page)).toEqual(chenSigBefore);
      await shot(page, `persist-${slug(ex.title)}-chen`);
    });
  }

  test('a manually routed connector (Pharmacy) keeps its route, anchors and referenced cell through save and import', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Pharmacy system', 'relational');
    await page.keyboard.press('Shift+1');
    await settle(page, 400);
    const p0 = (await saveProject(page)).file.project;
    const d0 = relationalDiagram(p0);
    const m0 = modelOf(p0, d0);
    const patient = relation(m0, 'Patient');
    const doctor = relation(m0, 'Doctor');
    const src = col(patient, 'DoctorSSN').id;
    // select the Patient.DoctorSSN -> Doctor.SSN connector by clicking it
    const pt = await page.evaluate((cid) => {
      const g = [...document.querySelectorAll('.sc-canvas [data-edge-id]')].find((e) => e.querySelector(`[data-fk-branch="${cid}"]`))!;
      const el = g.querySelector('polyline') as SVGPolylineElement;
      const p = el.getPointAtLength(el.getTotalLength() * 0.5);
      const m = el.getScreenCTM()!;
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f, id: g.getAttribute('data-edge-id')! };
    }, src);
    await page.mouse.click(pt.x, pt.y);
    const props = properties(page);
    await expect(props.getByText('Patient.DoctorSSN → Doctor.SSN').first()).toBeVisible();
    await props.getByRole('radio', { name: 'Manual' }).click();
    await props.getByRole('combobox', { name: 'Side' }).first().selectOption({ label: 'Top' }); // start anchor (horizontal tables offer top / bottom)
    await props.getByRole('combobox', { name: 'Side' }).nth(1).selectOption({ label: 'Bottom' }); // end anchor
    await settle(page, 400);
    await expectTipsOnTargets(page, 9);
    const saved = await saveProject(page);
    const dS = relationalDiagram(saved.file.project);
    const edge = Object.values(dS.edges).find((e) => e.ref.kind === 'foreignKey' && Object.values(modelOf(saved.file.project, dS).foreignKeys!).find((f) => f.id === e.ref.foreignKeyId)?.columns[0]?.sourceColumnId === src)!;
    expect(edge.route.mode).toBe('manual');
    expect((edge.route as any).sourceAnchor?.side).toBe('top');
    expect((edge.route as any).targetAnchor?.side).toBe('bottom');
    const before = (await fkTips(page, { edgeId: pt.id }))[0]!;
    expect(before.target).toBe(col(doctor, 'SSN').id);

    // reload (autosave) and import: same route, same referenced cell. The autosave is debounced (500 ms) + an IndexedDB write.
    await settle(page, 1500);
    await page.reload();
    await expect(page.getByRole('toolbar')).toBeVisible();
    await settle(page, 600);
    const afterReload = (await saveProject(page)).file.project;
    expect(comparable(afterReload)).toEqual(comparable(saved.file.project));
    await wipeSiteData(page);
    await openProjectFile(page, saved.dl.path);
    await expect(page.getByRole('tab', { name: 'Relational schema' })).toBeVisible();
    await switchSheet(page, 'Relational schema');
    await settle(page, 400);
    const imported = (await saveProject(page)).file.project;
    expect(comparable(imported)).toEqual(comparable(saved.file.project));
    await expectTipsOnTargets(page, 9);
    const t = (await fkTips(page)).find((x) => x.source === src)!;
    expect(t.target).toBe(col(doctor, 'SSN').id);
    await shot(page, 'persist-manual-route');
  });
});

// =====================================================================================================================
test.describe('Exports: SVG, PNG and PDF of every example, ER and relational sheets', () => {
  mkdirSync(`${OUT}/exports`, { recursive: true });

  async function checkAllFormats(page: Page, label: string, expectTexts: string[], opts: { relational: boolean }): Promise<void> {
    const svg = await exportVia(page, 'SVG');
    expect(svg.name).toMatch(/\.svg$/);
    const box = await svgPaintedBox(page, svg.text());
    expect(box.parsed, `${label}: SVG parses`).toBe(true);
    // no painted pixel outside the viewBox (nothing clipped), and a real margin around the drawing
    expect(box.painted.x, `${label}: left`).toBeGreaterThanOrEqual(box.viewBox.x - 0.5);
    expect(box.painted.y, `${label}: top`).toBeGreaterThanOrEqual(box.viewBox.y - 0.5);
    expect(box.painted.x + box.painted.w, `${label}: right`).toBeLessThanOrEqual(box.viewBox.x + box.viewBox.w + 0.5);
    expect(box.painted.y + box.painted.h, `${label}: bottom`).toBeLessThanOrEqual(box.viewBox.y + box.viewBox.h + 0.5);
    expect(box.painted.x - box.viewBox.x, `${label}: padding left`).toBeGreaterThan(8);
    expect(box.painted.y - box.viewBox.y, `${label}: padding top`).toBeGreaterThan(8);
    for (const t of expectTexts) expect(box.texts, `${label}: SVG text ${t}`).toContain(t);
    expect(svg.text()).toMatch(/^<\?xml/);
    expect(svg.text()).toContain('<title>');
    copyFileSync(svg.path, `${OUT}/exports/${slug(label)}.svg`);

    const png = await exportVia(page, 'PNG');
    const pi = await decodePng(page, png.bytes);
    expect(pi.width, `${label}: PNG width = ceil(viewBox x 2)`).toBe(Math.ceil(box.viewBox.w * 2));
    expect(pi.height, `${label}: PNG height`).toBe(Math.ceil(box.viewBox.h * 2));
    expect(pi.edgeNonWhite, `${label}: PNG outer frame untouched`).toBe(0);
    expect(pi.transparentPixels, `${label}: white background, no transparency`).toBe(0);
    expect(pi.inkBox.x).toBeGreaterThan(10);
    expect(pi.inkBox.y).toBeGreaterThan(10);
    expect(pi.inkBox.x + pi.inkBox.w).toBeLessThan(pi.width - 10);
    expect(pi.inkBox.y + pi.inkBox.h).toBeLessThan(pi.height - 10);
    // the ink covers the drawing: its box matches the painted box of the SVG (x2) within a few pixels
    expect(Math.abs(pi.inkBox.x - (box.painted.x - box.viewBox.x) * 2)).toBeLessThan(8);
    expect(Math.abs(pi.inkBox.w - box.painted.w * 2)).toBeLessThan(10);
    expect(Math.abs(pi.inkBox.h - box.painted.h * 2)).toBeLessThan(10);
    copyFileSync(png.path, `${OUT}/exports/${slug(label)}.png`);

    const pdf = await exportVia(page, 'PDF');
    const info = inspectPdf(pdf.bytes);
    expect(info.header, `${label}: PDF header`).toBe('%PDF-');
    expect(info.mediaBox, `${label}: MediaBox`).toHaveLength(4);
    const pw = info.mediaBox[2]! - info.mediaBox[0]!;
    const ph = info.mediaBox[3]! - info.mediaBox[1]!;
    expect(pw / ph, `${label}: page aspect ratio follows the drawing`).toBeCloseTo(box.viewBox.w / box.viewBox.h, 1);
    expect(info.imageCount, `${label}: vector, not raster`).toBe(0);
    for (const t of expectTexts.filter((x) => /^[\x20-\x7e]+$/.test(x))) expect(info.text, `${label}: PDF selectable text ${t}`).toContain(t);
    copyFileSync(pdf.path, `${OUT}/exports/${slug(label)}.pdf`);
    if (process.platform === 'darwin' && label.endsWith('E relational')) {
      const out = `${OUT}/exports/${slug(label)}-pdf.png`;
      execFileSync('sips', ['-s', 'format', 'png', pdf.path, '--out', out]);
      expect(statSync(out).size).toBeGreaterThan(1000);
    }
    for (const f of [svg, png, pdf]) expect(statSync(f.path).size).toBeGreaterThan(500);
  }

  for (const ex of EXAMPLES) {
    test(`${ex.id} ${ex.title}: SVG / PNG / PDF of the relational sheet and of the Chen sheet`, async ({ app: page }) => {
      await openApp(page);
      await openExample(page, ex.title, 'relational');
      await page.keyboard.press('Shift+1');
      await settle(page, 500);
      await checkAllFormats(page, `${ex.id} relational`, ex.relations, { relational: true });
      await switchSheet(page, 'ER diagram');
      await page.keyboard.press('Shift+1');
      await settle(page, 500);
      await checkAllFormats(page, `${ex.id} chen`, ex.entityNames, { relational: false });
    });
  }

  test('the exported Chen SVG carries the correct notation for the weak-entity example', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Weak entity');
    const svg = await exportVia(page, 'SVG');
    const f = await analyseChenSvg(page, svg.text());
    const model = Object.values((await saveProject(page)).file.project.models).find((m) => m.kind === 'er')!;
    const totals = Object.values(model.relationships!).flatMap((r) => r.participants).filter((q) => q.participation === 'total').length;
    expect(f.doubleRects).toBe(1);
    expect(f.doubleDiamonds).toBe(1);
    expect(f.doubleLines, 'one double line per TOTAL participation').toBe(totals);
    expect(totals).toBeGreaterThanOrEqual(1);
    expect(f.underlines.filter((u) => !u.dashed).map((u) => u.text)).toEqual(['name']);
    expect(f.underlines.filter((u) => u.dashed).map((u) => u.text)).toEqual(['TradeName']);
  });

  test('options: transparent background PNG, selection-only export and the Project-file export round-trip', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Weak entity', 'relational');
    const svg = await exportVia(page, 'SVG', async (dlg) => {
      await dlg.getByRole('radio', { name: 'Transparent' }).click();
    });
    expect(svg.text()).not.toMatch(/<rect[^>]*fill="#fff(fff)?"[^>]*width="100%"/);
    const png = await exportVia(page, 'PNG', async (dlg) => {
      await dlg.getByRole('radio', { name: 'Transparent' }).click();
    });
    const pi = await decodePng(page, png.bytes);
    expect(pi.transparentPixels, 'transparent PNG has transparent pixels').toBeGreaterThan(pi.width * pi.height * 0.3);
    expect(pi.corner[3]).toBe(0);
    // project-file export from the dialog equals the toolbar save
    const viaDialog = await exportVia(page, 'Project file');
    const viaToolbar = await saveProject(page);
    expect(comparable(JSON.parse(viaDialog.text()).project as PProject)).toEqual(comparable(viaToolbar.file.project));
  });
});

// =====================================================================================================================
test.describe('Exports match the editor', () => {
  test('SVG render vs. a screenshot of the same diagram region (tolerance on anti-aliasing)', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Weak entity', 'relational');
    // clean surface: no grid, nothing selected, mouse away from the sheet
    await page.keyboard.press('ControlOrMeta+0');
    await settle(page, 400);
    await properties(page).getByRole('switch', { name: 'Show grid' }).click();
    await page.mouse.move(5, 5);
    await settle(page, 400);
    const zoom = Number(await sheet(page).getAttribute('data-zoom'));
    expect(zoom).toBeCloseTo(1, 2);

    // the editor's drawing: union of tables and connectors in client px
    const region = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.sc-canvas [data-node-id], .sc-canvas [data-edge-id]')];
      let l = Infinity;
      let t = Infinity;
      let r = -Infinity;
      let b = -Infinity;
      for (const e of els) {
        const q = e.getBoundingClientRect();
        l = Math.min(l, q.left);
        t = Math.min(t, q.top);
        r = Math.max(r, q.right);
        b = Math.max(b, q.bottom);
      }
      return { x: l, y: t, w: r - l, h: b - t };
    });
    const margin = 16;
    const clip = { x: Math.floor(region.x - margin), y: Math.floor(region.y - margin), width: Math.ceil(region.w + 2 * margin), height: Math.ceil(region.h + 2 * margin) };
    const editorPng = await page.screenshot({ clip });

    const svg = await exportVia(page, 'SVG');
    const info = await svgPaintedBox(page, svg.text());
    // place the SVG so that its painted union lands on the editor's union at the same scale
    const result = await (await page.context().newPage()).evaluate(
      async ([svgText, png64, clipW, clipH, regionX, regionY, clipX, clipY, vbx, vby, vbw, vbh, px, py, z]) => {
        const loadImg = (src: string): Promise<HTMLImageElement> => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
        const ed = await loadImg(`data:image/png;base64,${png64}`);
        const sv = await loadImg(URL.createObjectURL(new Blob([svgText as string], { type: 'image/svg+xml;charset=utf-8' })));
        const W = clipW as number;
        const H = clipH as number;
        const a = document.createElement('canvas');
        a.width = W;
        a.height = H;
        const ga = a.getContext('2d')!;
        ga.fillStyle = '#fff';
        ga.fillRect(0, 0, W, H);
        ga.drawImage(ed, 0, 0, W, H);
        const b = document.createElement('canvas');
        b.width = W;
        b.height = H;
        const gb = b.getContext('2d')!;
        gb.fillStyle = '#fff';
        gb.fillRect(0, 0, W, H);
        // svg user unit -> editor client px: painted union origin (px,py) in the viewBox maps to (regionX, regionY)
        const zz = z as number;
        const ox = (regionX as number) - (clipX as number) - ((px as number) - (vbx as number)) * zz;
        const oy = (regionY as number) - (clipY as number) - ((py as number) - (vby as number)) * zz;
        gb.drawImage(sv, ox, oy, (vbw as number) * zz, (vbh as number) * zz);
        const da = ga.getImageData(0, 0, W, H).data;
        const db = gb.getImageData(0, 0, W, H).data;
        const dark = (d: Uint8ClampedArray, x: number, y: number): number => {
          if (x < 0 || y < 0 || x >= W || y >= H) return 255;
          const i = (y * W + x) * 4;
          return Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
        };
        // a dark pixel of one image must have a dark-ish pixel within 2 px in the other (tolerates sub-pixel placement and AA)
        let ink = 0;
        let miss = 0;
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            for (const [p, q] of [[da, db], [db, da]] as const) {
              if (dark(p, x, y) < 110) {
                ink++;
                let ok = false;
                for (let dy = -2; dy <= 2 && !ok; dy++) for (let dx = -2; dx <= 2 && !ok; dx++) if (dark(q, x + dx, y + dy) < 190) ok = true;
                if (!ok) miss++;
              }
            }
          }
        return { ink, miss };
      },
      [svg.text(), editorPng.toString('base64'), clip.width, clip.height, region.x, region.y, clip.x, clip.y, info.viewBox.x, info.viewBox.y, info.viewBox.w, info.viewBox.h, info.painted.x, info.painted.y, zoom] as const,
    );
    expect(result.ink).toBeGreaterThan(1500);
    expect(result.miss / result.ink, `${result.miss} of ${result.ink} dark pixels have no counterpart: export and editor must agree`).toBeLessThan(0.04);
    mkdirSync(`${OUT}/exports`, { recursive: true });
    copyFileSync(svg.path, `${OUT}/exports/match-editor.svg`);
    await shot(page, 'export-match-editor');
    void canvasBox;
    void nodeBoxes;
    void settle;
  });
});
