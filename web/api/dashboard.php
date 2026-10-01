<?php
/**
 * Dashboard summary — ports GET /api/dashboard from the FastAPI server,
 * plus inventory value totals (from reports.py).
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

if (method() !== 'GET') {
    fail('Method not allowed', 405);
}

$count = fn(string $sql) => (int) $pdo->query($sql)->fetch()['cnt'];

$totalItems = $count('SELECT COUNT(*) AS cnt FROM items');
$lowStock = $count('SELECT COUNT(*) AS cnt FROM items WHERE min_quantity IS NOT NULL AND quantity <= min_quantity');
$outOfStock = $count('SELECT COUNT(*) AS cnt FROM items WHERE quantity = 0');
$checkedOutTools = $count('SELECT COUNT(*) AS cnt FROM tools WHERE checked_out = 1');
$filamentsLoaded = $count("SELECT COUNT(*) AS cnt FROM filaments WHERE status IN ('loadedInAMS', 'loadedExternal')");

$totalValue = (float) $pdo->query(
    'SELECT COALESCE(SUM(purchase_price / MAX(1, COALESCE(pack_quantity, 1)) * quantity), 0) AS v FROM items WHERE purchase_price IS NOT NULL AND purchase_price > 0'
)->fetch()['v'];

$recentActivity = $pdo->query('
    SELECT a.*, i.name AS item_name
    FROM activity_log a
    LEFT JOIN items i ON i.id = a.item_id
    ORDER BY a.timestamp DESC
    LIMIT 10
')->fetchAll();

$categoryCounts = [];
foreach ($pdo->query('SELECT category, COUNT(*) AS cnt FROM items GROUP BY category ORDER BY cnt DESC') as $r) {
    $categoryCounts[$r['category']] = (int) $r['cnt'];
}

// Filament overview: counts by material + loaded spools with colors
$filamentByMaterial = [];
foreach ($pdo->query('
    SELECT f.material, COUNT(*) AS cnt
    FROM filaments f JOIN items i ON i.id = f.item_id
    GROUP BY f.material ORDER BY cnt DESC
') as $r) {
    $filamentByMaterial[$r['material']] = (int) $r['cnt'];
}

$loadedFilaments = $pdo->query("
    SELECT i.id, i.name, f.material, f.color, f.color_hex, f.color_mode,
           f.color_hex2, f.color_hex3, f.color_hex4, f.status, f.remaining_weight, f.spool_weight
    FROM filaments f JOIN items i ON i.id = f.item_id
    WHERE f.status IN ('loadedInAMS', 'loadedExternal')
    ORDER BY i.name COLLATE NOCASE
")->fetchAll();

respond([
    'total_items' => $totalItems,
    'low_stock_count' => $lowStock,
    'out_of_stock_count' => $outOfStock,
    'checked_out_tools' => $checkedOutTools,
    'filaments_loaded' => $filamentsLoaded,
    'total_value' => round($totalValue, 2),
    'recent_activity' => $recentActivity,
    'category_counts' => $categoryCounts,
    'filament_by_material' => $filamentByMaterial,
    'loaded_filaments' => $loadedFilaments,
]);
