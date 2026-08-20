<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Http\ApiException;

final class ProcessRunner
{
    /** @param list<string> $command */
    public function run(array $command, int $timeoutSeconds = 60): ProcessResult
    {
        if ($command === [] || trim($command[0]) === '') {
            throw new ApiException(503, 'ai_engine_not_configured', 'AI-движок не настроен на сервере.');
        }

        $descriptor = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $process = @proc_open($command, $descriptor, $pipes);
        if (!is_resource($process)) {
            throw new ApiException(503, 'ai_engine_unavailable', 'Не удалось запустить локальный AI-движок.');
        }

        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        $stdout = '';
        $stderr = '';
        $startedAt = time();
        $exitCode = 0;
        try {
            while (true) {
                $stdout .= (string) stream_get_contents($pipes[1]);
                $stderr .= (string) stream_get_contents($pipes[2]);
                $status = proc_get_status($process);
                if (!$status['running']) {
                    $exitCode = (int) $status['exitcode'];
                    break;
                }
                if ((time() - $startedAt) > $timeoutSeconds) {
                    proc_terminate($process);
                    throw new ApiException(504, 'ai_engine_timeout', 'AI-движок не успел обработать файл вовремя.');
                }
                usleep(100_000);
            }
        } finally {
            foreach ([1, 2] as $index) {
                if (isset($pipes[$index]) && is_resource($pipes[$index])) {
                    fclose($pipes[$index]);
                }
            }
        }

        $closedExitCode = proc_close($process);
        if ($closedExitCode !== -1) {
            $exitCode = $closedExitCode;
        }
        return new ProcessResult($exitCode, $stdout, $stderr);
    }
}

final class ProcessResult
{
    public function __construct(
        public readonly int $exitCode,
        public readonly string $stdout,
        public readonly string $stderr
    ) {
    }
}
