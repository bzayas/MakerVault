<?php
/**
 * MakerVault web API — shared bootstrap.
 *
 * Every endpoint includes this file. It provides the PDO/SQLite connection
 * (creating the schema on first run), JSON request/response helpers, item
 * serialization shared by items.php and locations.php, and activity logging.
 *
 * The database lives at ../data/makervault.db — the same SQLite format the
 * original FastAPI server used, so a database copied from
 * ~/Library/Application Support/MakerVault/ works as-is.
 */

declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');

define('MV_VERSION', '3.14.0-beta');
define('MV_DATA_DIR', dirname(__DIR__) . '/data');
define('MV_DB_PATH', MV_DATA_DIR . '/makervault.db');
define('MV_PHOTOS_DIR', MV_DATA_DIR . '/photos');

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function respond($data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $code = 400): void
{
    respond(['detail' => $message], $code);
}

function method(): string
{
    return $_SERVER['REQUEST_METHOD'] ?? 'GET';
}

/** Decode the JSON request body into an assoc array. */
function input_json(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        fail('Request body must be a JSON object');
    }
    return $data;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** Random UUID v4, lowercase — matches the ids the FastAPI server generated. */
function uid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

/** UTC timestamp in SQLite datetime('now') format. */
function now(): string
{
    return gmdate('Y-m-d H:i:s');
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    if (!is_dir(MV_DATA_DIR)) {
        mkdir(MV_DATA_DIR, 0775, true);
    }
    $fresh = !file_exists(MV_DB_PATH);
    $pdo = new PDO('sqlite:' . MV_DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec('PRAGMA busy_timeout=5000');
    init_schema($pdo, $fresh);
    return $pdo;
}

function init_schema(PDO $pdo, bool $fresh): void
{
    $hasItems = $pdo->query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='items'"
    )->fetch();

    if (!$hasItems) {
        $schema = file_get_contents(__DIR__ . '/schema.sql');
        if ($schema === false) {
            fail('schema.sql missing next to the API scripts', 500);
        }
        $pdo->exec($schema);
        seed_categories($pdo);
        seed_label_presets($pdo);
        return;
    }

    // Databases migrated from older FastAPI versions may predate this column.
    ensure_column($pdo, 'items', 'original_import_name', 'TEXT');

    // 3.8.0: invoice line details recorded per imported item (audit trail —
    // items only keep purchase_price; the line's totals live on the batch row)
    ensure_column($pdo, 'import_batch_items', 'unit_price', 'REAL');
    ensure_column($pdo, 'import_batch_items', 'list_price', 'REAL');
    ensure_column($pdo, 'import_batch_items', 'line_total', 'REAL');
    ensure_column($pdo, 'import_batch_items', 'discount', 'REAL');
    ensure_column($pdo, 'import_batch_items', 'tax', 'REAL');
    ensure_column($pdo, 'import_batch_items', 'quantity', 'INTEGER');

    // 3.9.0: the JS invoice/Amazon importers briefly emitted the native
    // parser's 'screw' key; the categories table key is 'screws'. Heal any
    // items imported in that window (idempotent).
    $pdo->exec("UPDATE items SET category = 'screws' WHERE category = 'screw'");

    // 3.12.0: free-form per-item fields (JSON object {label: value})
    ensure_column($pdo, 'items', 'custom_fields', 'TEXT');

    // 3.14.0: pack pricing. purchase_price stays exactly what the receipt
    // said; pack_quantity says how many units of `unit` that one price
    // covers (NULL/0/1 = price is per unit). Fixes inventory value being
    // ~5x inflated when a pack price met a piece count (a 2000-pack of cork
    // pads bought for $11.49 valued at $22,980).
    ensure_column($pdo, 'items', 'pack_quantity', 'INTEGER');

    // 3.13.0: duplicate-finder dismissals ("not duplicates" pairs)
    $pdo->exec('CREATE TABLE IF NOT EXISTS duplicate_dismissals (
        item_a TEXT NOT NULL,
        item_b TEXT NOT NULL,
        dismissed_at TEXT NOT NULL,
        PRIMARY KEY (item_a, item_b)
    )');
}

