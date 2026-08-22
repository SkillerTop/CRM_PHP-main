<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Config\Config;
use CRM\Http\ApiException;
use Throwable;

final class ProcessRunner
{
    /** @param list<string> $command */
    public function run(array $command, int $timeoutSeconds = 60): ProcessResult
    {
        if ($command === [] || trim($command[0]) === '') {
            throw new ApiException(503, 'ai_engine_not_configured', 'AI-движок не настроен на сервере.');
        }

        $stdoutFile = tmpfile();
        $stderrFile = tmpfile();
        if ($stdoutFile === false || $stderrFile === false) {
            if (is_resource($stdoutFile)) {
                fclose($stdoutFile);
            }
            if (is_resource($stderrFile)) {
                fclose($stderrFile);
            }
            throw new ApiException(503, 'ai_engine_unavailable', 'Не удалось подготовить безопасный вывод AI-движка.');
        }
        $descriptor = [0 => ['pipe', 'r'], 1 => $stdoutFile, 2 => $stderrFile];
        $options = PHP_OS_FAMILY === 'Windows' ? ['create_process_group' => true, 'create_new_console' => false] : [];
        $process = @proc_open($command, $descriptor, $pipes, null, null, $options);
        if (!is_resource($process)) {
            fclose($stdoutFile);
            fclose($stderrFile);
            throw new ApiException(503, 'ai_engine_unavailable', 'Не удалось запустить локальный AI-движок.');
        }

        fclose($pipes[0]);

        $stdout = '';
        $stderr = '';
        $startedAt = hrtime(true);
        $timeoutSeconds = max(1, min($timeoutSeconds, Config::int('AI_MAX_TIMEOUT_SECONDS', 300)));
        $maximumOutput = max(1024, Config::int('AI_MAX_OUTPUT_BYTES', 1024 * 1024));
        $exitCode = 0;
        $failure = null;
        try {
            while (true) {
                $stdoutStat = fstat($stdoutFile);
                $stderrStat = fstat($stderrFile);
                if ((int) ($stdoutStat['size'] ?? 0) + (int) ($stderrStat['size'] ?? 0) > $maximumOutput) {
                    throw new ApiException(503, 'ai_engine_output_limit', 'AI-движок превысил лимит диагностического вывода.');
                }
                $status = proc_get_status($process);
                if (!$status['running']) {
                    $exitCode = (int) $status['exitcode'];
                    break;
                }
                if ((hrtime(true) - $startedAt) >= $timeoutSeconds * 1_000_000_000) {
                    throw new ApiException(504, 'ai_engine_timeout', 'AI-движок не успел обработать файл вовремя.');
                }
                usleep(100_000);
            }
        } catch (Throwable $error) {
            $failure = $error;
            $status = proc_get_status($process);
            if ((bool) ($status['running'] ?? false)) {
                $this->terminateProcess($process);
            }
        }

        $closedExitCode = proc_close($process);
        rewind($stdoutFile);
        rewind($stderrFile);
        $stdout = (string) stream_get_contents($stdoutFile);
        $stderr = (string) stream_get_contents($stderrFile);
        fclose($stdoutFile);
        fclose($stderrFile);
        if ($failure !== null) {
            throw $failure;
        }
        if ($closedExitCode !== -1) {
            $exitCode = $closedExitCode;
        }
        return new ProcessResult($exitCode, $stdout, $stderr);
    }

    /** @param resource $process */
    private function terminateProcess($process): void
    {
        @proc_terminate($process);
        usleep(200_000);
        $running = (bool) (proc_get_status($process)['running'] ?? false);
        if ($running) {
            @proc_terminate($process, 9);
        }
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
