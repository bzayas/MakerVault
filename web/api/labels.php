<?php
/**
 * Label templates + presets endpoint.
 *
 * Rendering happens client-side on a <canvas> (ports label_renderer.py /
 * label_composer.py to JS) — this endpoint only stores configuration and
 * serves the item/location data used for token substitution.
 *
 * GET    labels.php                  — list templates (lines decoded)
 * GET    labels.php?id=<id>          — single template
 * GET    labels.php?data=item&id=<item_id>      — label-data dict for an item
 *                                       (filament color fields merged, like labels.py _fetch_item)
 * GET    labels.php?data=location&id=<loc_id>   — label-data dict for a location
 * POST   labels.php                  — create template
 * PUT    labels.php?id=<id>          — update template
 * DELETE labels.php?id=<id>          — delete template
 * GET    labels.php?presets=1        — list size presets
 * POST   labels.php?presets=1        — create preset {name, width_mm, height_mm}
 * DELETE labels.php?presets=1&id=<id>— delete preset
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

if (isset($_GET['presets'])) {
    handle_presets($pdo);
}
if (($_GET['data'] ?? '') !== '') {
    handle_data($pdo);
}

switch (method()) {
    case 'GET':
        if (isset($_GET['id'])) {
            $t = fetch_template($pdo, $_GET['id']);
            if (!$t) {
                fail('Template not found', 404);
            }
            respond($t);
        }
        $rows = $pdo->query('SELECT * FROM label_templates ORDER BY updated_at DESC')->fetchAll();
        respond(array_map('template_shape', $rows));

    case 'POST':
        $data = input_json();
        if (empty($data['name']) || empty($data['width_mm']) || empty($data['height_mm'])) {
            fail('name, width_mm and height_mm are required');
        }
        $id = uid();
        $ts = now();
        $pdo->prepare('
            INSERT INTO label_templates
                (id, name, width_mm, height_mm, background_color, border_enabled,
                 border_thickness, border_color, padding_mm, auto_fit, lines_config,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ')->execute([
            $id, $data['name'], (float) $data['width_mm'], (float) $data['height_mm'],
            $data['background_color'] ?? '#FFFFFF',
            (int) ($data['border_enabled'] ?? 0),
            (float) ($data['border_thickness'] ?? 0.5),
            $data['border_color'] ?? '#000000',
            (float) ($data['padding_mm'] ?? 1.0),
            (int) ($data['auto_fit'] ?? 1),
            json_encode($data['lines'] ?? []),
            $ts, $ts,
        ]);
        respond(fetch_template($pdo, $id), 201);

    case 'PUT':
    case 'PATCH':
        $id = $_GET['id'] ?? null;
        if (!$id || !fetch_template($pdo, $id)) {
            fail('Template not found', 404);
        }
        $data = input_json();
        $sets = [];
        $vals = [];
        foreach (['name', 'width_mm', 'height_mm', 'background_color', 'border_thickness',
                  'border_color', 'padding_mm'] as $f) {
            if (array_key_exists($f, $data)) {
                $sets[] = "$f = ?";
                $vals[] = $data[$f];
            }
        }
        foreach (['border_enabled', 'auto_fit'] as $f) {
            if (array_key_exists($f, $data)) {
                $sets[] = "$f = ?";
                $vals[] = (int) (bool) $data[$f];
            }
        }
        if (array_key_exists('lines', $data)) {
            $sets[] = 'lines_config = ?';
            $vals[] = json_encode($data['lines'] ?? []);
        }
        if ($sets) {
            $sets[] = 'updated_at = ?';
            $vals[] = now();
            $vals[] = $id;
            $pdo->prepare('UPDATE label_templates SET ' . implode(', ', $sets) . ' WHERE id = ?')
                ->execute($vals);
        }
        respond(fetch_template($pdo, $id));

    case 'DELETE':
        $id = $_GET['id'] ?? null;
        if (!$id) {
            fail('id query parameter required');
        }
        $pdo->prepare('DELETE FROM label_templates WHERE id = ?')->execute([$id]);
        respond(['deleted' => true]);

    default:
        fail('Method not allowed', 405);
}

// ---------------------------------------------------------------------------

function template_shape(array $row): array
{
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'width_mm' => (float) $row['width_mm'],
        'height_mm' => (float) $row['height_mm'],
        'background_color' => $row['background_color'],
        'border_enabled' => (bool) $row['border_enabled'],
        'border_thickness' => (float) $row['border_thickness'],
        'border_color' => $row['border_color'],
        'padding_mm' => (float) $row['padding_mm'],
        'auto_fit' => (bool) $row['auto_fit'],
        'lines' => json_decode($row['lines_config'] ?? '[]', true) ?: [],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
    ];
}

function fetch_template(PDO $pdo, string $id): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM label_templates WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ? template_shape($row) : null;
}

/** Item/location dict used for {token} substitution, mirroring labels.py. */
function handle_data(PDO $pdo): void
{
    $id = $_GET['id'] ?? null;
    if (!$id) {
        fail('id query parameter required');
    }

    if ($_GET['data'] === 'item') {
        $stmt = $pdo->prepare('SELECT * FROM items WHERE id = ?');
        $stmt->execute([$id]);
        $d = $stmt->fetch();
        if (!$d) {
            fail('Item not found', 404);
        }
        $d['tags'] = json_decode($d['tags'] ?? '[]', true) ?: [];
        // Filament color data takes priority over the base item's color fields
        if ($d['category'] === 'filament') {
            $stmt = $pdo->prepare(
                'SELECT color, color_hex, material, color_mode, color_hex2, color_hex3, color_hex4
                 FROM filaments WHERE item_id = ?'
            );
            $stmt->execute([$id]);
            if ($fr = $stmt->fetch()) {
                $d['color'] = $fr['color'] ?: $d['color'];
                $d['color_hex'] = $fr['color_hex'] ?: $d['color_hex'];
                $d['material'] = $fr['material'];
                $d['color_mode'] = $fr['color_mode'];
                $d['color_hex2'] = $fr['color_hex2'];
                $d['color_hex3'] = $fr['color_hex3'];
                $d['color_hex4'] = $fr['color_hex4'];
            }
        }
        unset($d['photo_data']);
        respond($d);
    }

    if ($_GET['data'] === 'location') {
        $stmt = $pdo->prepare('SELECT * FROM locations WHERE id = ?');
        $stmt->execute([$id]);
        $d = $stmt->fetch();
        if (!$d) {
            fail('Location not found', 404);
        }
        respond($d);
    }

    fail('data must be "item" or "location"');
}

