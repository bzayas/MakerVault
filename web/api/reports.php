<?php
/**
 * Inventory analytics — ports Server/routes/reports.py (/api/reports/value
 * and /api/reports/monthly-spending) into one payload.
 *
 * GET reports.php → {
 *   total_value, total_items, priced_items, missing_price_count,
 *   by_category: [{category, value, count}],          // value DESC
 *   by_vendor:   [{vendor, value, count}],            // normalized, value DESC
 *   monthly:     [{month: "YYYY-MM", total, count}],  // last 12, chronological
 *   recent_purchases: [{date, total, count}],         // last 15 purchase days
 * }
 *
 * Only items with a price participate in value sums (same rule as the
 * native app's reports.py). Legacy free-text purchase dates fall out of the
 * monthly buckets (strftime returns NULL for them) — also inherited.
 */

require __DIR__ . '/_bootstrap.php';

if (method() !== 'GET') {
    fail('Method not allowed', 405);
}

$pdo = db();

$totalValue = (float) $pdo->query(
    'SELECT COALESCE(SUM(purchase_price / MAX(1, COALESCE(pack_quantity, 1)) * quantity), 0) FROM items
     WHERE purchase_price IS NOT NULL AND purchase_price > 0'
)->fetchColumn();

$totalItems = (int) $pdo->query('SELECT COUNT(*) FROM items')->fetchColumn();
$missingPrice = (int) $pdo->query(
    'SELECT COUNT(*) FROM items WHERE purchase_price IS NULL OR purchase_price = 0'
)->fetchColumn();

$byCategory = $pdo->query(
    'SELECT category, SUM(purchase_price / MAX(1, COALESCE(pack_quantity, 1)) * quantity) AS value, COUNT(*) AS count
     FROM items WHERE purchase_price IS NOT NULL AND purchase_price > 0
     GROUP BY category ORDER BY value DESC'
)->fetchAll();

// Vendors: fold "Amazon (SellerName)" import vendors into their base vendor
$vendorRows = $pdo->query(
    "SELECT vendor, SUM(purchase_price / MAX(1, COALESCE(pack_quantity, 1)) * quantity) AS value, COUNT(*) AS count
     FROM items WHERE purchase_price IS NOT NULL AND purchase_price > 0
     AND vendor IS NOT NULL AND vendor != '' GROUP BY vendor"
)->fetchAll();
$vendors = [];
foreach ($vendorRows as $r) {
    $base = trim(preg_replace('/\s*\(.*\)\s*$/', '', $r['vendor'])) ?: $r['vendor'];
    $vendors[$base] ??= ['vendor' => $base, 'value' => 0.0, 'count' => 0];
    $vendors[$base]['value'] += (float) $r['value'];
    $vendors[$base]['count'] += (int) $r['count'];
}
usort($vendors, static fn ($a, $b) => $b['value'] <=> $a['value']);

$monthRows = $pdo->query(
    "SELECT strftime('%Y-%m', purchase_date) AS month,
            SUM(purchase_price / MAX(1, COALESCE(pack_quantity, 1)) * quantity) AS total, COUNT(*) AS count
     FROM items WHERE purchase_date IS NOT NULL AND purchase_price IS NOT NULL
     AND purchase_price > 0 AND strftime('%Y-%m', purchase_date) IS NOT NULL
     GROUP BY month ORDER BY month DESC LIMIT 12"
)->fetchAll();

// Zero-fill so the axis is honest calendar time: a continuous 12-month
// window ending at the most recent month that has data.
$monthly = [];
if ($monthRows) {
    $byMonth = array_column($monthRows, null, 'month');
    $cursor = new DateTimeImmutable($monthRows[0]['month'] . '-01');
    for ($i = 11; $i >= 0; $i--) {
        $m = $cursor->modify("-$i months")->format('Y-m');
        $monthly[] = $byMonth[$m] ?? ['month' => $m, 'total' => 0.0, 'count' => 0];
    }
}

$recent = $pdo->query(
    "SELECT substr(purchase_date, 1, 10) AS date,
            SUM(purchase_price / MAX(1, COALESCE(pack_quantity, 1)) * quantity) AS total, COUNT(*) AS count
     FROM items WHERE purchase_date IS NOT NULL AND purchase_price IS NOT NULL
     AND purchase_price > 0 AND strftime('%Y-%m-%d', purchase_date) IS NOT NULL
     GROUP BY date ORDER BY date DESC LIMIT 15"
)->fetchAll();

respond([
    'total_value' => round($totalValue, 2),
    'total_items' => $totalItems,
    'priced_items' => $totalItems - $missingPrice,
    'missing_price_count' => $missingPrice,
    'by_category' => array_map(static fn ($r) => [
        'category' => $r['category'],
        'value' => round((float) $r['value'], 2),
        'count' => (int) $r['count'],
    ], $byCategory),
    'by_vendor' => array_values(array_map(static fn ($v) => [
        'vendor' => $v['vendor'],
        'value' => round($v['value'], 2),
        'count' => $v['count'],
    ], $vendors)),
    'monthly' => array_map(static fn ($r) => [
        'month' => $r['month'],
        'total' => round((float) $r['total'], 2),
        'count' => (int) $r['count'],
    ], $monthly),
    'recent_purchases' => array_map(static fn ($r) => [
        'date' => $r['date'],
        'total' => round((float) $r['total'], 2),
        'count' => (int) $r['count'],
    ], $recent),
]);
