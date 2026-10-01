<?php
/**
 * Per-item file attachments (datasheets, manuals, models).
 * Files live in data/attachments/<item-id>/<filename>.
 *
 * GET    attachments.php?item_id=<id>          — list [{name, size, modified}]
 * GET    attachments.php?item_id=<id>&file=<n> — download the file
 * POST   attachments.php?item_id=<id>          — multipart upload, field "file"
 * DELETE attachments.php?item_id=<id>&file=<n> — remove the file
 */

require __DIR__ . '/_bootstrap.php';

const ATTACH_EXTENSIONS = [
    'pdf', 'txt', 'md', 'csv', 'xlsx',
    'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg',
    'stl', '3mf', 'obj', 'step', 'stp', 'dxf', 'gcode', 'bgcode',
    'zip', 'json',
];
const ATTACH_INLINE = [
    'pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif',
];

$pdo = db();

$itemId = $_GET['item_id'] ?? null;
if (!$itemId || !preg_match('/^[a-zA-Z0-9-]+$/', $itemId)) {
    fail('Valid item_id query parameter required');
}
$stmt = $pdo->prepare('SELECT id, name FROM items WHERE id = ?');
$stmt->execute([$itemId]);
$item = $stmt->fetch();
if (!$item) {
    fail('Item not found', 404);
}

$dir = MV_DATA_DIR . '/attachments/' . $itemId;

function attach_clean_name(string $name): string
{
    $name = basename(str_replace('\\', '/', $name));
    $name = preg_replace('/[^\w.\-#+ ()\']/u', '_', $name);
    $name = trim(preg_replace('/\s+/', ' ', $name));
    if ($name === '' || $name[0] === '.') {
        fail('Invalid file name');
    }
    if (strlen($name) > 120) {
        $ext = pathinfo($name, PATHINFO_EXTENSION);
        $name = substr(pathinfo($name, PATHINFO_FILENAME), 0, 110) . '.' . $ext;
    }
    return $name;
}

function attach_check_ext(string $name): string
{
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!in_array($ext, ATTACH_EXTENSIONS, true)) {
        fail('File type .' . ($ext ?: '?') . ' is not allowed. Allowed: '
            . implode(', ', ATTACH_EXTENSIONS));
    }
    return $ext;
}

switch (method()) {
    case 'GET':
        if (isset($_GET['file'])) {
            $name = attach_clean_name((string) $_GET['file']);
            $ext = attach_check_ext($name);
            $path = "$dir/$name";
            if (!is_file($path)) {
                fail('Attachment not found', 404);
            }
            $inline = ATTACH_INLINE[$ext] ?? null;
            header('Content-Type: ' . ($inline ?? 'application/octet-stream'));
            header('Content-Length: ' . filesize($path));
            header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment')
                . '; filename="' . rawurlencode($name) . '"');
            header('Cache-Control: private, max-age=86400');
            header('X-Content-Type-Options: nosniff');
            readfile($path);
            exit;
        }
        $out = [];
        if (is_dir($dir)) {
            foreach (scandir($dir) as $f) {
                if ($f[0] === '.' || !is_file("$dir/$f")) {
                    continue;
                }
                $out[] = ['name' => $f, 'size' => filesize("$dir/$f"),
                    'modified' => gmdate('Y-m-d H:i:s', filemtime("$dir/$f"))];
            }
        }
        usort($out, static fn ($a, $b) => strcmp($a['name'], $b['name']));
        respond($out);
        break;

    case 'POST':
        $err = $_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE;
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
            fail('File is larger than the server upload limit ('
                . ini_get('upload_max_filesize') . ')', 413);
        }
        if (empty($_FILES['file']) || $err !== UPLOAD_ERR_OK) {
            fail('file field required (multipart/form-data)');
        }
        $name = attach_clean_name((string) $_FILES['file']['name']);
        attach_check_ext($name);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        if (!move_uploaded_file($_FILES['file']['tmp_name'], "$dir/$name")) {
            fail('Could not store the file', 500);
        }
        log_activity($pdo, 'edited', $itemId, null, "Attachment added: $name ({$item['name']})");
        respond(['name' => $name, 'size' => filesize("$dir/$name")], 201);
        break;

    case 'DELETE':
        $name = attach_clean_name((string) ($_GET['file'] ?? ''));
        attach_check_ext($name);
        $path = "$dir/$name";
        if (!is_file($path)) {
            fail('Attachment not found', 404);
        }
        unlink($path);
        log_activity($pdo, 'edited', $itemId, null, "Attachment removed: $name ({$item['name']})");
        respond(['deleted' => true]);
        break;

    default:
        fail('Method not allowed', 405);
}
