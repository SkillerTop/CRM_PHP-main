<?php

declare(strict_types=1);

use CRM\Config\Config;
use CRM\Domain\ProcessRunner;

require dirname(__DIR__) . '/backend/src/autoload.php';

Config::bootstrap(dirname(__DIR__) . '/backend');

$expectedPath = dirname(PHP_BINARY);
$childCode = <<<'PHP'
$paths = [];
foreach (getenv() as $key => $value) {
    if (strcasecmp((string) $key, 'PATH') === 0) {
        $paths[(string) $key] = (string) $value;
    }
}
echo json_encode($paths, JSON_THROW_ON_ERROR);
PHP;

$result = (new ProcessRunner())->run(
    [PHP_BINARY, '-r', $childCode],
    10,
    ['PATH' => $expectedPath]
);

if ($result->exitCode !== 0) {
    throw new RuntimeException('Child process failed: ' . trim($result->stderr));
}

$paths = json_decode($result->stdout, true, flags: JSON_THROW_ON_ERROR);
if (!is_array($paths) || count($paths) !== 1 || reset($paths) !== $expectedPath) {
    throw new RuntimeException('PATH override was not applied case-insensitively: ' . $result->stdout);
}

echo "ProcessRunner environment override passed.\n";
