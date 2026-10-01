<?php
/**
 * Categories endpoint.
 *
 * GET    categories.php            — ordered list
 * POST   categories.php            — create {key, display_name, icon, color}
 * POST   categories.php?action=reorder — {keys: [ordered keys]}
 * PUT    categories.php?key=<key>  — update {display_name?, icon?, color?, new_key?}
 * DELETE categories.php?key=<key>  — delete non-builtin; its items move to "other"
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

function category_shape(array $r): array
{
    return [
        'key' => $r['key'],
        'display_name' => $r['display_name'],
        'icon' => $r['icon'],
        'color' => $r['color'],
        'position' => (int) $r['position'],
        'is_builtin' => (bool) $r['is_builtin'],
        'item_count' => (int) ($r['item_count'] ?? 0),
    ];
}

switch (method()) {
    case 'GET':
        $rows = $pdo->query('
            SELECT c.*, COALESCE(ic.cnt, 0) AS item_count
            FROM categories c
            LEFT JOIN (SELECT category, COUNT(*) AS cnt FROM items GROUP BY category) ic
                ON c.key = ic.category
            ORDER BY c.position, c.display_name COLLATE NOCASE
        ')->fetchAll();
        respond(array_map('category_shape', $rows));

    case 'POST':
        if (($_GET['action'] ?? '') === 'reorder') {
            $data = input_json();
            $keys = $data['keys'] ?? [];
            if (!is_array($keys) || !$keys) {
                fail('keys array required');
            }
            $stmt = $pdo->prepare('UPDATE categories SET position = ?, updated_at = ? WHERE key = ?');
            foreach ($keys as $i => $key) {
                $stmt->execute([$i, now(), $key]);
            }
            respond(['ok' => true]);
        }

        $data = input_json();
        if (empty($data['key']) || empty($data['display_name'])) {
            fail('key and display_name are required');
        }
        if (!preg_match('/^[a-z0-9_]+$/', $data['key'])) {
            fail('key must be lowercase letters, digits, and underscores');
        }
        $stmt = $pdo->prepare('SELECT key FROM categories WHERE key = ?');
        $stmt->execute([$data['key']]);
        if ($stmt->fetch()) {
            fail('Category key already exists', 409);
        }
        $max = (int) $pdo->query('SELECT COALESCE(MAX(position), -1) AS m FROM categories')->fetch()['m'];
        $ts = now();
        $pdo->prepare('
            INSERT INTO categories (key, display_name, icon, color, position, is_builtin, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        ')->execute([
            $data['key'], $data['display_name'],
            $data['icon'] ?? 'shippingbox', $data['color'] ?? '#8E8E93',
            $max + 1, $ts, $ts,
        ]);
        $stmt = $pdo->prepare('SELECT *, 0 AS item_count FROM categories WHERE key = ?');
        $stmt->execute([$data['key']]);
        respond(category_shape($stmt->fetch()), 201);

    case 'PUT':
    case 'PATCH':
        $key = $_GET['key'] ?? null;
        if (!$key) {
            fail('key query parameter required');
        }
        $stmt = $pdo->prepare('SELECT * FROM categories WHERE key = ?');
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        if (!$row) {
            fail('Category not found', 404);
        }

        $data = input_json();
        $pdo->beginTransaction();
        try {
            $sets = [];
            $vals = [];
            foreach (['display_name', 'icon', 'color', 'position'] as $f) {
                if (array_key_exists($f, $data)) {
                    $sets[] = "$f = ?";
                    $vals[] = $data[$f];
                }
            }
            if ($sets) {
                $sets[] = 'updated_at = ?';
                $vals[] = now();
                $vals[] = $key;
                $pdo->prepare('UPDATE categories SET ' . implode(', ', $sets) . ' WHERE key = ?')->execute($vals);
            }

            // Key rename: move the category row and every item that uses it
            if (!empty($data['new_key']) && $data['new_key'] !== $key) {
                if (!preg_match('/^[a-z0-9_]+$/', $data['new_key'])) {
                    throw new RuntimeException('new_key must be lowercase letters, digits, and underscores');
                }
                $stmt = $pdo->prepare('SELECT key FROM categories WHERE key = ?');
                $stmt->execute([$data['new_key']]);
                if ($stmt->fetch()) {
                    throw new RuntimeException('new_key already exists');
                }
                $pdo->prepare('UPDATE categories SET key = ?, updated_at = ? WHERE key = ?')
                    ->execute([$data['new_key'], now(), $key]);
                $pdo->prepare('UPDATE items SET category = ? WHERE category = ?')
                    ->execute([$data['new_key'], $key]);
                $key = $data['new_key'];
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail($e->getMessage());
        }

        $stmt = $pdo->prepare('
            SELECT c.*, COALESCE(ic.cnt, 0) AS item_count
            FROM categories c
            LEFT JOIN (SELECT category, COUNT(*) AS cnt FROM items GROUP BY category) ic
                ON c.key = ic.category
            WHERE c.key = ?
        ');
        $stmt->execute([$key]);
        respond(category_shape($stmt->fetch()));

    case 'DELETE':
        $key = $_GET['key'] ?? null;
        if (!$key) {
            fail('key query parameter required');
        }
        $stmt = $pdo->prepare('SELECT * FROM categories WHERE key = ?');
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        if (!$row) {
            fail('Category not found', 404);
        }
        if ($row['is_builtin']) {
            fail('Built-in categories cannot be deleted', 403);
        }
        if ($key === 'other') {
            fail('The "other" category cannot be deleted', 403);
        }
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE items SET category = ?, updated_at = ? WHERE category = ?')
                ->execute(['other', now(), $key]);
            $pdo->prepare('DELETE FROM categories WHERE key = ?')->execute([$key]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail('Delete failed: ' . $e->getMessage(), 500);
        }
        respond(['deleted' => true]);

    default:
        fail('Method not allowed', 405);
}
