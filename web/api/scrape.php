<?php
/**
 * Product-page scraper — ports Server/parsers/product_scraper.py.
 * The browser can't fetch external stores (CORS), so scraping happens here.
 *
 * GET scrape.php?url=<product url>
 *   → {name, description, price, currency, image_url, product_url,
 *      vendor, sku, brand, error?}
 *   Supported: Bambu Lab store (Shopify product JSON → JSON-LD → OpenGraph),
 *   Amazon (best effort — often blocked), anything else (JSON-LD/OpenGraph).
 *
 * GET scrape.php?image=<image url>
 *   → the image bytes, proxied — lets the client turn a product image into
 *     a File for the normal photo-upload path.
 */

require __DIR__ . '/_bootstrap.php';

const SCRAPE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    . 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

if (method() !== 'GET') {
    fail('Method not allowed', 405);
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

function scrape_check_url(string $url): array
{
    $parts = parse_url($url);
    if (!$parts || !in_array($parts['scheme'] ?? '', ['http', 'https'], true) || empty($parts['host'])) {
        fail('URL must start with http:// or https://');
    }
    $host = $parts['host'];
    // Refuse local/private targets — this endpoint fetches arbitrary URLs
    $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : gethostbyname($host);
    if ($host === 'localhost'
        || filter_var($ip, FILTER_VALIDATE_IP) && !filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        )) {
        fail('Refusing to fetch private or local addresses');
    }
    return $parts;
}

/** @return array{0:?string,1:string,2:int} [body, content_type, http_code] */
function scrape_fetch(string $url, int $maxBytes = 3_000_000): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_USERAGENT => SCRAPE_UA,
        CURLOPT_HTTPHEADER => [
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: en-US,en;q=0.9',
        ],
        CURLOPT_ENCODING => '', // accept gzip/deflate
        CURLOPT_RANGE => '0-' . $maxBytes,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $type = (string) (curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: '');
    curl_close($ch);
    // Some servers reject Range with 416 — retry without it
    if ($code === 416) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5, CURLOPT_TIMEOUT => 15,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => SCRAPE_UA, CURLOPT_ENCODING => '',
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $type = (string) (curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: '');
        curl_close($ch);
    }
    return [$body === false ? null : $body, $type, $code];
}

function scrape_result(string $url, array $data = [], ?string $error = null): void
{
    respond(array_merge([
        'name' => null, 'description' => null, 'price' => null, 'currency' => null,
        'image_url' => null, 'product_url' => $url, 'vendor' => null,
        'sku' => null, 'brand' => null,
        // Split title/variant so the client can run the shared classifier
        // (InvoiceParsers.classifyProduct) for category/clean-name/filament
        'product_title' => null, 'variant_name' => null,
        'error' => $error,
    ], $data, $error !== null ? ['error' => $error] : []));
}

function scrape_text(?string $html, int $max = 1200): ?string
{
    if ($html === null || $html === '') {
        return null;
    }
    $text = trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5));
    $text = preg_replace('/[ \t]+/', ' ', $text);
    $text = preg_replace('/\s*\n\s*/', "\n", $text);
    if ($text === '') {
        return null;
    }
    return mb_strlen($text) > $max ? mb_substr($text, 0, $max - 1) . '…' : $text;
}

// ---------------------------------------------------------------------------
// Image proxy mode
// ---------------------------------------------------------------------------

if (isset($_GET['image'])) {
    $url = trim((string) $_GET['image']);
    scrape_check_url($url);
    [$body, $type, $code] = scrape_fetch($url, 8_000_000);
    if ($body === null || $code >= 400 || strlen($body) < 100) {
        fail('Failed to download image', 502);
    }
    if (stripos($type, 'image/') !== 0) {
        // Some CDNs return generic types; sniff the common formats
        $sniff = substr($body, 0, 12);
        if (str_starts_with($sniff, "\xFF\xD8")) {
            $type = 'image/jpeg';
        } elseif (str_starts_with($sniff, "\x89PNG")) {
            $type = 'image/png';
        } elseif (substr($sniff, 8, 4) === 'WEBP') {
            $type = 'image/webp';
        } else {
            fail('URL did not return an image', 502);
        }
    }
    header('Content-Type: ' . $type);
    header('Cache-Control: no-store');
    echo $body;
    exit;
}

