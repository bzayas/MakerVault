<?php
/**
 * Items endpoint.
 *
 * GET    items.php                 — list with ?query=&category=&brand=&vendor=&location_id=&status=&sort_by=&sort_order=&limit=&offset=
 * GET    items.php?id=<id>         — single item
 * GET    items.php?count=1         — {"count": n} (optional &category=)
 * GET    items.php?low_stock=1     — items at/below min quantity
 * POST   items.php                 — create item (JSON body)
 * PUT    items.php?id=<id>         — partial update (JSON body)
 * DELETE items.php?id=<id>         — delete item
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

/** Keep only scalar values under non-empty string labels (JSON object). */
function clean_custom_fields($raw): object
{
    $out = new stdClass();
    if (is_array($raw) || is_object($raw)) {
        foreach ((array) $raw as $label => $value) {
            $label = trim((string) $label);
            if ($label === '' || is_array($value) || is_object($value)) {
                continue;
            }
            $out->{$label} = is_bool($value) || is_int($value) || is_float($value)
                ? $value : (string) $value;
        }
    }
    return $out;
}

const ITEM_FIELDS = [
    'name', 'description', 'category', 'subcategory', 'brand', 'sku', 'upc',
    'barcode', 'quantity', 'unit', 'min_quantity', 'reorder_url',
    'purchase_price', 'pack_quantity', 'purchase_date', 'vendor', 'location_id',
    'home_location_id', 'notes', 'whereabouts', 'color', 'color_hex',
    'original_import_name',
];

const FILAMENT_FIELDS = [
    'material', 'color', 'color_hex', 'color_mode', 'color_hex2', 'color_hex3',
    'color_hex4', 'diameter', 'spool_weight', 'remaining_weight', 'status',
    'printer_slot_id', 'spool_type', 'dry_box_id',
];

const TOOL_FIELDS = [
    'tool_type', 'serial_number', 'checked_out', 'checked_out_by',
    'checked_out_at', 'home_location_id',
];

const BARCODE_PREFIXES = [
    'filament' => 'FIL', 'screw' => 'SCR', 'screws' => 'SCR',
    'hardware' => 'HDW', 'motor' => 'MOT', 'electronic' => 'ELC',
    'tool' => 'TUL', 'paper' => 'PPR', 'adhesive' => 'ADH',
    'printer_accessory' => 'PAC', 'craft_supply' => 'CRF', 'other' => 'OTH',
];

switch (method()) {
    case 'GET':
        handle_get($pdo);
        break;
    case 'POST':
        if (($_GET['action'] ?? '') === 'batch') {
            handle_batch($pdo);
        }
        if (($_GET['action'] ?? '') === 'barcode') {
            handle_barcode($pdo);
        }
        handle_create($pdo);
        break;
    case 'PUT':
    case 'PATCH':
        handle_update($pdo);
        break;
    case 'DELETE':
        handle_delete($pdo);
        break;
    default:
        fail('Method not allowed', 405);
}

// ---------------------------------------------------------------------------