function ensure_column(PDO $pdo, string $table, string $column, string $ddl): void
{
    $cols = $pdo->query("PRAGMA table_info($table)")->fetchAll();
    foreach ($cols as $c) {
        if ($c['name'] === $column) {
            return;
        }
    }
    $pdo->exec("ALTER TABLE $table ADD COLUMN $column $ddl");
}

function seed_categories(PDO $pdo): void
{
    $defaults = [
        ['filament', 'Filament', 'circle.fill', '#AF52DE', 1],
        ['screws', 'Screws & Bolts', 'wrench.and.screwdriver', '#8E8E93', 1],
        ['hardware', 'Hardware', 'gearshape.2', '#FF9500', 1],
        ['motor', 'Motors & Servos', 'engine.combustion', '#007AFF', 1],
        ['electronic', 'Electronics', 'cable.connector', '#34C759', 1],
        ['tool', 'Tools', 'hammer', '#FF3B30', 1],
        ['paper', 'Paper & Vinyl', 'doc.plaintext', '#32ADE6', 1],
        ['adhesive', 'Adhesives', 'bandage', '#FFCC00', 1],
        ['printer_accessory', 'Printer Accessories', 'printer', '#5856D6', 1],
        ['craft_supply', 'Craft Supplies', 'paintpalette', '#FF2D55', 1],
        ['other', 'Other', 'shippingbox', '#8E8E93', 1],
    ];
    $stmt = $pdo->prepare(
        'INSERT OR IGNORE INTO categories (key, display_name, icon, color, position, is_builtin)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    foreach ($defaults as $i => $c) {
        $stmt->execute([$c[0], $c[1], $c[2], $c[3], $i, $c[4]]);
    }
}

