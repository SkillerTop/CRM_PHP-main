<?php

declare(strict_types=1);

namespace CRM;

use CRM\Config\Config;
use CRM\Controller\AuditController;
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
use CRM\Domain\IcsGenerator;
use CRM\Domain\LookupService;
use CRM\Domain\Mailer;
use CRM\Domain\ReminderService;
use CRM\Domain\SystemSettings;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Http\Router;
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

        $this->router = new Router();
        $r = $this->router;

        $r->add('GET', '/api/health', fn () => $healthController->show());
        $r->add('POST', '/api/auth/login', fn (Request $request) => $authController->login($request));
        $r->add('POST', '/api/auth/logout', fn () => $authController->logout());
        $r->add('GET', '/api/auth/me', fn () => $authController->me());
        $r->add('POST', '/api/auth/register', fn (Request $request) => $authController->register($request));
        $r->add('POST', '/api/auth/forgot-password', fn (Request $request) => $authController->forgotPassword($request));
        $r->add('POST', '/api/auth/reset-password', fn (Request $request) => $authController->resetPassword($request));

        $r->add('GET', '/api/profile', fn () => $profileController->show());
        $r->add('PUT', '/api/profile', fn (Request $request) => $profileController->update($request));
        $r->add('PUT', '/api/profile/password', fn (Request $request) => $profileController->password($request));

        $r->add('GET', '/api/dashboard', fn () => $dashboardController->dashboard());
        $r->add('GET', '/api/app/bootstrap', fn () => $appController->bootstrap());
        $r->add('GET', '/api/pipeline', fn () => $dashboardController->pipeline());
        $r->add('GET', '/api/search', fn (Request $request) => $searchController->search($request));

        $r->add('GET', '/api/companies', fn (Request $request) => $companyController->index($request));
        $r->add('POST', '/api/companies', fn (Request $request) => $companyController->store($request));
        $r->add('GET', '/api/companies/{id}', fn (Request $_, array $p) => $companyController->show((int) $p['id']));
        $r->add('PUT', '/api/companies/{id}', fn (Request $request, array $p) => $companyController->update($request, (int) $p['id']));
        $r->add('POST', '/api/companies/{id}/archive', fn (Request $request, array $p) => $companyController->archive($request, (int) $p['id']));
        $r->add('GET', '/api/companies/{id}/contacts', fn (Request $_, array $p) => $contactController->forCompany((int) $p['id']));
        $r->add('GET', '/api/companies/{id}/tasks', fn (Request $_, array $p) => $taskController->forCompany((int) $p['id']));
        $r->add('GET', '/api/companies/{id}/log', fn (Request $_, array $p) => $companyController->log((int) $p['id']));

        $r->add('GET', '/api/contacts', fn (Request $request) => $contactController->index($request));
        $r->add('POST', '/api/contacts', fn (Request $request) => $contactController->store($request));
        $r->add('GET', '/api/contacts/{id}', fn (Request $_, array $p) => $contactController->show((int) $p['id']));
        $r->add('PUT', '/api/contacts/{id}', fn (Request $request, array $p) => $contactController->update($request, (int) $p['id']));
        $r->add('POST', '/api/contacts/{id}/archive', fn (Request $request, array $p) => $contactController->archive($request, (int) $p['id']));
        $r->add('GET', '/api/contacts/{id}/log', fn (Request $_, array $p) => $contactController->log((int) $p['id']));

        $r->add('GET', '/api/tasks', fn (Request $request) => $taskController->index($request));
        $r->add('POST', '/api/tasks', fn (Request $request) => $taskController->store($request));
        $r->add('GET', '/api/tasks/{id}', fn (Request $_, array $p) => $taskController->show((int) $p['id']));
        $r->add('PUT', '/api/tasks/{id}', fn (Request $request, array $p) => $taskController->update($request, (int) $p['id']));
        $r->add('POST', '/api/tasks/{id}/archive', fn (Request $request, array $p) => $taskController->archive($request, (int) $p['id']));
        $r->add('GET', '/api/tasks/{id}/comments', fn (Request $_, array $p) => $taskController->comments((int) $p['id']));
        $r->add('POST', '/api/tasks/{id}/comments', fn (Request $request, array $p) => $taskController->addComment($request, (int) $p['id']));
        $r->add('PATCH', '/api/tasks/{id}/comments/{commentId}', fn (Request $request, array $p) => $taskController->commentVisibility($request, (int) $p['id'], (int) $p['commentId']));
        $r->add('GET', '/api/tasks/{id}/log', fn (Request $_, array $p) => $taskController->log((int) $p['id']));
        $r->add('GET', '/api/tasks/{id}/reminder.ics', fn (Request $_, array $p) => $taskController->calendar((int) $p['id']));
        $r->add('POST', '/api/tasks/{id}/attachments', fn (Request $request, array $p) => $taskController->uploadAttachment($request, (int) $p['id']));
        $r->add('GET', '/api/tasks/{id}/attachments/{attachmentId}', fn (Request $_, array $p) => $taskController->downloadAttachment((int) $p['id'], (int) $p['attachmentId']));
        $r->add('DELETE', '/api/tasks/{id}/attachments/{attachmentId}', fn (Request $_, array $p) => $taskController->deleteAttachment((int) $p['id'], (int) $p['attachmentId']));

        $r->add('GET', '/api/lookups', fn (Request $request) => $lookupController->all($request));
        $r->add('GET', '/api/lookups/{type}', fn (Request $request, array $p) => $lookupController->index($request, (string) $p['type']));
        $r->add('POST', '/api/lookups/{type}', fn (Request $request, array $p) => $lookupController->store($request, (string) $p['type']));
        $r->add('PUT', '/api/lookups/{type}/{id}', fn (Request $request, array $p) => $lookupController->update($request, (string) $p['type'], (int) $p['id']));
        $r->add('GET', '/api/lookups/{type}/{id}/log', fn (Request $_, array $p) => $lookupController->log((string) $p['type'], (int) $p['id']));

        $r->add('GET', '/api/users', fn () => $userController->index());
        $r->add('POST', '/api/users', fn (Request $request) => $userController->store($request));
        $r->add('PUT', '/api/users/{id}', fn (Request $request, array $p) => $userController->update($request, (int) $p['id']));
        $r->add('POST', '/api/users/{id}/approve', fn (Request $request, array $p) => $userController->approve($request, (int) $p['id']));
        $r->add('DELETE', '/api/users/{id}', fn (Request $_, array $p) => $userController->reject((int) $p['id']));
        $r->add('POST', '/api/users/{id}/reset-password', fn (Request $request, array $p) => $userController->resetPassword($request, (int) $p['id']));
        $r->add('GET', '/api/users/{id}/log', fn (Request $_, array $p) => $userController->log((int) $p['id']));

        $r->add('GET', '/api/audit', fn (Request $request) => $auditController->index($request));
        $r->add('GET', '/api/settings', fn () => $settingsController->show());
        $r->add('PUT', '/api/settings', fn (Request $request) => $settingsController->update($request));
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
        header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
        header('Cache-Control: no-store');
    }

    private function writeError(Throwable $error): void
    {
        $directory = Config::root('storage/logs');
        if (!is_dir($directory)) {
            @mkdir($directory, 0770, true);
        }
        @file_put_contents($directory . '/app.log', date(DATE_ATOM) . ' ' . $error . "\n", FILE_APPEND | LOCK_EX);
    }
}

