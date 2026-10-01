<?php
/**
 * Invoice import endpoint — ports POST /api/import/confirm and GET /api/import/batches.
 * PDF parsing happens client-side (pdf.js + js/parsers.js); this endpoint
 * receives the reviewed line items and creates the records.
 *
 * POST import.php  — body: {
 *     source, vendor, order_number?, order_date?, invoice_number?, grand_total?,
 *     default_location_id?, duplicate_strategy: "create"|"update"|"skip",
 *     items: [{name, category, subcategory?, brand?, sku?, quantity, unit,
 *              unit_price?, list_price?, line_total?, discount?, tax?,
 *              purchase_date?, vendor?, description?, filament?}]
 *   }
 *   → {batch_id, stats: {created, updated, skipped}}
 *   unit_price is the per-unit PAID price (after discount) and becomes the
 *   item's purchase_price; the full line detail (list/discount/tax/total)
 *   is recorded on import_batch_items.
 * GET import.php   — recent import batches with item counts
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

if (method() === 'GET') {
    $rows = $pdo->query('
        SELECT b.id, b.source, b.vendor, b.order_number, b.order_date, b.invoice_number,
               b.grand_total, b.imported_at, COUNT(bi.item_id) AS item_count
        FROM import_batches b
        LEFT JOIN import_batch_items bi ON bi.batch_id = b.id
        GROUP BY b.id
        ORDER BY b.imported_at DESC
        LIMIT 50
    ')->fetchAll();
    respond($rows);
}

if (method() !== 'POST') {
    fail('Method not allowed', 405);
}

$req = input_json();
$items = $req['items'] ?? [];
if (!is_array($items) || !$items) {
    fail('items array is required');
}
$strategy = $req['duplicate_strategy'] ?? 'create';
if (!in_array($strategy, ['create', 'update', 'skip'], true)) {
    fail('duplicate_strategy must be create, update, or skip');
}
$defaultLocation = $req['default_location_id'] ?? null;

$ts = now();
$batchId = uid();
$stats = ['created' => 0, 'updated' => 0, 'skipped' => 0];

$pdo->beginTransaction();
try {
    $pdo->prepare('
        INSERT INTO import_batches (id, source, vendor, order_number, order_date,
            invoice_number, grand_total, imported_at, imported_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ')->execute([
        $batchId, $req['source'] ?? 'manual', $req['vendor'] ?? null,
        $req['order_number'] ?? null, $req['order_date'] ?? null,
        $req['invoice_number'] ?? null, $req['grand_total'] ?? null, $ts,
    ]);

    $validCategories = array_column(
        $pdo->query('SELECT key FROM categories')->fetchAll(), 'key'
    );

    // SKU is the reliable identity (filament names repeat per material —
    // "ABS" ×8 — and naming conventions evolve); name+brand+category is the
    // fallback for items without one.
    $findBySku = $pdo->prepare('SELECT id, quantity FROM items WHERE sku = ? LIMIT 1');
    $findDup = $pdo->prepare("
        SELECT id, quantity FROM items
        WHERE LOWER(name) = LOWER(?) AND COALESCE(brand, '') = COALESCE(?, '') AND category = ?
    ");

    $insertBatchItem = $pdo->prepare('
        INSERT OR IGNORE INTO import_batch_items
            (batch_id, item_id, unit_price, list_price, line_total, discount, tax, quantity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ');
    $batchItemArgs = static fn (array $li, string $itemId, int $qty) => [
        $batchId, $itemId, $li['unit_price'] ?? null, $li['list_price'] ?? null,
        $li['line_total'] ?? null, $li['discount'] ?? null, $li['tax'] ?? null, $qty,
    ];

    foreach ($items as $li) {
        $name = trim((string) ($li['name'] ?? ''));
        $category = $li['category'] ?? 'other';
        if (!in_array($category, $validCategories, true)) {
            $category = 'other';
        }
        if ($name === '') {
            continue;
        }
        $qty = max(0, (int) ($li['quantity'] ?? 1));

        $existing = null;
        if ($strategy !== 'create') {
            $sku = trim((string) ($li['sku'] ?? ''));
            if ($sku !== '') {
                $findBySku->execute([$sku]);
                $existing = $findBySku->fetch();
            }
            if (!$existing) {
                $findDup->execute([$name, $li['brand'] ?? null, $category]);
                $existing = $findDup->fetch();
            }
        }

        if ($existing && $strategy === 'skip') {
            log_activity($pdo, 'skipped', $existing['id'], null, "Import skipped (duplicate): $name");
            $stats['skipped']++;
            continue;
        }

        if ($existing && $strategy === 'update') {
            $newQty = (int) $existing['quantity'] + $qty;
            // Latest purchase info wins; identity-ish fields only fill blanks
            $pdo->prepare('
                UPDATE items SET quantity = ?, updated_at = ?,
                    purchase_price = COALESCE(?, purchase_price),
                    purchase_date  = COALESCE(?, purchase_date),
                    vendor         = COALESCE(?, vendor),
                    sku            = COALESCE(sku, ?),
                    subcategory    = COALESCE(subcategory, ?),
                    description    = COALESCE(description, ?)
                WHERE id = ?
            ')->execute([
                $newQty, $ts, $li['unit_price'] ?? null, $li['purchase_date'] ?? null,
                $li['vendor'] ?? null, $li['sku'] ?? null, $li['subcategory'] ?? null,
                $li['description'] ?? null, $existing['id'],
            ]);
            $insertBatchItem->execute($batchItemArgs($li, $existing['id'], $qty));
            log_activity($pdo, 'quantity_updated', $existing['id'], null,
                "Import updated quantity (+$qty, now $newQty): $name");
            $stats['updated']++;
            continue;
        }

        $itemId = uid();
        $pdo->prepare('
            INSERT INTO items (id, name, description, category, subcategory, brand, sku,
                quantity, unit, purchase_price, pack_quantity, purchase_date, vendor, location_id,
                home_location_id, tags, original_import_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ')->execute([
            $itemId, $name, $li['description'] ?? null, $category,
            $li['subcategory'] ?? null, $li['brand'] ?? null, $li['sku'] ?? null,
            $qty, $li['unit'] ?? 'pcs', $li['unit_price'] ?? null,
            $li['pack_quantity'] ?? null,
            $li['purchase_date'] ?? null, $li['vendor'] ?? null,
            $defaultLocation, $defaultLocation, '[]', $name, $ts, $ts,
        ]);

        if ($category === 'filament' && !empty($li['filament'])) {
            $f = $li['filament'];
            $pdo->prepare('
                INSERT INTO filaments (item_id, material, color, color_hex, color_mode,
                    color_hex2, color_hex3, color_hex4, diameter, spool_weight,
                    remaining_weight, status, spool_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ')->execute([
                $itemId, $f['material'] ?? 'PLA', $f['color'] ?? null,
                $f['color_hex'] ?? null, $f['color_mode'] ?? 'solid',
                $f['color_hex2'] ?? null, $f['color_hex3'] ?? null, $f['color_hex4'] ?? null,
                $f['diameter'] ?? 1.75, $f['spool_weight'] ?? 1000,
                $f['remaining_weight'] ?? ($f['spool_weight'] ?? 1000),
                $f['status'] ?? 'inStock', $f['spool_type'] ?? 'withSpool',
            ]);
        }

        $insertBatchItem->execute($batchItemArgs($li, $itemId, $qty));
        log_activity($pdo, 'imported', $itemId, $defaultLocation,
            'Imported from ' . ($req['vendor'] ?? 'invoice') . ": $name");
        $stats['created']++;
    }

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fail('Import failed: ' . $e->getMessage(), 500);
}

respond(['batch_id' => $batchId, 'stats' => $stats], 201);