function handle_get(PDO $pdo): void
{
    if (isset($_GET['id'])) {
        $item = fetch_item($pdo, $_GET['id']);
        if (!$item) {
            fail('Item not found', 404);
        }
        respond($item);
    }

    if (isset($_GET['count'])) {
        if (!empty($_GET['category'])) {
            $stmt = $pdo->prepare('SELECT COUNT(*) AS cnt FROM items WHERE category = ?');
            $stmt->execute([$_GET['category']]);
        } else {
            $stmt = $pdo->query('SELECT COUNT(*) AS cnt FROM items');
        }
        respond(['count' => (int) $stmt->fetch()['cnt']]);
    }

    // Exact scan lookup: matches barcode, SKU, or UPC (used by the scanner)
    if (isset($_GET['lookup'])) {
        $code = $_GET['lookup'];
        $stmt = $pdo->prepare(
            'SELECT * FROM items WHERE barcode = ? OR sku = ? OR upc = ? LIMIT 10'
        );
        $stmt->execute([$code, $code, $code]);
        respond(rows_to_items($pdo, $stmt->fetchAll()));
    }

    if (isset($_GET['low_stock'])) {
        $rows = $pdo->query(
            'SELECT * FROM items WHERE min_quantity IS NOT NULL AND quantity <= min_quantity ORDER BY name'
        )->fetchAll();
        respond(rows_to_items($pdo, $rows));
    }

    $conditions = [];
    $params = [];

    if (!empty($_GET['query'])) {
        $conditions[] = '(i.name LIKE ? OR i.sku LIKE ? OR i.upc LIKE ? OR i.barcode LIKE ? '
            . 'OR i.description LIKE ? OR i.notes LIKE ? OR i.tags LIKE ? OR i.brand LIKE ?)';
        $q = '%' . $_GET['query'] . '%';
        array_push($params, $q, $q, $q, $q, $q, $q, $q, $q);
    }
    if (!empty($_GET['category'])) {
        $conditions[] = 'i.category = ?';
        $params[] = $_GET['category'];
    }
    if (!empty($_GET['brand'])) {
        $conditions[] = 'i.brand LIKE ?';
        $params[] = '%' . $_GET['brand'] . '%';
    }
    if (!empty($_GET['vendor'])) {
        $conditions[] = 'i.vendor LIKE ?';
        $params[] = '%' . $_GET['vendor'] . '%';
    }
    if (!empty($_GET['location_id'])) {
        $conditions[] = 'i.location_id = ?';
        $params[] = $_GET['location_id'];
    }
    $status = $_GET['status'] ?? '';
    if ($status === 'lowStock') {
        $conditions[] = 'i.min_quantity IS NOT NULL AND i.quantity <= i.min_quantity AND i.quantity > 0';
    } elseif ($status === 'outOfStock') {
        $conditions[] = 'i.quantity = 0';
    } elseif ($status === 'inStock') {
        $conditions[] = 'i.quantity > 0';
    }

    $where = $conditions ? implode(' AND ', $conditions) : '1=1';

    $allowedSorts = ['name', 'quantity', 'created_at', 'updated_at', 'purchase_price', 'category'];
    $sortBy = in_array($_GET['sort_by'] ?? 'name', $allowedSorts, true) ? $_GET['sort_by'] ?? 'name' : 'name';
    $sortOrder = strtolower($_GET['sort_order'] ?? 'asc') === 'desc' ? 'DESC' : 'ASC';
    $limit = min((int) ($_GET['limit'] ?? 500), 1000);
    $offset = max((int) ($_GET['offset'] ?? 0), 0);

    $sql = "SELECT i.* FROM items i WHERE $where ORDER BY i.$sortBy COLLATE NOCASE $sortOrder LIMIT ? OFFSET ?";
    $params[] = $limit;
    $params[] = $offset;

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    respond(rows_to_items($pdo, $stmt->fetchAll()));
}

// ---------------------------------------------------------------------------

function handle_create(PDO $pdo): void
{
    $data = input_json();
    if (empty($data['name']) || empty($data['category'])) {
        fail('name and category are required');
    }

    // Client-supplied id (offline outbox) — validate shape, reject collisions
    $id = uid();
    if (!empty($data['id'])) {
        if (!preg_match('/^[a-f0-9-]{36}$/i', $data['id'])) {
            fail('id must be a UUID');
        }
        $stmt = $pdo->prepare('SELECT id FROM items WHERE id = ?');
        $stmt->execute([$data['id']]);
        if ($stmt->fetch()) {
            fail('An item with this id already exists', 409);
        }
        $id = $data['id'];
    }
    $ts = now();

    $cols = ['id', 'created_at', 'updated_at', 'tags', 'custom_fields'];
    $vals = [$id, $ts, $ts, json_encode(array_values($data['tags'] ?? [])),
        json_encode(clean_custom_fields($data['custom_fields'] ?? []))];
    foreach (ITEM_FIELDS as $f) {
        if (array_key_exists($f, $data)) {
            $cols[] = $f;
            $vals[] = $data[$f];
        }
    }

    $ph = implode(',', array_fill(0, count($cols), '?'));
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('INSERT INTO items (' . implode(',', $cols) . ") VALUES ($ph)");
        $stmt->execute($vals);

        if ($data['category'] === 'filament' && !empty($data['filament'])) {
            upsert_filament($pdo, $id, $data['filament']);
        }
        if ($data['category'] === 'tool' && !empty($data['tool'])) {
            upsert_tool($pdo, $id, $data['tool']);
        }

        log_activity($pdo, 'added', $id, $data['location_id'] ?? null, 'Added ' . $data['name']);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('Create failed: ' . $e->getMessage(), 500);
    }

    respond(fetch_item($pdo, $id), 201);
}

function upsert_filament(PDO $pdo, string $itemId, array $f): void
{
    $cols = ['item_id'];
    $vals = [$itemId];
    foreach (FILAMENT_FIELDS as $field) {
        if (array_key_exists($field, $f)) {
            $cols[] = $field;
            $vals[] = $f[$field];
        }
    }
    // material is NOT NULL — default it on insert if absent
    if (!in_array('material', $cols, true)) {
        $cols[] = 'material';
        $vals[] = 'PLA';
    }
    $ph = implode(',', array_fill(0, count($cols), '?'));
    $updates = implode(',', array_map(
        fn($c) => "$c = excluded.$c",
        array_slice($cols, 1)
    ));
    $sql = 'INSERT INTO filaments (' . implode(',', $cols) . ") VALUES ($ph) "
         . "ON CONFLICT(item_id) DO UPDATE SET $updates";
    $pdo->prepare($sql)->execute($vals);
}

