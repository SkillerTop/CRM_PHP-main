<?php

declare(strict_types=1);

namespace CRM;

use CRM\Config\Config;
use CRM\Controller\AuditController;
use CRM\Controller\AiInputController;
use CRM\Controller\AppController;
use CRM\Controller\AuthController;
use CRM\Controller\CompanyController;
use CRM\Controller\ContactController;
use CRM\Controller\DashboardController;
use CRM\Controller\HealthController;
use CRM\Controller\LookupController;
use CRM\Controller\ProfileController;
use CRM\Controller\SearchController;
use CRM\Controller\SettingsController;
use CRM\Controller\TaskController;
use CRM\Controller\UserController;
use CRM\Database\Database;
use CRM\Domain\AuditLogger;
use CRM\Domain\BusinessCardOcrService;
use CRM\Domain\IcsGenerator;
use CRM\Domain\LookupService;
use CRM\Domain\Mailer;
use CRM\Domain\ProcessRunner;
use CRM\Domain\ReminderService;
use CRM\Domain\SpeechTranscriptionService;
use CRM\Domain\SystemSettings;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Http\Router;
use CRM\Http\Routes;
use CRM\Security\AuthContext;
use CRM\Security\RateLimiter;
use PDO;
use Throwable;

final class App
{
    private Router $router;
    private AuthContext $auth;

    public function __construct()
    {
        $db = Database::connection();
        $this->auth = new AuthContext($db);
        $audit = new AuditLogger($db, $this->auth);
        $mailer = new Mailer();
        $ics = new IcsGenerator();
        $lookups = new LookupService($db);
        $settings = new SystemSettings($db);
        $rateLimiter = new RateLimiter($db);
        $reminders = new ReminderService($db, $audit, $mailer, $ics);
        $processRunner = new ProcessRunner();
        $businessCardOcr = new BusinessCardOcrService($processRunner);
        $speechTranscription = new SpeechTranscriptionService($processRunner);

        $authController = new AuthController($db, $this->auth, $audit, $rateLimiter, $mailer, $settings);
        $profileController = new ProfileController($db, $this->auth, $audit, $mailer);
        $companyController = new CompanyController($db, $this->auth, $audit, $lookups);
        $contactController = new ContactController($db, $this->auth, $audit, $lookups);
        $taskController = new TaskController($db, $this->auth, $audit, $lookups, $reminders, $ics);
        $lookupController = new LookupController($db, $this->auth, $audit, $lookups);
        $userController = new UserController($db, $this->auth, $audit, $mailer, $authController);
        $auditController = new AuditController($db, $this->auth);
        $dashboardController = new DashboardController($db);
        $searchController = new SearchController($db);
        $settingsController = new SettingsController($db, $this->auth, $audit, $settings);
        $healthController = new HealthController($db);
        $appController = new AppController($db, $this->auth, $lookups);
        $aiInputController = new AiInputController($this->auth, $businessCardOcr, $speechTranscription);

        $this->router = Routes::create(
            $healthController,
            $authController,
            $profileController,
            $dashboardController,
            $appController,
            $searchController,
            $companyController,
            $contactController,
            $taskController,
            $lookupController,
            $userController,
            $auditController,
            $settingsController,
            $aiInputController
        );
    }

    public function run(): never
    {
        $request = Request::capture();
        try {
            $this->securityHeaders();
            if ($request->method === 'OPTIONS') {
                Response::noContent();
            }

            $public = preg_match('#^/api/(?:health|auth/(?:login|register|forgot-password|reset-password))$#', $request->path) === 1;
            $this->auth->resolve($request);
            if (!$public && !$this->auth->authenticated()) {
                throw new ApiException(401, 'unauthenticated', 'Требуется вход в систему.');
            }
            if (!$public && $this->auth->authenticated() && (bool) $this->auth->user()['must_change_password']) {
                $passwordChangeAllowed =
                    ($request->method === 'GET' && $request->path === '/api/auth/me') ||
                    ($request->method === 'POST' && $request->path === '/api/auth/logout') ||
                    ($request->method === 'PUT' && $request->path === '/api/profile/password');
                if (!$passwordChangeAllowed) {
                    throw new ApiException(
                        403,
                        'password_change_required',
                        'Перед работой с CRM необходимо изменить временный пароль.'
                    );
                }
            }
            if (!$public && !in_array($request->method, ['GET', 'HEAD', 'OPTIONS'], true)) {
                $this->auth->validateCsrf($request);
            }

            $this->router->dispatch($request);
            throw new ApiException(500, 'invalid_response', 'Обработчик не завершил ответ.');
        } catch (ApiException $error) {
            Response::json(['error' => [
                'code' => $error->errorCode,
                'message' => $error->getMessage(),
                'details' => $error->details === [] ? null : $error->details,
            ]], $error->status);
        } catch (Throwable $error) {
            $this->writeError($error);
            $payload = ['error' => ['code' => 'server_error', 'message' => 'Внутренняя ошибка сервера.']];
            if (Config::bool('APP_DEBUG', false)) {
                $payload['error']['debug'] = $error->getMessage();
            }
            Response::json($payload, 500);
        }
    }

    private function securityHeaders(): void
    {
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: same-origin');
        header('Permissions-Policy: camera=(self), microphone=(self), geolocation=()');
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
        header('Cache-Control: no-store');
    }

    private function writeError(Throwable $error): void
    {
        $directory = Config::root('storage/logs');
        if (!is_dir($directory)) {
            @mkdir($directory, 0770, true);
        }
        @file_put_contents(
            $directory . '/app.log',
            date(DATE_ATOM) . ' Internal server error: ' . get_class($error) . "\n",
            FILE_APPEND | LOCK_EX
        );
    }
}

