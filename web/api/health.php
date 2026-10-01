<?php
/** Health check — quick sanity endpoint for setup and troubleshooting. */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

$count = fn(string $table) => (int) $pdo->query("SELECT COUNT(*) AS cnt FROM $table")->fetch()['cnt'];

respond([
    'app' => 'MakerVault',
    'status' => 'healthy',
    'version' => MV_VERSION,
    'php' => PHP_VERSION,
    'items' => $count('items'),
    'locations' => $count('locations'),
    'categories' => $count('categories'),
    'database' => basename(MV_DB_PATH),
    'db_writable' => is_writable(MV_DB_PATH) && is_writable(MV_DATA_DIR),
]);