function handle_presets(PDO $pdo): void
{
    switch (method()) {
        case 'GET':
            $rows = $pdo->query('SELECT * FROM label_presets ORDER BY name')->fetchAll();
            respond(array_map(fn($r) => [
                'id' => $r['id'],
                'name' => $r['name'],
                'width_mm' => (float) $r['width_mm'],
                'height_mm' => (float) $r['height_mm'],
            ], $rows));

        case 'POST':
            $data = input_json();
            if (empty($data['name']) || empty($data['width_mm']) || empty($data['height_mm'])) {
                fail('name, width_mm and height_mm are required');
            }
            $id = uid();
            $pdo->prepare('INSERT INTO label_presets (id, name, width_mm, height_mm) VALUES (?, ?, ?, ?)')
                ->execute([$id, $data['name'], (float) $data['width_mm'], (float) $data['height_mm']]);
            respond([
                'id' => $id, 'name' => $data['name'],
                'width_mm' => (float) $data['width_mm'], 'height_mm' => (float) $data['height_mm'],
            ], 201);

        case 'DELETE':
            $id = $_GET['id'] ?? null;
            if (!$id) {
                fail('id query parameter required');
            }
            $pdo->prepare('DELETE FROM label_presets WHERE id = ?')->execute([$id]);
            respond(['deleted' => true]);

        default:
            fail('Method not allowed', 405);
    }
}
