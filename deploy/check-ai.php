<?php

declare(strict_types=1);

// Run from any working directory, as the same account that serves PHP.
require dirname(__DIR__) . '/backend/src/autoload.php';

use CRM\Config\Config;
use CRM\Config\Env;
use CRM\Domain\AiRuntimePaths;
use CRM\Domain\ProcessRunner;

Config::bootstrap(dirname(__DIR__) . '/backend');
Env::load(Config::root('.env'));
$ok = true;
foreach (['speech', 'ocr'] as $engine) {
    $speech = $engine === 'speech';
    $prefix = $speech ? 'WHISPER' : 'OCR';
    $model = (string) Config::get($speech ? 'WHISPER_MODEL' : 'OCR_MODEL_DIR', '');
    $model = $speech ? AiRuntimePaths::model($model) : AiRuntimePaths::local($model);
    $command = [
        AiRuntimePaths::python((string) Config::get($prefix . '_PYTHON_BIN', 'python3')),
        Config::root('ai/check_runtime.py'), '--engine', $engine, '--model-dir', $model,
        '--device', (string) Config::get($prefix . '_DEVICE', $speech ? 'cuda' : 'gpu'),
        '--compute-type', (string) Config::get('WHISPER_COMPUTE_TYPE', 'float16'),
        '--language', (string) Config::get('OCR_LANGUAGE', 'uk'),
    ];
    try {
        $result = (new ProcessRunner())->run($command, 300, ['HF_HUB_OFFLINE' => '1']);
        $payload = json_decode(trim($result->stdout), true);
        if (!is_array($payload)) {
            $payload = ['ok' => false, 'engine' => $engine, 'message' => 'Engine did not return valid JSON.'];
        }
        $passed = $result->exitCode === 0 && ($payload['ok'] ?? false) === true;
        $payload['ok'] = $passed;
        echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), PHP_EOL;
        $ok = $ok && $passed;
    } catch (Throwable $error) {
        echo json_encode(['ok' => false, 'engine' => $engine, 'message' => $error->getMessage()]), PHP_EOL;
        $ok = false;
    }
}
exit($ok ? 0 : 1);