// ---------------------------------------------------------------------------
// Scrape mode
// ---------------------------------------------------------------------------

$url = trim((string) ($_GET['url'] ?? ''));
if ($url === '') {
    fail('url parameter is required');
}
$parts = scrape_check_url($url);
$host = strtolower($parts['host']);

if (str_contains($host, 'bambulab.com')) {
    scrape_bambulab($url, $parts);
} elseif (str_contains($host, 'amazon.co') || str_contains($host, 'amzn.')
    || str_contains($host, 'amazon.com')) {
    scrape_amazon($url);
} else {
    scrape_generic($url, $host);
}

// ---------------------------------------------------------------------------
// Bambu Lab store (Shopify)
// ---------------------------------------------------------------------------

function scrape_bambulab(string $url, array $parts): void
{
    // Variant id lives in ?id=… (Bambu) or ?variant=… (stock Shopify)
    parse_str($parts['query'] ?? '', $query);
    $variantId = (string) ($query['id'] ?? $query['variant'] ?? '');

    // 1) Shopify product JSON: /products/<handle>.js — richest + most stable
    if (preg_match('#^(.*?/products/[a-z0-9\-]+)#i', $url, $m)) {
        [$body, , $code] = scrape_fetch($m[1] . '.js');
        $p = $code < 400 && $body !== null ? json_decode($body, true) : null;
        if (is_array($p) && isset($p['title'])) {
            $variant = null;
            foreach ($p['variants'] ?? [] as $v) {
                if ($variantId !== '' && (string) ($v['id'] ?? '') === $variantId) {
                    $variant = $v;
                    break;
                }
            }
            $variant ??= ($p['variants'][0] ?? null);

            $variantTitle = isset($variant['title']) && $variant['title'] !== 'Default Title'
                ? trim((string) $variant['title']) : '';
            $name = trim($p['title'] . ($variantTitle !== '' ? ' — ' . $variantTitle : ''));
            $image = $variant['featured_image']['src']
                ?? ($p['images'][0] ?? ($p['featured_image'] ?? null));
            if (is_string($image) && str_starts_with($image, '//')) {
                $image = 'https:' . $image;
            }
            $sku = trim((string) ($variant['sku'] ?? ''));
            if ($sku === '' && isset($variant['title'])
                && preg_match('/-\s*([A-Z]{1,3}\d{2,4})\s*$/', $variant['title'], $sm)) {
                $sku = $sm[1]; // part code at the tail of the variant name
            }
            scrape_result($url, [
                'name' => $name,
                'product_title' => trim((string) $p['title']),
                'variant_name' => $variantTitle !== '' ? $variantTitle : null,
                'description' => scrape_text($p['description'] ?? null),
                'price' => isset($variant['price']) ? round(((float) $variant['price']) / 100, 2) : null,
                'currency' => 'USD',
                'image_url' => $image,
                'vendor' => 'Bambu Lab',
                'brand' => $p['vendor'] ?? 'Bambu Lab',
                'sku' => $sku !== '' ? $sku : null,
            ]);
        }
    }

    // 2) Page HTML: JSON-LD, then OpenGraph
    [$html, , $code] = scrape_fetch($url);
    if ($html === null || $code >= 400) {
        scrape_result($url, ['vendor' => 'Bambu Lab'], "Failed to fetch page (HTTP $code)");
    }
    $ld = scrape_jsonld($html, $variantId);
    if ($ld) {
        scrape_result($url, $ld + ['vendor' => 'Bambu Lab', 'brand' => 'Bambu Lab']);
    }
    $og = scrape_opengraph($html);
    scrape_result(
        $url,
        $og + ['vendor' => 'Bambu Lab', 'brand' => 'Bambu Lab'],
        $og ? null : 'Could not parse product details from the page'
    );
}

