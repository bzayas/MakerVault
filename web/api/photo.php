<?php
/**
 * Item photo endpoint — ports utils/photo.py + the photo routes.
 *
 * GET    photo.php?item_id=<id>  — serve the JPEG (404 if none)
 * POST   photo.php?item_id=<id>  — multipart upload, field name "photo";
 *                                  EXIF-oriented, resized to max 1200px, JPEG q85
 * DELETE photo.php?item_id=<id>  — remove photo, clear items.photo_path
 */

require __DIR__ . '/_bootstrap.php';

$pdo = db();

$itemId = $_GET['item_id'] ?? null;
if (!$itemId || !preg_match('/^[a-zA-Z0-9-]+$/', $itemId)) {
    fail('Valid item_id query parameter required');
}
$photoFile = MV_PHOTOS_DIR . '/' . $itemId . '.jpg';

switch (method()) {
    case 'HEAD':
    case 'GET':
        if (!is_file($photoFile)) {
            fail('No photo for this item', 404);
        }
        header('Content-Type: image/jpeg');
        header('Content-Length: ' . filesize($photoFile));
        // URLs carry a version param (item updated_at), so long cache is safe
        header('Cache-Control: private, max-age=604800, immutable');
        readfile($photoFile);
        exit;

    case 'POST':
        $stmt = $pdo->prepare('SELECT id FROM items WHERE id = ?');
        $stmt->execute([$itemId]);
        if (!$stmt->fetch()) {
            fail('Item not found', 404);
        }
        $err = $_FILES['photo']['error'] ?? UPLOAD_ERR_NO_FILE;
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
            fail('Photo is larger than the server upload limit ('
                . ini_get('upload_max_filesize') . ') — resize it and try again', 413);
        }
        if (empty($_FILES['photo']) || $err !== UPLOAD_ERR_OK) {
            fail('photo file field required (multipart/form-data)');
        }
        if (!is_dir(MV_PHOTOS_DIR)) {
            mkdir(MV_PHOTOS_DIR, 0775, true);
        }

        $tmp = $_FILES['photo']['tmp_name'];
        $img = @imagecreatefromstring((string) file_get_contents($tmp));
        if ($img === false) {
            fail('File is not a readable image');
        }

        // EXIF auto-orient (JPEG only; exif extension may be absent on some PHP builds)
        if (function_exists('exif_read_data')) {
            $exif = @exif_read_data($tmp);
            $orientation = (int) ($exif['Orientation'] ?? 1);
            $img = match ($orientation) {
                3 => imagerotate($img, 180, 0),
                6 => imagerotate($img, -90, 0),
                8 => imagerotate($img, 90, 0),
                default => $img,
            };
        }

        // Resize so the longest edge is at most 1200px (matches utils/photo.py)
        $w = imagesx($img);
        $h = imagesy($img);
        $max = 1200;
        if ($w > $max || $h > $max) {
            $scale = $max / max($w, $h);
            // Default interpolation (bilinear); IMG_BICUBIC is broken in some GD builds
            $img = imagescale($img, (int) round($w * $scale), (int) round($h * $scale));
        }

        // Flatten any alpha onto white, save as JPEG quality 85
        $out = imagecreatetruecolor(imagesx($img), imagesy($img));
        $white = imagecolorallocate($out, 255, 255, 255);
        imagefill($out, 0, 0, $white);
        imagecopy($out, $img, 0, 0, 0, 0, imagesx($img), imagesy($img));
        imagejpeg($out, $photoFile, 85);

        $pdo->prepare('UPDATE items SET photo_path = ?, updated_at = ? WHERE id = ?')
            ->execute([$itemId . '.jpg', now(), $itemId]);

        respond(['photo_path' => $itemId . '.jpg']);

    case 'DELETE':
        if (is_file($photoFile)) {
            unlink($photoFile);
        }
        $pdo->prepare('UPDATE items SET photo_path = NULL, updated_at = ? WHERE id = ?')
            ->execute([now(), $itemId]);
        respond(['deleted' => true]);

    default:
        fail('Method not allowed', 405);
}
