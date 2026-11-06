<?php

declare(strict_types=1);

// Full business-card pipeline (Qwen3-VL runner + CRM classifier) on local images,
// printing what POST /api/ocr/business-card would return. Does not touch the app
// container; run it through the one-off compose service:
//   docker compose --env-file .env.docker --profile ocr-test run --rm ocr-test [image or folder ...]
// or, for a CRM run outside Docker (Ollama on 127.0.0.1:11434):
//   .runtime/php/php.exe tests/ocr_local.php .runtime/ocr-test
// Without arguments it reads every image in /cards (OCR_TEST_DIR on the host).

require dirname(__DIR__) . '/backend/src/autoload.php';

use CRM\Config\Config;
use CRM\Config\Env;
use CRM\Domain\BusinessCardOcrService;
use CRM\Domain\ProcessRunner;
use CRM\Http\ApiException;

Config::bootstrap(dirname(__DIR__) . '/backend');
// Outside Docker the settings come from backend/.env; variables already set (compose) win.
Env::load(Config::root('.env'));

$files = [];
foreach (array_slice($argv, 1) ?: ['/cards'] as $target) {
    $found = is_dir($target) ? glob(rtrim($target, '/') . '/*.{jpg,jpeg,png,webp,bmp,tif,tiff,JPG,JPEG,PNG}', GLOB_BRACE) : [$target];
    array_push($files, ...($found ?: []));
}
if ($files === []) {
    fwrite(STDERR, "No images found. Put cards into OCR_TEST_DIR (default .runtime/ocr-test) or pass paths.\n");
    exit(2);
}
natsort($files);

$service = new BusinessCardOcrService(new ProcessRunner());
$failed = 0;
foreach ($files as $file) {
    $started = hrtime(true);
    try {
        $result = $service->recognizeFile($file);
        $result['seconds'] = round((hrtime(true) - $started) / 1e9, 1);
        echo '== ', basename($file), PHP_EOL, json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), PHP_EOL;
    } catch (ApiException $error) {
        $failed++;
        echo '== ', basename($file), ' FAILED: ', $error->getMessage(), PHP_EOL;
    }
}
exit($failed > 0 ? 1 : 0);
