#!/usr/bin/env node
/* Invoice-parser regression harness — runs the REAL pdf.js + js/parsers.js
 * against the sample invoices in data/samples/ and checks item counts and
 * that line totals reconcile with each invoice's own "Items Subtotal".
 *
 * Usage: node web/tests/parsers-harness.node.js   (from the repo root, any cwd works)
 *
 * Ground truth established 2026-07-18 against the order-page copy
 * (us709058300259012609.docx): 39 line items incl. B-XC011, which the old
 * heuristic parser dropped at the page 4→5 boundary.
 */

const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '..');
globalThis.window = globalThis;
require(path.join(WEB, 'js/vendor/pdf.min.js'));
const pdfjsLib = globalThis.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(WEB, 'js/vendor/pdf.worker.min.js');

const parserSrc = fs.readFileSync(path.join(WEB, 'js/parsers.js'), 'utf8');
const InvoiceParsers = new Function(parserSrc + '\nreturn InvoiceParsers;')();

const CASES = [
  // file (in data/samples/), expected item count, expected items-subtotal, spot checks
  ['us709058300259012609.pdf', 39, 263.70, [
    // page-boundary item the old parser dropped; cables classify electronic
    { sku: 'B-XC011', line_total: 1.97, name: '200mm Servo Extension Cable 3Pin',
      description: 'Pack of 2', category: 'electronic' },
    // bold name spans 2 cells; variant is the fuller product name
    { sku: 'B-PG002', name: '9g Continuous Rotation Digital Servo-360°', category: 'motor' },
    // absorbed XC011's total before the rewrite; part codes suffix
    { sku: 'B-EA005', line_total: 1.64, name: 'Steel Deep Groove Ball Bearings 6704ZZ' },
    // normalized hygiene: no space before mm, singular Spring/Pin
    { sku: 'B-BA001', name: '0.4x3x10mm Extension Spring' },
    { sku: 'B-DA007', name: '2x6mm Stainless Steel Dowel Pin' },
    { sku: 'B-LA003', quantity: 4, unit_price: 6.29, discount: 2.8, name: 'N20 Reduction Gear Motor 400rpm' },
    // screw naming convention + real category key + pack description
    { sku: 'B-AA044', name: 'M2x8 BHCS Machine Screw', category: 'screws', description: 'Pack of 20', quantity: 4 },
    { sku: 'B-AA221', name: 'BT3x5 BHCS Self Tapping Screw', category: 'screws' },
  ]],
  ['us672445425223245825.pdf', 30, 689.65, [
    { sku: 'B-XC003', quantity: 4, line_total: 4.8, category: 'electronic' },  // dropped by the old parser
    { sku: 'MH011', line_total: 12.6 },
    // compatibility-list variants go to the description, not the name
    { sku: 'FAZ013-N', name: 'Bambu 4-in-1 PTFE Adapter', category: 'printer_accessory',
      description: 'X1 Series/P1 Series/H2 Series/P2S' },
    { sku: 'B-KA008', name: '200x1mm COB LED Strip Light', category: 'electronic' },
  ]],
  ['amazon_order_sample.pdf', 5, null, []],
];

(async () => {
  let fails = 0;
  const check = (cond, msg) => { if (!cond) { console.log('  ❌ ' + msg); fails++; } };

  for (const [file, count, subtotal, spots] of CASES) {
    const p = path.join(WEB, 'data/samples', file);
    if (!fs.existsSync(p)) { console.log(`⏭  ${file} not present, skipping`); continue; }
    const data = new Uint8Array(fs.readFileSync(p));
    const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
    const inv = InvoiceParsers.parse(await InvoiceParsers.extractFromPdf(pdf));
    const sum = inv.line_items.reduce((a, li) => a + (li.line_total ?? (li.unit_price ?? 0) * li.quantity), 0);
    console.log(`${file}: ${inv.line_items.length} items, sum $${sum.toFixed(2)}, warnings: ${inv.warnings?.length || 0}`);

    check(inv.line_items.length === count, `expected ${count} items, got ${inv.line_items.length}`);
    if (subtotal != null) {
      check(Math.abs(sum - subtotal) <= 0.011, `expected sum $${subtotal}, got $${sum.toFixed(2)}`);
      check(!(inv.warnings || []).length, `unexpected warnings: ${JSON.stringify(inv.warnings)}`);
    }
    for (const spot of spots) {
      const li = inv.line_items.find((x) => x.sku === spot.sku);
      check(li, `missing item ${spot.sku}`);
      if (!li) continue;
      for (const [k, v] of Object.entries(spot)) {
        if (k === 'sku') continue;
        check(li[k] === v, `${spot.sku}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(li[k])}`);
      }
    }
  }
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
