<?php
/**
 * Duplicate finder + merge — ports the /api/items/duplicates and
 * /api/items/merge routes (fuzzy matching rules from items.py).
 *
 * GET  duplicates.php   — {groups: [...], hidden_pairs: n} (dismissed pairs excluded)
 * POST duplicates.php   — merge {keep_id, merge_ids: [], add_quantities: true}
 *                       — {action: "dismiss", item_ids: [...]} hide a group forever
 *                       — {action: "restore_all"} un-hide everything
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

if (method() === 'GET') {
    respond(find_duplicates($pdo));
}
if (method() === 'POST') {
    $req = input_json();
    $action = $req['action'] ?? 'merge';
    if ($action === 'dismiss') {
        respond(dismiss_pairs($pdo, $req));
    }
    if ($action === 'restore_all') {
        $pdo->exec('DELETE FROM duplicate_dismissals');
        respond(['restored' => true]);
    }
    respond(merge_items($pdo, $req));
}
fail('Method not allowed', 405);

// ---------------------------------------------------------------------------

function normalize_name(string $name): string
{
    $n = strtolower(trim($name));
    $n = preg_replace('/\s*\(\d+\s*pcs?\)/', '', $n);
    $n = preg_replace('/\s*\(\d+\s*pieces?\)/', '', $n);
    $n = preg_replace('/\s*x\d+$/', '', $n);
    $n = preg_replace('/\s*-\s*\d+(\.\d+)?\s*(mm|cm|m|g|kg|ml|l)\b/', '', $n);
    $n = preg_replace('/\s+\d+(\.\d+)?\s*(mm|cm|m|g|kg|ml|l)\s*$/', '', $n);
    return trim(preg_replace('/\s+/', ' ', $n));
}

function similarity(string $a, string $b): float
{
    similar_text(strtolower(trim($a)), strtolower(trim($b)), $pct);
    return $pct / 100.0;
}

/** Returns [confidence, reason] or [null, null]. Ports _check_duplicate_pair. */
function check_pair(array $a, array $b): array
{
    $nameA = strtolower(trim($a['name']));
    $nameB = strtolower(trim($b['name']));
    $origA = strtolower(trim($a['original_import_name'] ?: $a['name']));
    $origB = strtolower(trim($b['original_import_name'] ?: $b['name']));
    $brandA = strtolower(trim($a['brand'] ?? ''));
    $brandB = strtolower(trim($b['brand'] ?? ''));
    $skuA = strtolower(trim($a['sku'] ?? ''));
    $skuB = strtolower(trim($b['sku'] ?? ''));
    $isFilamentA = $a['category'] === 'filament';
    $isFilamentB = $b['category'] === 'filament';
    if ($isFilamentA !== $isFilamentB) {
        return [null, null];
    }

    // Filament is EXACT-identity only: names repeat per material ("ABS" ×8
    // colors) and variants are near-identical strings, so fuzzy rules flag
    // different colors as duplicates. A filament pair matches only on the
    // same SKU, or — with no SKUs to compare — the same name, color, and
    // spool type.
    if ($isFilamentA) {
        if ($skuA !== '' || $skuB !== '') {
            return $skuA !== '' && $skuA === $skuB
                ? ['high', "Same SKU ({$a['sku']})"]
                : [null, null];
        }
        $colorA = strtolower(trim($a['filament']['color'] ?? ''));
        $colorB = strtolower(trim($b['filament']['color'] ?? ''));
        $spoolA = $a['filament']['spool_type'] ?? '';
        $spoolB = $b['filament']['spool_type'] ?? '';
        if ($nameA === $nameB && $colorA === $colorB && $spoolA === $spoolB) {
            return ['high', $colorA !== ''
                ? "Same name, color ({$a['filament']['color']}), and spool type"
                : 'Exact name match (no SKU or color to distinguish)'];
        }
        return [null, null];
    }

    if ($nameA === $nameB) {
        return ['high', 'Exact name match'];
    }

    if ($skuA !== '' && $skuA === $skuB) {
        return ['high', "Same SKU ({$a['sku']})"];
    }

    if ($origA !== '' && $origA === $origB && $origA !== $nameA) {
        return ['high', 'Same original import name'];
    }

    if ($skuA !== '' && $skuB !== '') {
        $baseA = preg_replace('/[-_](SPL|N|BLK|WHT|RED|BLU)$/i', '', $skuA);
        $baseB = preg_replace('/[-_](SPL|N|BLK|WHT|RED|BLU)$/i', '', $skuB);
        if ($baseA !== '' && $baseA === $baseB) {
            return ['medium', "Similar SKU ({$a['sku']} / {$b['sku']})"];
        }
    }

    $normA = normalize_name($a['name']);
    $normB = normalize_name($b['name']);
    if ($normA !== '' && $normA === $normB) {
        return ['medium', 'Similar name (normalized)'];
    }

    // Dimensional specs (M2x5, 0.4x3x10mm, 0.4mm nozzles, 400rpm) need
    // near-exact thresholds — a one-digit difference is a different part.
    // EITHER name counts: "BT2 … Screw Set" must not fuzzy-group with the
    // sized "BT2x10 …" family
    $both = $nameA . ' ' . $nameB;
    $hasDimensions = preg_match('/\d+[x×]\d+/', $both) || preg_match('/\bm\d/', $both)
        || preg_match('/\d+(\.\d+)?\s*(mm|rpm)\b/i', $both);
    $sim = similarity($nameA, $nameB);

    if ($hasDimensions) {
        if ($sim >= 0.99 && $brandA !== '' && $brandA === $brandB) {
            return ['low', sprintf('Similar name (%d%% match, same brand)', (int) ($sim * 100))];
        }
    } else {
        if ($sim >= 0.90 && $brandA !== '' && $brandA === $brandB) {
            return ['medium', sprintf('Similar name (%d%% match, same brand)', (int) ($sim * 100))];
        }
        if ($sim >= 0.80 && $brandA !== '' && $brandA === $brandB && $a['category'] === $b['category']) {
            return ['low', sprintf('Possible match (%d%% similar, same brand & category)', (int) ($sim * 100))];
        }
        if ($origA !== '' && $origA !== $nameA && similarity($origA, $nameB) >= 0.85) {
            return ['low', sprintf('Original import name similar (%d%%)', (int) (similarity($origA, $nameB) * 100))];
        }
        if ($origB !== '' && $origB !== $nameB && similarity($origB, $nameA) >= 0.85) {
            return ['low', sprintf('Original import name similar (%d%%)', (int) (similarity($origB, $nameA) * 100))];
        }
    }

    return [null, null];
}

