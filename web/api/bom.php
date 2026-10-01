<?php
/**
 * BOM parts checker — ports POST /api/import/check-bom matching logic.
 * The .xlsx is parsed client-side (SheetJS); this endpoint receives the
 * parsed BOM rows and matches them against inventory in three tiers:
 * exact SKU, exact name (incl. original_import_name), fuzzy name ≥85%.
 *
 * POST bom.php — {project_name?, model_id?, items: [{product_id, name, quantity, note, is_filament}]}
 *   → {project_name, model_id, summary: {in_stock, partial, missing, total}, items: [...]}
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

if (method() !== 'POST') {
    fail('Method not allowed', 405);
}

$req = input_json();
$bomItems = $req['items'] ?? [];
if (!is_array($bomItems) || !$bomItems) {
    fail('items array is required');
}

// All inventory rows with the fields the matcher needs
$rows = $pdo->query("
    SELECT i.id, i.name, i.sku, i.category, i.quantity, i.unit,
           COALESCE(i.original_import_name, '') AS original_import_name
    FROM items i
")->fetchAll();

$bySku = [];
$byName = [];
foreach ($rows as $r) {
    if ($r['sku']) {
        $bySku[strtolower(trim($r['sku']))][] = $r;
    }
    $byName[strtolower(trim($r['name']))][] = $r;
    if ($r['original_import_name']) {
        $byName[strtolower(trim($r['original_import_name']))][] = $r;
    }
}

$results = [];
$inStock = 0;
$partial = 0;
$missing = 0;

foreach ($bomItems as $bi) {
    $name = trim((string) ($bi['name'] ?? ''));
    if ($name === '') {
        continue;
    }
    $pid = strtolower(trim((string) ($bi['product_id'] ?? '')));
    $bomName = strtolower($name);
    $qtyNeeded = max(1, (int) ($bi['quantity'] ?? 1));

    $match = null;
    $matchType = null;
    $confidence = 0.0;

    // 1. Exact SKU
    if ($pid !== '' && isset($bySku[$pid])) {
        $match = $bySku[$pid][0];
        $matchType = 'sku_exact';
        $confidence = 1.0;
    }

    // 2. Exact name (or original import name)
    if (!$match && isset($byName[$bomName])) {
        $match = $byName[$bomName][0];
        $matchType = 'name_exact';
        $confidence = 1.0;
    }

    // 3. Fuzzy name ≥ 85%
    if (!$match) {
        $bestRatio = 0.0;
        $best = null;
        foreach ($rows as $r) {
            similar_text($bomName, strtolower($r['name']), $pct);
            if ($pct / 100 > $bestRatio) {
                $bestRatio = $pct / 100;
                $best = $r;
            }
            if ($r['original_import_name']) {
                similar_text($bomName, strtolower($r['original_import_name']), $pct2);
                if ($pct2 / 100 > $bestRatio) {
                    $bestRatio = $pct2 / 100;
                    $best = $r;
                }
            }
        }
        if ($bestRatio >= 0.85 && $best) {
            $match = $best;
            $matchType = 'name_fuzzy';
            $confidence = round($bestRatio, 2);
        }
    }

    $base = [
        'bom_name' => $name,
        'bom_product_id' => (string) ($bi['product_id'] ?? ''),
        'bom_quantity' => $qtyNeeded,
        'bom_note' => (string) ($bi['note'] ?? ''),
        'is_filament' => (bool) ($bi['is_filament'] ?? false),
    ];

    if ($match) {
        $available = (int) $match['quantity'];
        if ($available >= $qtyNeeded) {
            $status = 'in_stock';
            $inStock++;
        } elseif ($available > 0) {
            $status = 'partial';
            $partial++;
        } else {
            $status = 'out_of_stock';
            $missing++;
        }
        $results[] = $base + [
            'status' => $status,
            'match_type' => $matchType,
            'confidence' => $confidence,
            'matched_item_id' => $match['id'],
            'matched_item_name' => $match['name'],
            'matched_item_sku' => $match['sku'],
            'matched_item_category' => $match['category'],
            'matched_quantity' => $available,
            'matched_unit' => $match['unit'],
            'quantity_short' => max(0, $qtyNeeded - $available),
        ];
    } else {
        $missing++;
        $results[] = $base + [
            'status' => 'not_found',
            'match_type' => null,
            'confidence' => 0.0,
            'matched_item_id' => null,
            'matched_item_name' => null,
            'matched_item_sku' => null,
            'matched_item_category' => null,
            'matched_quantity' => 0,
            'matched_unit' => null,
            'quantity_short' => $qtyNeeded,
        ];
    }
}

respond([
    'project_name' => $req['project_name'] ?? 'BOM',
    'model_id' => $req['model_id'] ?? null,
    'summary' => [
        'in_stock' => $inStock,
        'partial' => $partial,
        'missing' => $missing,
        'total' => count($results),
    ],
    'items' => $results,
]);
