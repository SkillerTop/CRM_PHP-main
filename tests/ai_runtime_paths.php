<?php

declare(strict_types=1);

require dirname(__DIR__) . '/backend/src/autoload.php';

use CRM\Config\Config;
use CRM\Domain\AiRuntimePaths;

$root = sys_get_temp_dir() . '/crm-relocated-' . bin2hex(random_bytes(6));
$backend = $root . '/backend';
$model = $backend . '/ai/models/faster-whisper-large-v3-turbo';
$venv = $root . '/.runtime/whisper';
mkdir($model, 0770, true);
mkdir($venv, 0770, true);
$previous = getcwd();
try {
    Config::bootstrap($backend);
    chdir(sys_get_temp_dir());
    $expectedPython = $venv . (PHP_OS_FAMILY === 'Windows' ? '/Scripts/python.exe' : '/bin/python');
    $checks = [
        [AiRuntimePaths::model('./ai/models/faster-whisper-large-v3-turbo'), $backend . '/./ai/models/faster-whisper-large-v3-turbo'],
        [AiRuntimePaths::model('ai/models/faster-whisper-large-v3-turbo'), $model],
        [AiRuntimePaths::model('large-v3-turbo'), 'large-v3-turbo'],
        [AiRuntimePaths::model('vendor/model'), 'vendor/model'],
        [AiRuntimePaths::model($model), $model],
        [AiRuntimePaths::python('python3'), 'python3'],
        [AiRuntimePaths::python('../.runtime/whisper'), $backend . '/../.runtime/whisper' . (PHP_OS_FAMILY === 'Windows' ? '/Scripts/python.exe' : '/bin/python')],
        [AiRuntimePaths::python($venv), $expectedPython],
    ];
    foreach ($checks as [$actual, $expected]) {
        if (str_replace('\\', '/', $actual) !== str_replace('\\', '/', $expected)) {
            throw new RuntimeException('Relocated AI path mismatch: ' . $actual);
        }
    }
    echo "AI paths work independently of cwd and preserve named models.\n";
} finally {
    chdir($previous);
    // Remove only the empty directories created by this test.
    foreach ([$model, dirname($model), dirname(dirname($model)), $backend, $venv, dirname($venv), $root] as $directory) {
        rmdir($directory);
    }
}