// ---------------------------------------------------------------------------
// Amazon (best effort)
// ---------------------------------------------------------------------------

function scrape_amazon(string $url): void
{
    [$html, , $code] = scrape_fetch($url);
    if ($html === null || $code >= 400) {
        scrape_result($url, ['vendor' => 'Amazon'],
            "Amazon returned HTTP $code — it often blocks automated requests. "
            . 'Open the URL in a browser and copy the details manually.');
    }
    $head = strtolower(substr($html, 0, 5000));
    if (str_contains($head, 'captcha') || str_contains($head, 'robot') || strlen($html) < 5000) {
        scrape_result($url, ['vendor' => 'Amazon'],
            'Amazon blocked this request with a captcha. '
            . 'Open the URL in a browser and copy the details manually.');
    }

    $doc = new DOMDocument();
    @$doc->loadHTML($html, LIBXML_NOERROR | LIBXML_NOWARNING);
    $xp = new DOMXPath($doc);
    $first = static fn (string $q) => $xp->query($q)->item(0);

    $name = ($n = $first('//span[@id="productTitle"]')) ? trim($n->textContent) : null;

    $bullets = [];
    foreach ($xp->query('//div[@id="feature-bullets"]//li') as $li) {
        $t = trim(preg_replace('/\s+/', ' ', $li->textContent));
        if ($t !== '') {
            $bullets[] = "- $t";
        }
    }

    $price = null;
    if ($w = $first('//span[contains(@class,"a-price-whole")]')) {
        $str = rtrim(trim($w->textContent), '.');
        if ($f = $first('//span[contains(@class,"a-price-fraction")]')) {
            $str .= '.' . trim($f->textContent);
        }
        $price = (float) str_replace(',', '', $str) ?: null;
    }

    $image = ($i = $first('//img[@id="landingImage"]')) ? $i->getAttribute('src') : null;

    $brand = null;
    if ($b = $first('//a[@id="bylineInfo"]')) {
        $brand = trim(preg_replace('/^(Visit the |Brand: )/', '', trim($b->textContent)));
        $brand = preg_replace('/ Store$/', '', $brand) ?: null;
    }

    scrape_result($url, [
        'name' => $name,
        'description' => $bullets ? scrape_text(implode("\n", $bullets)) : null,
        'price' => $price,
        'currency' => 'USD',
        'image_url' => $image,
        'vendor' => 'Amazon',
        'brand' => $brand,
    ], $name ? null : 'Could not parse product details — the page structure may have changed.');
}

// ---------------------------------------------------------------------------
// Anything else: JSON-LD Product → OpenGraph
// ---------------------------------------------------------------------------

function scrape_generic(string $url, string $host): void
{
    [$html, , $code] = scrape_fetch($url);
    if ($html === null || $code >= 400) {
        scrape_result($url, [], "Failed to fetch page (HTTP $code)");
    }
    $vendor = preg_replace('/^www\./', '', $host);
    $ld = scrape_jsonld($html, null);
    if ($ld) {
        scrape_result($url, $ld + ['vendor' => $vendor]);
    }
    $og = scrape_opengraph($html);
    scrape_result($url, $og + ['vendor' => $vendor],
        $og ? null : 'No product data found on this page');
}

// ---------------------------------------------------------------------------
// Shared JSON-LD / OpenGraph parsing
// ---------------------------------------------------------------------------