function find_duplicates(PDO $pdo): array
{
    // Prune dismissals whose items no longer exist, then load the rest
    $pdo->exec('DELETE FROM duplicate_dismissals
        WHERE item_a NOT IN (SELECT id FROM items)
           OR item_b NOT IN (SELECT id FROM items)');
    $dismissed = [];
    foreach ($pdo->query('SELECT item_a, item_b FROM duplicate_dismissals') as $r) {
        $dismissed[$r['item_a'] . '|' . $r['item_b']] = true;
    }
    $isDismissed = static function (string $x, string $y) use ($dismissed): bool {
        [$p, $q] = strcmp($x, $y) < 0 ? [$x, $y] : [$y, $x];
        return isset($dismissed["$p|$q"]);
    };

    // Shaped items so check_pair can see filament color/spool type
    $rows = $pdo->query('SELECT * FROM items ORDER BY created_at')->fetchAll();
    $items = rows_to_items($pdo, $rows);

    $groups = [];
    $matched = [];
    $hidden = 0;
    $n = count($items);

    for ($i = 0; $i < $n; $i++) {
        $a = $items[$i];
        if (isset($matched[$a['id']])) {
            continue;
        }
        $group = [['item' => $a, 'confidence' => null, 'reason' => null]];

        for ($j = $i + 1; $j < $n; $j++) {
            $b = $items[$j];
            if (isset($matched[$b['id']])) {
                continue;
            }
            [$confidence, $reason] = check_pair($a, $b);
            if ($confidence) {
                if ($isDismissed($a['id'], $b['id'])) {
                    $hidden++;
                    continue;
                }
                $group[] = ['item' => $b, 'confidence' => $confidence, 'reason' => $reason];
            }
        }

        if (count($group) > 1) {
            $confidences = array_column(array_slice($group, 1), 'confidence');
            $overall = in_array('high', $confidences, true) ? 'high'
                : (in_array('medium', $confidences, true) ? 'medium' : 'low');
            $reasons = array_values(array_unique(array_filter(
                array_column(array_slice($group, 1), 'reason')
            )));
            foreach ($group as $g) {
                $matched[$g['item']['id']] = true;
            }
            $groups[] = [
                'name' => $a['name'],
                'confidence' => $overall,
                'reasons' => $reasons,
                'items' => array_map(fn($g) => $g['item'], $group),
            ];
        }
    }

    return ['groups' => $groups, 'hidden_pairs' => $hidden];
}

/** Persist "these are NOT duplicates" for every pair in the given ids. */
function dismiss_pairs(PDO $pdo, array $req): array
{
    $ids = array_values(array_unique(array_filter(
        $req['item_ids'] ?? [],
        static fn ($v) => is_string($v) && $v !== ''
    )));
    if (count($ids) < 2) {
        fail('item_ids with at least two ids required');
    }
    $stmt = $pdo->prepare(
        'INSERT OR IGNORE INTO duplicate_dismissals (item_a, item_b, dismissed_at) VALUES (?, ?, ?)'
    );
    $ts = now();
    $count = 0;
    for ($i = 0; $i < count($ids); $i++) {
        for ($j = $i + 1; $j < count($ids); $j++) {
            [$p, $q] = strcmp($ids[$i], $ids[$j]) < 0
                ? [$ids[$i], $ids[$j]] : [$ids[$j], $ids[$i]];
            $stmt->execute([$p, $q, $ts]);
            $count++;
        }
    }
    return ['dismissed_pairs' => $count];
}

function merge_items(PDO $pdo, array $req): array
{
    $keepId = $req['keep_id'] ?? null;
    $mergeIds = $req['merge_ids'] ?? [];
    $addQuantities = $req['add_quantities'] ?? true;

    if (!$keepId || !is_array($mergeIds) || !$mergeIds) {
        fail('keep_id and merge_ids are required');
    }
    $keep = fetch_item($pdo, $keepId);
    if (!$keep) {
        fail('Keep item not found', 404);
    }

    $totalAdded = 0;
    $pdo->beginTransaction();
    try {
        foreach ($mergeIds as $mid) {
            if ($mid === $keepId) {
                continue;
            }
            $stmt = $pdo->prepare('SELECT * FROM items WHERE id = ?');
            $stmt->execute([$mid]);
            $row = $stmt->fetch();
            if (!$row) {
                continue;
            }
            if ($addQuantities) {
                $totalAdded += (int) $row['quantity'];
            }
            $pdo->prepare('DELETE FROM filaments WHERE item_id = ?')->execute([$mid]);
            $pdo->prepare('DELETE FROM tools WHERE item_id = ?')->execute([$mid]);
            $pdo->prepare('DELETE FROM import_batch_items WHERE item_id = ?')->execute([$mid]);
            $pdo->prepare('DELETE FROM items WHERE id = ?')->execute([$mid]);
            log_activity($pdo, 'merged', $keepId, null,
                sprintf("Merged '%s' (qty %d) into this item", $row['name'], $row['quantity']));

            $photo = MV_PHOTOS_DIR . '/' . $mid . '.jpg';
            if (is_file($photo)) {
                unlink($photo);
            }
        }

        if ($addQuantities && $totalAdded > 0) {
            $pdo->prepare('UPDATE items SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
                ->execute([$totalAdded, now(), $keepId]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('Merge failed: ' . $e->getMessage(), 500);
    }

    return fetch_item($pdo, $keepId);
}
