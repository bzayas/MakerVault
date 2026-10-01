<?php
/**
 * Locations endpoint.
 *
 * GET    locations.php              — full tree (with item_count per node)
 * GET    locations.php?flat=1       — flat list
 * GET    locations.php?id=<id>      — single location with children
 * GET    locations.php?id=<id>&items=1 — items at that location
 * GET    locations.php?qr=<value>   — lookup by QR value → {location, items}
 * POST   locations.php              — create
 * PUT    locations.php?id=<id>      — partial update
 * DELETE locations.php?id=<id>[&recursive=1] — delete (children re-parented unless recursive)
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

const LOCATION_TYPES = [
    'closetRack', 'shelf', 'rollingCart', 'cartLayer', 'cabinet', 'drawer',
    'gridfinityBin', 'wallStorage', 'wallBin', 'ikeaBin', 'stanleySortmaster',
    'sortmasterCompartment', 'toolBox', 'amsUnit', 'amsSlot', 'externalSpool',
    'dryBox', 'printer', 'inUse', 'custom',
];

switch (method()) {
    case 'GET':
        handle_get($pdo);
        break;
    case 'POST':
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

function location_shape(array $row, array $children = []): array
{
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'type' => $row['type'],
        'parent_id' => $row['parent_id'],
        'position' => $row['position'] === null ? null : (int) $row['position'],
        'qr_code_value' => $row['qr_code_value'],
        'notes' => $row['notes'],
        'capacity' => $row['capacity'] === null ? null : (int) $row['capacity'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
        'item_count' => (int) ($row['item_count'] ?? 0),
        'children' => $children,
    ];
}

function all_rows_with_counts(PDO $pdo): array
{
    return $pdo->query('
        SELECT l.*, COALESCE(ic.cnt, 0) AS item_count
        FROM locations l
        LEFT JOIN (SELECT location_id, COUNT(*) AS cnt FROM items GROUP BY location_id) ic
            ON l.id = ic.location_id
        ORDER BY l.position, l.name COLLATE NOCASE
    ')->fetchAll();
}

function build_tree(array $rows, ?string $parentId): array
{
    $byParent = [];
    foreach ($rows as $row) {
        $byParent[$row['parent_id'] ?? ''][] = $row;
    }
    $build = function (?string $pid) use (&$build, $byParent): array {
        $nodes = [];
        foreach ($byParent[$pid ?? ''] ?? [] as $row) {
            $nodes[] = location_shape($row, $build($row['id']));
        }
        usort($nodes, fn($a, $b) =>
            [($a['position'] ?? 0), strtolower($a['name'])] <=> [($b['position'] ?? 0), strtolower($b['name'])]
        );
        return $nodes;
    };
    return $build($parentId);
}

function handle_get(PDO $pdo): void
{
    if (isset($_GET['qr'])) {
        $stmt = $pdo->prepare('SELECT * FROM locations WHERE qr_code_value = ?');
        $stmt->execute([$_GET['qr']]);
        $row = $stmt->fetch();
        if (!$row) {
            fail('No location found for this QR code', 404);
        }
        $items = location_items($pdo, $row['id']);
        $row['item_count'] = count($items);
        respond(['location' => location_shape($row), 'items' => $items]);
    }

    if (isset($_GET['id'])) {
        if (isset($_GET['items'])) {
            respond(location_items($pdo, $_GET['id']));
        }
        $rows = all_rows_with_counts($pdo);
        foreach ($rows as $row) {
            if ($row['id'] === $_GET['id']) {
                respond(location_shape($row, build_tree($rows, $row['id'])));
            }
        }
        fail('Location not found', 404);
    }

    $rows = all_rows_with_counts($pdo);
    if (isset($_GET['flat'])) {
        respond(array_map(fn($r) => location_shape($r), $rows));
    }
    respond(build_tree($rows, null));
}

function location_items(PDO $pdo, string $locationId): array
{
    $stmt = $pdo->prepare('SELECT id FROM locations WHERE id = ?');
    $stmt->execute([$locationId]);
    if (!$stmt->fetch()) {
        fail('Location not found', 404);
    }
    $stmt = $pdo->prepare('SELECT * FROM items WHERE location_id = ? ORDER BY name COLLATE NOCASE');
    $stmt->execute([$locationId]);
    return rows_to_items($pdo, $stmt->fetchAll());
}

function handle_create(PDO $pdo): void
{
    $data = input_json();
    if (empty($data['name']) || empty($data['type'])) {
        fail('name and type are required');
    }
    if (!in_array($data['type'], LOCATION_TYPES, true)) {
        fail('Invalid location type: ' . $data['type']);
    }

    $id = uid();
    $ts = now();
    $qr = $data['qr_code_value'] ?? "makervault://location/$id";

    $pdo->prepare('
        INSERT INTO locations (id, name, type, parent_id, position, qr_code_value, notes, capacity, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ')->execute([
        $id, $data['name'], $data['type'], $data['parent_id'] ?? null,
        $data['position'] ?? null, $qr, $data['notes'] ?? null,
        $data['capacity'] ?? null, $ts, $ts,
    ]);

    $stmt = $pdo->prepare('SELECT *, 0 AS item_count FROM locations WHERE id = ?');
    $stmt->execute([$id]);
    respond(location_shape($stmt->fetch()), 201);
}

function handle_update(PDO $pdo): void
{
    $id = $_GET['id'] ?? null;
    if (!$id) {
        fail('id query parameter required');
    }
    $stmt = $pdo->prepare('SELECT * FROM locations WHERE id = ?');
    $stmt->execute([$id]);
    if (!$stmt->fetch()) {
        fail('Location not found', 404);
    }

    $data = input_json();
    if (isset($data['type']) && !in_array($data['type'], LOCATION_TYPES, true)) {
        fail('Invalid location type: ' . $data['type']);
    }

    // Re-parenting must not create a cycle (location under its own descendant)
    if (!empty($data['parent_id'])) {
        if ($data['parent_id'] === $id) {
            fail('A location cannot be its own parent');
        }
        $stmt = $pdo->prepare('SELECT parent_id FROM locations WHERE id = ?');
        $cursor = $data['parent_id'];
        $hops = 0;
        while ($cursor !== null && $hops++ < 100) {
            if ($cursor === $id) {
                fail('Cannot move a location under one of its own sub-locations');
            }
            $stmt->execute([$cursor]);
            $row2 = $stmt->fetch();
            if ($row2 === false) {
                fail('Parent location not found', 404);
            }
            $cursor = $row2['parent_id'];
        }
    }

    $sets = [];
    $vals = [];
    foreach (['name', 'type', 'parent_id', 'position', 'qr_code_value', 'notes', 'capacity'] as $f) {
        if (array_key_exists($f, $data)) {
            $sets[] = "$f = ?";
            $vals[] = $data[$f];
        }
    }
    if ($sets) {
        $sets[] = 'updated_at = ?';
        $vals[] = now();
        $vals[] = $id;
        $pdo->prepare('UPDATE locations SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
    }

    $rows = all_rows_with_counts($pdo);
    foreach ($rows as $row) {
        if ($row['id'] === $id) {
            respond(location_shape($row, build_tree($rows, $id)));
        }
    }
}

function handle_delete(PDO $pdo): void
{
    $id = $_GET['id'] ?? null;
    if (!$id) {
        fail('id query parameter required');
    }
    $stmt = $pdo->prepare('SELECT * FROM locations WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
        fail('Location not found', 404);
    }

    if (!empty($_GET['recursive'])) {
        $deleteTree = function (string $locId) use (&$deleteTree, $pdo): void {
            $stmt = $pdo->prepare('SELECT id FROM locations WHERE parent_id = ?');
            $stmt->execute([$locId]);
            foreach ($stmt->fetchAll() as $child) {
                $deleteTree($child['id']);
            }
            $pdo->prepare('DELETE FROM locations WHERE id = ?')->execute([$locId]);
        };
        $deleteTree($id);
    } else {
        $pdo->prepare('UPDATE locations SET parent_id = ?, updated_at = ? WHERE parent_id = ?')
            ->execute([$row['parent_id'], now(), $id]);
        $pdo->prepare('DELETE FROM locations WHERE id = ?')->execute([$id]);
    }

    respond(['deleted' => true]);
}
