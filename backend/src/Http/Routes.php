<?php

declare(strict_types=1);

namespace CRM\Http;

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

final class Routes
{
    public static function create(
        HealthController $healthController,
        AuthController $authController,
        ProfileController $profileController,
        DashboardController $dashboardController,
        AppController $appController,
        SearchController $searchController,
        CompanyController $companyController,
        ContactController $contactController,
        TaskController $taskController,
        LookupController $lookupController,
        UserController $userController,
        AuditController $auditController,
        SettingsController $settingsController,
        AiInputController $aiInputController
    ): Router {
        $r = new Router();

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
        $r->add('GET', '/api/app/bootstrap', fn (Request $request) => $appController->bootstrap($request));
        $r->add('GET', '/api/pipeline', fn () => $dashboardController->pipeline());
        $r->add('GET', '/api/search', fn (Request $request) => $searchController->search($request));

        $r->add('POST', '/api/ocr/business-card', fn (Request $request) => $aiInputController->businessCard($request));
        $r->add('POST', '/api/speech/transcribe', fn (Request $request) => $aiInputController->speech($request));

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

        return $r;
    }
}
