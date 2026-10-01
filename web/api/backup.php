<?php
/**
 * Backup / export / restore endpoint.
 *
 * GET  backup.php               — full JSON backup (download)
 * GET  backup.php?format=csv    — items CSV export (download)
 * POST backup.php?action=restore — restore from a JSON backup produced by
 *      the GET export. FULL REPLACE of items/filaments/tools/locations/
 *      categories/printers/printer_slots/label templates+presets inside one
 *      transaction. The activity log is preserved and a "imported" marker
 *      entry is added. Body: the backup JSON itself.
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

if (method() === 'POST' && ($_GET['action'] ?? '') === 'restore') {
    handle_restore($pdo);
}

if (method() !== 'GET') {
    fail('Method not allowed', 405);
}

function handle_restore(PDO $pdo): void
{
    $b = input_json();
    if (($b['app'] ?? '') !== 'MakerVault' || !isset($b['items'], $b['locations'], $b['categories'])) {
        fail('Not a MakerVault backup file (missing app/items/locations/categories)');
    }

    $counts = [];
    $pdo->beginTransaction();
    try {
        // Order matters for foreign keys: children first on delete,
        // parents first on insert.
        $pdo->exec('DELETE FROM import_batch_items');
        $pdo->exec('DELETE FROM filaments');
        $pdo->exec('DELETE FROM tools');
        $pdo->exec('DELETE FROM printer_slots');
        $pdo->exec('DELETE FROM items');
        $pdo->exec('DELETE FROM printers');
        $pdo->exec('DELETE FROM locations');
        $pdo->exec('DELETE FROM categories');
        $pdo->exec('DELETE FROM label_templates');
        $pdo->exec('DELETE FROM label_presets');

        $insertAll = function (string $table, array $rows, array $cols) use ($pdo, &$counts): void {
            if (!$rows) {
                $counts[$table] = 0;
                return;
            }
            $ph = implode(',', array_fill(0, count($cols), '?'));
            $stmt = $pdo->prepare("INSERT INTO $table (" . implode(',', $cols) . ") VALUES ($ph)");
            $n = 0;
            foreach ($rows as $r) {
                $stmt->execute(array_map(fn($c) => $r[$c] ?? null, $cols));
                $n++;
            }
            $counts[$table] = $n;
        };

        $insertAll('categories', $b['categories'], [
            'key', 'display_name', 'icon', 'color', 'position', 'is_builtin', 'created_at', 'updated_at']);
        $insertAll('locations', $b['locations'], [
            'id', 'name', 'type', 'parent_id', 'position', 'qr_code_value', 'notes', 'capacity',
            'created_at', 'updated_at']);
        $insertAll('printers', $b['printers'] ?? [], [
            'id', 'name', 'model', 'notes', 'created_at', 'updated_at']);
        $insertAll('label_templates', $b['label_templates'] ?? [], [
            'id', 'name', 'width_mm', 'height_mm', 'background_color', 'border_enabled',
            'border_thickness', 'border_color', 'padding_mm', 'auto_fit', 'lines_config',
            'created_at', 'updated_at']);
        $insertAll('label_presets', $b['label_presets'] ?? [], [
            'id', 'name', 'width_mm', 'height_mm']);

        // Items carry nested filament/tool objects in the export shape
        $itemCols = ['id', 'name', 'description', 'category', 'subcategory', 'brand', 'sku',
            'upc', 'barcode', 'quantity', 'unit', 'min_quantity', 'reorder_url',
            'purchase_price', 'pack_quantity', 'purchase_date', 'vendor', 'location_id', 'home_location_id',
            'photo_path', 'notes', 'whereabouts', 'color', 'color_hex',
            'original_import_name', 'created_at', 'updated_at', 'created_by'];
        $ph = implode(',', array_fill(0, count($itemCols) + 2, '?'));
        $itemStmt = $pdo->prepare(
            'INSERT INTO items (' . implode(',', $itemCols) . ", tags, custom_fields) VALUES ($ph)"
        );
        $filStmt = $pdo->prepare('
            INSERT INTO filaments (item_id, material, color, color_hex, color_mode, color_hex2,
                color_hex3, color_hex4, diameter, spool_weight, remaining_weight, status,
                printer_slot_id, spool_type, dry_box_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $toolStmt = $pdo->prepare('
            INSERT INTO tools (item_id, tool_type, serial_number, checked_out, checked_out_by,
                checked_out_at, home_location_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)');

        // FK order is circular-ish: printer_slots.current_filament_id → items,
        // filaments.printer_slot_id → printer_slots. So: items first, then
        // printer_slots, then the filament/tool extension rows.
        $n = 0;
        foreach ($b['items'] as $it) {
            $vals = array_map(fn($c) => $it[$c] ?? null, $itemCols);
            $vals[] = json_encode($it['tags'] ?? []);
            $vals[] = json_encode((object) ($it['custom_fields'] ?? []));
            $itemStmt->execute($vals);
            $n++;
        }
        $counts['items'] = $n;

        $insertAll('printer_slots', $b['printer_slots'] ?? [], [
            'id', 'printer_id', 'ams_type', 'ams_unit_number', 'slot_number', 'name',
            'current_filament_id', 'location_id', 'sort_order', 'created_at', 'updated_at']);

        foreach ($b['items'] as $it) {
            if (!empty($it['filament'])) {
                $f = $it['filament'];
                $filStmt->execute([
                    $it['id'], $f['material'] ?? 'PLA', $f['color'] ?? null, $f['color_hex'] ?? null,
                    $f['color_mode'] ?? 'solid', $f['color_hex2'] ?? null, $f['color_hex3'] ?? null,
                    $f['color_hex4'] ?? null, $f['diameter'] ?? 1.75, $f['spool_weight'] ?? null,
                    $f['remaining_weight'] ?? null, $f['status'] ?? 'inStock',
                    $f['printer_slot_id'] ?? null, $f['spool_type'] ?? 'withSpool',
                    $f['dry_box_id'] ?? null,
                ]);
            }
            if (!empty($it['tool'])) {
                $t = $it['tool'];
                $toolStmt->execute([
                    $it['id'], $t['tool_type'] ?? null, $t['serial_number'] ?? null,
                    (int) (bool) ($t['checked_out'] ?? false), $t['checked_out_by'] ?? null,
                    $t['checked_out_at'] ?? null, $t['home_location_id'] ?? null,
                ]);
            }
        }

        log_activity($pdo, 'imported', null, null,
            sprintf('Restored backup from %s (%d items)', $b['exported_at'] ?? 'unknown date', $n));
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('Restore failed (nothing was changed): ' . $e->getMessage(), 500);
    }

    respond(['restored' => true, 'counts' => $counts]);
}

$date = gmdate('Y-m-d');

if (($_GET['format'] ?? 'json') === 'csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header("Content-Disposition: attachment; filename=\"makervault-items-$date.csv\"");

    $out = fopen('php://output', 'w');
    $columns = [
        'id', 'name', 'description', 'category', 'subcategory', 'brand', 'sku',
        'upc', 'barcode', 'quantity', 'unit', 'min_quantity', 'reorder_url',
        'purchase_price', 'pack_quantity', 'unit_cost', 'purchase_date', 'vendor', 'location', 'notes',
        'tags', 'color', 'created_at', 'updated_at',
    ];
    fputcsv($out, $columns, ',', '"', '\\');

    $rows = $pdo->query('
        SELECT i.*, l.name AS location_name
        FROM items i LEFT JOIN locations l ON l.id = i.location_id
        ORDER BY i.name COLLATE NOCASE
    ')->fetchAll();

    foreach ($rows as $r) {
        $r['unit_cost'] = $r['purchase_price'] === null ? null
            : round((float) $r['purchase_price'] / max(1, (int) ($r['pack_quantity'] ?? 1)), 4);
        $tags = json_decode($r['tags'] ?? '[]', true) ?: [];
        fputcsv($out, [
            $r['id'], $r['name'], $r['description'], $r['category'],
            $r['subcategory'], $r['brand'], $r['sku'], $r['upc'], $r['barcode'],
            $r['quantity'], $r['unit'], $r['min_quantity'], $r['reorder_url'],
            $r['purchase_price'], $r['purchase_date'], $r['vendor'],
            $r['location_name'], $r['notes'], implode('; ', $tags),
            $r['color'], $r['created_at'], $r['updated_at'],
        ], ',', '"', '\\');
    }
    fclose($out);
    exit;
}

// Full JSON backup: every table needed to restore state (photos excluded —
// those are plain files under data/photos/ and are backed up as files).
$itemRows = $pdo->query('SELECT * FROM items ORDER BY name COLLATE NOCASE')->fetchAll();

$backup = [
    'app' => 'MakerVault',
    'version' => MV_VERSION,
    'exported_at' => now(),
    'items' => rows_to_items($pdo, $itemRows),
    'locations' => $pdo->query('SELECT * FROM locations ORDER BY position, name')->fetchAll(),
    'categories' => $pdo->query('SELECT * FROM categories ORDER BY position')->fetchAll(),
    'printers' => $pdo->query('SELECT * FROM printers')->fetchAll(),
    'printer_slots' => $pdo->query('SELECT * FROM printer_slots')->fetchAll(),
    'label_templates' => $pdo->query('SELECT * FROM label_templates')->fetchAll(),
    'label_presets' => $pdo->query('SELECT * FROM label_presets')->fetchAll(),
    'activity_log' => $pdo->query('SELECT * FROM activity_log ORDER BY timestamp')->fetchAll(),
];

header('Content-Type: application/json; charset=utf-8');
header("Content-Disposition: attachment; filename=\"makervault-backup-$date.json\"");
echo json_encode($backup, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