function seed_label_presets(PDO $pdo): void
{
    $presets = [
        ['Small (25×10mm)', 25, 10],
        ['Medium (40×20mm)', 40, 20],
        ['Large (60×30mm)', 60, 30],
        ['Filament Spool (50×25mm)', 50, 25],
    ];
    $stmt = $pdo->prepare(
        'INSERT OR IGNORE INTO label_presets (id, name, width_mm, height_mm) VALUES (?, ?, ?, ?)'
    );
    foreach ($presets as $p) {
        $stmt->execute([uid(), $p[0], $p[1], $p[2]]);
    }
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

function log_activity(
    PDO $pdo,
    string $action,
    ?string $itemId = null,
    ?string $locationId = null,
    ?string $details = null
): void {
    $stmt = $pdo->prepare(
        'INSERT INTO activity_log (id, timestamp, user_id, action, item_id, location_id, details)
         VALUES (?, ?, NULL, ?, ?, ?, ?)'
    );
    $stmt->execute([uid(), now(), $action, $itemId, $locationId, $details]);
}

// ---------------------------------------------------------------------------
// Item serialization (shared by items.php, locations.php, backup.php)
// ---------------------------------------------------------------------------

/** Convert a raw items row plus optional extension rows into the API shape. */
function item_shape(array $row, ?array $filament, ?array $tool): array
{
    $tags = [];
    if (!empty($row['tags'])) {
        $decoded = json_decode($row['tags'], true);
        if (is_array($decoded)) {
            $tags = $decoded;
        }
    }
    $customFields = new stdClass();
    if (!empty($row['custom_fields'])) {
        $decoded = json_decode($row['custom_fields']);
        if (is_object($decoded)) {
            $customFields = $decoded;
        }
    }

    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'description' => $row['description'],
        'category' => $row['category'],
        'subcategory' => $row['subcategory'],
        'brand' => $row['brand'],
        'sku' => $row['sku'],
        'upc' => $row['upc'],
        'barcode' => $row['barcode'],
        'quantity' => (int) $row['quantity'],
        'unit' => $row['unit'],
        'min_quantity' => $row['min_quantity'] === null ? null : (int) $row['min_quantity'],
        'reorder_url' => $row['reorder_url'],
        'purchase_price' => $row['purchase_price'] === null ? null : (float) $row['purchase_price'],
        'pack_quantity' => empty($row['pack_quantity']) ? null : (int) $row['pack_quantity'],
        // What one unit actually costs once a pack price is divided out
        'unit_cost' => $row['purchase_price'] === null ? null
            : round((float) $row['purchase_price'] / max(1, (int) ($row['pack_quantity'] ?? 1)), 4),
        'purchase_date' => $row['purchase_date'],
        'vendor' => $row['vendor'],
        'location_id' => $row['location_id'],
        'home_location_id' => $row['home_location_id'],
        'photo_path' => $row['photo_path'],
        'notes' => $row['notes'],
        'tags' => $tags,
        'custom_fields' => $customFields,
        'whereabouts' => $row['whereabouts'] ?? null,
        'color' => $row['color'] ?? null,
        'color_hex' => $row['color_hex'] ?? null,
        'original_import_name' => $row['original_import_name'] ?? null,
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
        'created_by' => $row['created_by'],
        'filament' => $filament ? [
            'material' => $filament['material'],
            'color' => $filament['color'],
            'color_hex' => $filament['color_hex'],
            'color_mode' => $filament['color_mode'] ?? 'solid',
            'color_hex2' => $filament['color_hex2'] ?? null,
            'color_hex3' => $filament['color_hex3'] ?? null,
            'color_hex4' => $filament['color_hex4'] ?? null,
            'diameter' => $filament['diameter'] === null ? null : (float) $filament['diameter'],
            'spool_weight' => $filament['spool_weight'] === null ? null : (float) $filament['spool_weight'],
            'remaining_weight' => $filament['remaining_weight'] === null ? null : (float) $filament['remaining_weight'],
            'status' => $filament['status'],
            'printer_slot_id' => $filament['printer_slot_id'],
            'spool_type' => $filament['spool_type'],
            'dry_box_id' => $filament['dry_box_id'],
        ] : null,
        'tool' => $tool ? [
            'tool_type' => $tool['tool_type'],
            'serial_number' => $tool['serial_number'],
            'checked_out' => (bool) $tool['checked_out'],
            'checked_out_by' => $tool['checked_out_by'],
            'checked_out_at' => $tool['checked_out_at'],
            'home_location_id' => $tool['home_location_id'],
        ] : null,
    ];
}

/**
 * Batch-convert items rows, fetching filament/tool extensions in two bulk
 * queries (ports _rows_to_items from the FastAPI server, avoiding N+1).
 */
function rows_to_items(PDO $pdo, array $rows): array
{
    if (!$rows) {
        return [];
    }
    $ids = array_column($rows, 'id');
    $ph = implode(',', array_fill(0, count($ids), '?'));

    $filaments = [];
    $stmt = $pdo->prepare("SELECT * FROM filaments WHERE item_id IN ($ph)");
    $stmt->execute($ids);
    foreach ($stmt->fetchAll() as $fr) {
        $filaments[$fr['item_id']] = $fr;
    }

    $tools = [];
    $stmt = $pdo->prepare("SELECT * FROM tools WHERE item_id IN ($ph)");
    $stmt->execute($ids);
    foreach ($stmt->fetchAll() as $tr) {
        $tools[$tr['item_id']] = $tr;
    }

    $items = [];
    foreach ($rows as $row) {
        $f = $row['category'] === 'filament' ? ($filaments[$row['id']] ?? null) : null;
        $t = $row['category'] === 'tool' ? ($tools[$row['id']] ?? null) : null;
        $items[] = item_shape($row, $f, $t);
    }
    return $items;
}

/** Fetch one item by id in full API shape, or null. */
function fetch_item(PDO $pdo, string $id): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM items WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }
    $items = rows_to_items($pdo, [$row]);
    return $items[0];
}