function upsert_tool(PDO $pdo, string $itemId, array $t): void
{
    $cols = ['item_id'];
    $vals = [$itemId];
    foreach (TOOL_FIELDS as $field) {
        if (array_key_exists($field, $t)) {
            $cols[] = $field;
            $vals[] = $field === 'checked_out' ? (int) (bool) $t[$field] : $t[$field];
        }
    }
    $ph = implode(',', array_fill(0, count($cols), '?'));
    $updates = implode(',', array_map(
        fn($c) => "$c = excluded.$c",
        array_slice($cols, 1)
    ));
    $sql = 'INSERT INTO tools (' . implode(',', $cols) . ") VALUES ($ph) "
         . "ON CONFLICT(item_id) DO UPDATE SET $updates";
    $pdo->prepare($sql)->execute($vals);
}

function handle_update(PDO $pdo): void
{
    $id = $_GET['id'] ?? null;
    if (!$id) {
        fail('id query parameter required');
    }
    $existing = fetch_item($pdo, $id);
    if (!$existing) {
        fail('Item not found', 404);
    }

    $data = input_json();

    $sets = [];
    $vals = [];
    foreach (ITEM_FIELDS as $f) {
        if (array_key_exists($f, $data)) {
            $sets[] = "$f = ?";
            $vals[] = $data[$f];
        }
    }
    if (array_key_exists('tags', $data)) {
        $sets[] = 'tags = ?';
        $vals[] = json_encode(array_values($data['tags'] ?? []));
    }
    if (array_key_exists('custom_fields', $data)) {
        $sets[] = 'custom_fields = ?';
        $vals[] = json_encode(clean_custom_fields($data['custom_fields']));
    }

    $pdo->beginTransaction();
    try {
        if ($sets) {
            $sets[] = 'updated_at = ?';
            $vals[] = now();
            $vals[] = $id;
            $pdo->prepare('UPDATE items SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
        }

        $category = $data['category'] ?? $existing['category'];
        if ($category === 'filament' && !empty($data['filament'])) {
            upsert_filament($pdo, $id, $data['filament']);
        }
        if ($category === 'tool' && !empty($data['tool'])) {
            upsert_tool($pdo, $id, $data['tool']);
        }

        // Activity: log the most specific single action — a pure quantity
        // change is "quantityChanged", a pure location change is "moved",
        // anything broader is "edited" (plus "moved" if the location changed)
        $qtyChanged = array_key_exists('quantity', $data) && (int) $data['quantity'] !== $existing['quantity'];
        $locChanged = array_key_exists('location_id', $data) && $data['location_id'] !== $existing['location_id'];
        $changedFields = array_filter(
            array_keys($data),
            fn($f) => !in_array($f, ['quantity', 'location_id'], true)
        );

        if ($qtyChanged && !$locChanged && !$changedFields) {
            log_activity(
                $pdo, 'quantityChanged', $id, $existing['location_id'],
                sprintf('%s: %d → %d', $existing['name'], $existing['quantity'], (int) $data['quantity'])
            );
        } else {
            if ($changedFields || $qtyChanged) {
                log_activity($pdo, 'edited', $id, $existing['location_id'], 'Edited ' . $existing['name']);
            }
            if ($locChanged) {
                log_activity($pdo, 'moved', $id, $data['location_id'], 'Moved ' . $existing['name']);
            }
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('Update failed: ' . $e->getMessage(), 500);
    }

    respond(fetch_item($pdo, $id));
}

/**
 * Batch update — ports POST /api/items/batch-update: applies one partial
 * update to many items in a single transaction.
 * Body: {ids: [...], updates: {category?, location_id?, brand?, vendor?,
 *        subcategory?, min_quantity?, tags?}, delete?: bool}
 */
function handle_batch(PDO $pdo): void
{
    $data = input_json();
    $ids = $data['ids'] ?? [];
    if (!is_array($ids) || !$ids) {
        fail('ids array is required');
    }

    // Batch delete
    if (!empty($data['delete'])) {
        $pdo->beginTransaction();
        try {
            $sel = $pdo->prepare('SELECT id, name, location_id FROM items WHERE id = ?');
            foreach ($ids as $id) {
                $sel->execute([$id]);
                if ($row = $sel->fetch()) {
                    log_activity($pdo, 'deleted', $id, $row['location_id'], 'Deleted ' . $row['name'] . ' (batch)');
                    $pdo->prepare('DELETE FROM items WHERE id = ?')->execute([$id]);
                    $photo = MV_PHOTOS_DIR . '/' . $id . '.jpg';
                    if (is_file($photo)) {
                        unlink($photo);
                    }
                }
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail('Batch delete failed: ' . $e->getMessage(), 500);
        }
        respond(['deleted' => count($ids)]);
    }

    $updates = $data['updates'] ?? [];
    $allowed = ['category', 'location_id', 'brand', 'vendor', 'subcategory', 'min_quantity', 'unit'];
    $sets = [];
    $vals = [];
    foreach ($allowed as $f) {
        if (array_key_exists($f, $updates)) {
            $sets[] = "$f = ?";
            $vals[] = $updates[$f];
        }
    }
    if (array_key_exists('tags', $updates)) {
        $sets[] = 'tags = ?';
        $vals[] = json_encode(array_values($updates['tags'] ?? []));
    }
    if (!$sets) {
        fail('updates must contain at least one editable field');
    }
    $sets[] = 'updated_at = ?';
    $vals[] = now();

    $movedTo = array_key_exists('location_id', $updates) ? $updates['location_id'] : false;

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('UPDATE items SET ' . implode(', ', $sets) . ' WHERE id = ?');
        $sel = $pdo->prepare('SELECT id, name FROM items WHERE id = ?');
        $count = 0;
        foreach ($ids as $id) {
            $sel->execute([$id]);
            $row = $sel->fetch();
            if (!$row) {
                continue;
            }
            $stmt->execute(array_merge($vals, [$id]));
            if ($movedTo !== false) {
                log_activity($pdo, 'moved', $id, $movedTo, 'Moved ' . $row['name'] . ' (batch)');
            } else {
                log_activity($pdo, 'edited', $id, null, 'Edited ' . $row['name'] . ' (batch)');
            }
            $count++;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('Batch update failed: ' . $e->getMessage(), 500);
    }
    respond(['updated' => $count]);
}

/**
 * Barcode auto-generation — ports POST /{item_id}/assign-barcode.
 * Body {item_id}: assign + persist on that item (no-op if it has one).
 * Body {category}: reserve and return the next value (used by the Add form
 * before the item exists; a cancelled form burns the number, that's fine).
 * Format: MV-<PREFIX>-00001 via the barcode_sequences atomic upsert.
 * (BARCODE_PREFIXES is declared above the dispatch switch — top-level PHP
 * consts execute in file order.)
 */
function next_barcode(PDO $pdo, string $category): string
{
    $prefix = BARCODE_PREFIXES[$category]
        ?? strtoupper(substr(preg_replace('/[^a-z]/', '', strtolower($category)) ?: 'oth', 0, 3));
    $pdo->prepare('
        INSERT INTO barcode_sequences (category_prefix, next_value) VALUES (?, 2)
        ON CONFLICT(category_prefix) DO UPDATE SET next_value = next_value + 1
    ')->execute([$prefix]);
    $stmt = $pdo->prepare('SELECT next_value FROM barcode_sequences WHERE category_prefix = ?');
    $stmt->execute([$prefix]);
    $next = (int) $stmt->fetch()['next_value'] - 1;
    return sprintf('MV-%s-%05d', $prefix, $next);
}

function handle_barcode(PDO $pdo): void
{
    $data = input_json();

    if (!empty($data['item_id'])) {
        $stmt = $pdo->prepare('SELECT * FROM items WHERE id = ?');
        $stmt->execute([$data['item_id']]);
        $row = $stmt->fetch();
        if (!$row) {
            fail('Item not found', 404);
        }
        if ($row['barcode']) {
            respond(['barcode' => $row['barcode'], 'already_assigned' => true]);
        }
        $barcode = next_barcode($pdo, $row['category'] ?: 'other');
        $pdo->prepare('UPDATE items SET barcode = ?, updated_at = ? WHERE id = ?')
            ->execute([$barcode, now(), $row['id']]);
        respond(['barcode' => $barcode, 'already_assigned' => false]);
    }

    if (!empty($data['category'])) {
        respond(['barcode' => next_barcode($pdo, $data['category']), 'reserved' => true]);
    }

    fail('item_id or category required');
}

function handle_delete(PDO $pdo): void
{
    $id = $_GET['id'] ?? null;
    if (!$id) {
        fail('id query parameter required');
    }
    $existing = fetch_item($pdo, $id);
    if (!$existing) {
        fail('Item not found', 404);
    }

    // Log first: the FK sets activity_log.item_id NULL once the item is gone,
    // and the name in details is all that survives.
    log_activity($pdo, 'deleted', $id, $existing['location_id'], 'Deleted ' . $existing['name']);
    $pdo->prepare('DELETE FROM items WHERE id = ?')->execute([$id]);

    $photo = MV_PHOTOS_DIR . '/' . $id . '.jpg';
    if (is_file($photo)) {
        unlink($photo);
    }

    respond(['deleted' => true]);
}