function scrape_jsonld(string $html, ?string $variantId): ?array
{
    if (!preg_match_all(
        '#<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>#si',
        $html,
        $matches
    )) {
        return null;
    }
    foreach ($matches[1] as $block) {
        $data = json_decode(trim($block), true);
        if (!is_array($data)) {
            continue;
        }
        $nodes = isset($data['@graph']) && is_array($data['@graph']) ? $data['@graph'] : [$data];
        foreach ($nodes as $node) {
            $type = $node['@type'] ?? null;
            if ($type === 'ProductGroup') {
                $result = [
                    'name' => $node['name'] ?? null,
                    'product_title' => $node['name'] ?? null,
                    'description' => scrape_text($node['description'] ?? null),
                ];
                $variants = $node['hasVariant'] ?? [];
                $match = null;
                foreach ($variants as $v) {
                    if ($variantId !== null && $variantId !== ''
                        && ((string) ($v['sku'] ?? '') === $variantId
                            || str_contains((string) (($v['offers'] ?? [])['url'] ?? ''), $variantId))) {
                        $match = $v;
                        break;
                    }
                }
                $match ??= $variants[0] ?? null;
                if ($match) {
                    $result['name'] = $match['name'] ?? $result['name'];
                    // Variant portion = match name minus the leading group title
                    $group = (string) ($node['name'] ?? '');
                    $variantName = (string) ($match['name'] ?? '');
                    if ($group !== '' && $variantName !== '' && str_starts_with($variantName, $group)) {
                        $variantName = preg_replace('/^[\s\-—]+/u', '', substr($variantName, strlen($group)));
                    }
                    if ($variantName !== '' && $variantName !== $group) {
                        $result['variant_name'] = $variantName;
                    }
                    if (preg_match('/-\s*([A-Z]{1,3}\d{2,4})\s*$/', (string) ($match['name'] ?? ''), $m)) {
                        $result['sku'] = $m[1];
                    }
                    $result['image_url'] = $match['image'] ?? null;
                    $offers = $match['offers'] ?? [];
                    if (isset($offers[0])) {
                        $offers = $offers[0];
                    }
                    if (!empty($offers['price'])) {
                        $result['price'] = (float) $offers['price'];
                        $result['currency'] = $offers['priceCurrency'] ?? null;
                    }
                }
                return array_filter($result, static fn ($v) => $v !== null);
            }
            if ($type === 'Product' || (is_array($type) && in_array('Product', $type, true))) {
                $image = $node['image'] ?? null;
                if (is_array($image)) {
                    $image = $image['url'] ?? ($image[0] ?? null);
                }
                $offers = $node['offers'] ?? [];
                if (isset($offers[0])) {
                    $offers = $offers[0];
                }
                $brand = $node['brand'] ?? null;
                if (is_array($brand)) {
                    $brand = $brand['name'] ?? null;
                }
                $result = [
                    'name' => $node['name'] ?? null,
                    'description' => scrape_text($node['description'] ?? null),
                    'sku' => isset($node['sku']) ? (string) $node['sku'] : null,
                    'image_url' => is_string($image) ? $image : null,
                    'brand' => is_string($brand) ? $brand : null,
                ];
                if (!empty($offers['price'])) {
                    $result['price'] = (float) $offers['price'];
                    $result['currency'] = $offers['priceCurrency'] ?? null;
                }
                return array_filter($result, static fn ($v) => $v !== null);
            }
        }
    }
    return null;
}

function scrape_opengraph(string $html): array
{
    $og = [];
    $map = ['og:title' => 'name', 'og:description' => 'description', 'og:image' => 'image_url'];
    if (preg_match_all('#<meta[^>]+property=["\'](og:[a-z:]+)["\'][^>]+content=["\']([^"\']*)["\']#i', $html, $m, PREG_SET_ORDER)
        + preg_match_all('#<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\'](og:[a-z:]+)["\']#i', $html, $m2, PREG_SET_ORDER)) {
        foreach ($m as $t) {
            if (isset($map[$t[1]]) && $t[2] !== '') {
                $og[$map[$t[1]]] = html_entity_decode($t[2], ENT_QUOTES | ENT_HTML5);
            }
        }
        foreach ($m2 as $t) {
            if (isset($map[$t[2]]) && $t[1] !== '') {
                $og[$map[$t[2]]] ??= html_entity_decode($t[1], ENT_QUOTES | ENT_HTML5);
            }
        }
    }
    if (isset($og['description'])) {
        $og['description'] = scrape_text($og['description']);
    }
    return $og;
}
