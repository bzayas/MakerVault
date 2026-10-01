<?php
/**
 * Printers + AMS slots endpoint — ports routes/printers.py.
 *
 * GET    printers.php                       — printers with nested slots
 *                                             (each slot carries its loaded filament summary)
 * POST   printers.php                       — create {name, model, notes, slots?: []}
 * PUT    printers.php?id=<id>               — update printer {name?, model?, notes?}
 * DELETE printers.php?id=<id>               — delete (filaments unloaded first)
 * POST   printers.php?id=<id>&action=add_slot — {ams_type, ams_unit_number, slot_number, name?}
 * PUT    printers.php?slot=<slot_id>        — rename slot {name}
 * DELETE printers.php?slot=<slot_id>        — delete slot (unloads filament)
 * PUT    printers.php?slot=<id>&action=load   — {filament_item_id}
 * PUT    printers.php?slot=<id>&action=unload — {return_location_id?}
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();
ensure_column($pdo, 'printer_slots', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
ensure_column($pdo, 'printer_slots', 'name', 'TEXT');

$slotId = $_GET['slot'] ?? null;
$action = $_GET['action'] ?? '';

if ($slotId) {
    handle_slot($pdo, $slotId, $action);
}

switch (method()) {
    case 'GET':
        respond(all_printers($pdo));

    case 'POST':
        if ($action === 'add_slot') {
            add_slot($pdo, $_GET['id'] ?? '');
        }
        create_printer($pdo);
        break;

    case 'PUT':
    case 'PATCH':
        update_printer($pdo, $_GET['id'] ?? '');
        break;

    case 'DELETE':
        delete_printer($pdo, $_GET['id'] ?? '');
        break;

    default:
        fail('Method not allowed', 405);
}

// ---------------------------------------------------------------------------

function slot_shape(array $s, ?array $filament): array
{
    return [
        'id' => $s['id'],
        'printer_id' => $s['printer_id'],
        'ams_type' => $s['ams_type'],
        'ams_unit_number' => (int) $s['ams_unit_number'],
        'slot_number' => (int) $s['slot_number'],
        'name' => $s['name'],
        'sort_order' => (int) ($s['sort_order'] ?? 0),
        'current_filament_id' => $s['current_filament_id'],
        'location_id' => $s['location_id'],
        // Summary of the loaded spool so the UI needs no follow-up requests
        'filament' => $filament,
    ];
}

function all_printers(PDO $pdo): array
{
    $printers = $pdo->query('SELECT * FROM printers ORDER BY name')->fetchAll();
    $slots = $pdo->query('
        SELECT ps.*
        FROM printer_slots ps
        ORDER BY ps.sort_order, ps.ams_type, ps.ams_unit_number, ps.slot_number
    ')->fetchAll();

    // Loaded filament summaries in one query
    $filaments = [];
    foreach ($pdo->query('
        SELECT i.id, i.name, f.material, f.color, f.color_hex, f.color_mode,
               f.color_hex2, f.color_hex3, f.color_hex4, f.remaining_weight, f.spool_weight
        FROM filaments f JOIN items i ON i.id = f.item_id
        WHERE f.printer_slot_id IS NOT NULL
    ') as $fr) {
        $filaments[$fr['id']] = $fr;
    }

    $byPrinter = [];
    foreach ($slots as $s) {
        $fil = $s['current_filament_id'] ? ($filaments[$s['current_filament_id']] ?? null) : null;
        $byPrinter[$s['printer_id']][] = slot_shape($s, $fil);
    }

    return array_map(fn($p) => [
        'id' => $p['id'],
        'name' => $p['name'],
        'model' => $p['model'],
        'notes' => $p['notes'],
        'slots' => $byPrinter[$p['id']] ?? [],
        'created_at' => $p['created_at'],
        'updated_at' => $p['updated_at'],
    ], $printers);
}

function create_printer(PDO $pdo): void
{
    $data = input_json();
    if (empty($data['name']) || empty($data['model'])) {
        fail('name and model are required');
    }
    $id = uid();
    $ts = now();
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO printers (id, name, model, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$id, $data['name'], $data['model'], $data['notes'] ?? null, $ts, $ts]);
        foreach ($data['slots'] ?? [] as $i => $slot) {
            $pdo->prepare('
                INSERT INTO printer_slots (id, printer_id, ams_type, ams_unit_number, slot_number, name, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ')->execute([
                uid(), $id, $slot['ams_type'], $slot['ams_unit_number'] ?? 1,
                $slot['slot_number'] ?? 1, $slot['name'] ?? null, $i, $ts, $ts,
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('Create failed: ' . $e->getMessage(), 500);
    }
    respond(printer_by_id($pdo, $id), 201);
}

function printer_by_id(PDO $pdo, string $id): ?array
{
    foreach (all_printers($pdo) as $p) {
        if ($p['id'] === $id) {
            return $p;
        }
    }
    return null;
}

function update_printer(PDO $pdo, string $id): void
{
    if (!printer_by_id($pdo, $id)) {
        fail('Printer not found', 404);
    }
    $data = input_json();
    $sets = [];
    $vals = [];
    foreach (['name', 'model', 'notes'] as $f) {
        if (array_key_exists($f, $data)) {
            $sets[] = "$f = ?";
            $vals[] = $data[$f];
        }
    }
    if ($sets) {
        $sets[] = 'updated_at = ?';
        $vals[] = now();
        $vals[] = $id;
        $pdo->prepare('UPDATE printers SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
    }
    respond(printer_by_id($pdo, $id));
}

function delete_printer(PDO $pdo, string $id): void
{
    if (!printer_by_id($pdo, $id)) {
        fail('Printer not found', 404);
    }
    $pdo->beginTransaction();
    try {
        // Return loaded filaments to stock before the slots disappear
        $pdo->prepare("
            UPDATE filaments SET status = 'inStock', printer_slot_id = NULL
            WHERE printer_slot_id IN (SELECT id FROM printer_slots WHERE printer_id = ?)
        ")->execute([$id]);
        $pdo->prepare('DELETE FROM printers WHERE id = ?')->execute([$id]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('Delete failed: ' . $e->getMessage(), 500);
    }
    respond(['deleted' => true]);
}

function add_slot(PDO $pdo, string $printerId): void
{
    if (!printer_by_id($pdo, $printerId)) {
        fail('Printer not found', 404);
    }
    $data = input_json();
    if (empty($data['ams_type'])) {
        fail('ams_type is required');
    }
    $max = (int) $pdo->query('SELECT COALESCE(MAX(sort_order), -1) AS m FROM printer_slots')->fetch()['m'];
    $ts = now();
    $id = uid();
    $pdo->prepare('
        INSERT INTO printer_slots (id, printer_id, ams_type, ams_unit_number, slot_number, name, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ')->execute([
        $id, $printerId, $data['ams_type'], $data['ams_unit_number'] ?? 1,
        $data['slot_number'] ?? 1, $data['name'] ?? null, $max + 1, $ts, $ts,
    ]);
    respond(printer_by_id($pdo, $printerId), 201);
}

// ---------------------------------------------------------------------------

function handle_slot(PDO $pdo, string $slotId, string $action): void
{
    $stmt = $pdo->prepare('SELECT * FROM printer_slots WHERE id = ?');
    $stmt->execute([$slotId]);
    $slot = $stmt->fetch();
    if (!$slot) {
        fail('Slot not found', 404);
    }

    if (method() === 'PUT' && $action === 'load') {
        $data = input_json();
        $filamentId = $data['filament_item_id'] ?? null;
        if (!$filamentId) {
            fail('filament_item_id is required');
        }
        $stmt = $pdo->prepare("SELECT * FROM items WHERE id = ? AND category = 'filament'");
        $stmt->execute([$filamentId]);
        $item = $stmt->fetch();
        if (!$item) {
            fail('Filament item not found', 404);
        }

        $ts = now();
        $pdo->beginTransaction();
        try {
            // If loaded elsewhere, unload from that slot first
            $pdo->prepare('UPDATE printer_slots SET current_filament_id = NULL, updated_at = ? WHERE current_filament_id = ?')
                ->execute([$ts, $filamentId]);
            $pdo->prepare('UPDATE printer_slots SET current_filament_id = ?, updated_at = ? WHERE id = ?')
                ->execute([$filamentId, $ts, $slotId]);
            $status = $slot['ams_type'] !== 'externalManual' ? 'loadedInAMS' : 'loadedExternal';
            $pdo->prepare('UPDATE filaments SET status = ?, printer_slot_id = ? WHERE item_id = ?')
                ->execute([$status, $slotId, $filamentId]);
            // Remember where it lived so unload can send it home
            $pdo->prepare('
                UPDATE items SET home_location_id = COALESCE(home_location_id, location_id),
                    location_id = NULL, updated_at = ? WHERE id = ?
            ')->execute([$ts, $filamentId]);
            log_activity($pdo, 'moved', $filamentId, null, sprintf('Loaded %s into printer slot', $item['name']));
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail('Load failed: ' . $e->getMessage(), 500);
        }
        respond(['loaded' => true, 'slot_id' => $slotId, 'filament_item_id' => $filamentId]);
    }

    if (method() === 'PUT' && $action === 'unload') {
        $data = input_json();
        $filamentId = $slot['current_filament_id'];
        $ts = now();
        $pdo->beginTransaction();
        try {
            if ($filamentId) {
                $pdo->prepare("UPDATE filaments SET status = 'inStock', printer_slot_id = NULL WHERE item_id = ?")
                    ->execute([$filamentId]);
                $returnTo = $data['return_location_id'] ?? null;
                if (!$returnTo) {
                    $stmt = $pdo->prepare('SELECT home_location_id, name FROM items WHERE id = ?');
                    $stmt->execute([$filamentId]);
                    $row = $stmt->fetch();
                    $returnTo = $row['home_location_id'] ?? null;
                }
                $pdo->prepare('UPDATE items SET location_id = ?, updated_at = ? WHERE id = ?')
                    ->execute([$returnTo, $ts, $filamentId]);
                log_activity($pdo, 'moved', $filamentId, $returnTo, 'Unloaded from printer slot');
            }
            $pdo->prepare('UPDATE printer_slots SET current_filament_id = NULL, updated_at = ? WHERE id = ?')
                ->execute([$ts, $slotId]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail('Unload failed: ' . $e->getMessage(), 500);
        }
        respond(['unloaded' => true, 'slot_id' => $slotId]);
    }

    if (method() === 'PUT') {
        // Rename
        $data = input_json();
        if (array_key_exists('name', $data)) {
            $name = trim((string) $data['name']);
            $pdo->prepare('UPDATE printer_slots SET name = ?, updated_at = ? WHERE id = ?')
                ->execute([$name === '' ? null : $name, now(), $slotId]);
        }
        respond(['updated' => true, 'slot_id' => $slotId]);
    }

    if (method() === 'DELETE') {
        $pdo->beginTransaction();
        try {
            if ($slot['current_filament_id']) {
                $pdo->prepare("UPDATE filaments SET status = 'inStock', printer_slot_id = NULL WHERE item_id = ?")
                    ->execute([$slot['current_filament_id']]);
            }
            $pdo->prepare('DELETE FROM printer_slots WHERE id = ?')->execute([$slotId]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail('Delete failed: ' . $e->getMessage(), 500);
        }
        respond(['deleted' => true]);
    }

    fail('Method not allowed', 405);
}
