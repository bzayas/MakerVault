<?php
/**
 * Activity log endpoint.
 *
 * GET activity.php?action=&item_id=&search=&limit=&offset=
 * Returns entries newest-first, with item_name joined for display.
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

if (method() !== 'GET') {
    fail('Method not allowed', 405);
}

$conditions = [];
$params = [];

if (!empty($_GET['action'])) {
    $conditions[] = 'a.action = ?';
    $params[] = $_GET['action'];
}
if (!empty($_GET['item_id'])) {
    $conditions[] = 'a.item_id = ?';
    $params[] = $_GET['item_id'];
}
if (!empty($_GET['search'])) {
    $conditions[] = '(a.details LIKE ? OR i.name LIKE ?)';
    $q = '%' . $_GET['search'] . '%';
    $params[] = $q;
    $params[] = $q;
}

$where = $conditions ? 'WHERE ' . implode(' AND ', $conditions) : '';
$limit = min((int) ($_GET['limit'] ?? 50), 200);
$offset = max((int) ($_GET['offset'] ?? 0), 0);

$stmt = $pdo->prepare("
    SELECT a.*, i.name AS item_name
    FROM activity_log a
    LEFT JOIN items i ON i.id = a.item_id
    $where
    ORDER BY a.timestamp DESC
    LIMIT ? OFFSET ?
");
$params[] = $limit;
$params[] = $offset;
$stmt->execute($params);

respond($stmt->fetchAll());
