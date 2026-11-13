import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  ApiError,
  body,
  db,
  first,
  reply,
  rows,
  utc,
  type Row,
} from "./core.js";
import {
  login,
  logout,
  permissions,
  requireRole,
  resolve,
  validateCsrf,
  type Identity,
} from "./auth.js";
import {
  allLookups,
  typedLookups,
  lookupStore,
  lookupUpdate,
  lookupLog,
} from "./lookups.js";
import { auditIndex } from "./audit.js";
import { getSettings, putSettings } from "./settings.js";
import {
  changePassword,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  updateProfile,
} from "./profile.js";
import { appBootstrap } from "./bootstrap.js";
import {
  companyArchive,
  companyIndex,
  companyLog,
  companyLogo,
  companyShow,
  companyStore,
  companyUpdate,
} from "./companies.js";
import {
  contactArchive,
  contactIndex,
  contactLog,
  contactPhoto,
  contactShow,
  contactStore,
  contactUpdate,
} from "./contacts.js";
import {
  addComment,
  commentVisibility,
  findTask,
  taskArchive,
  taskComments,
  taskDetail,
  taskIndex,
  taskLog,
  taskStore,
  taskUpdate,
  updateComment,
} from "./tasks.js";
import { taskCalendar } from "./ics.js";
import {
  deleteAttachment,
  downloadAttachment,
  uploadAttachment,
} from "./attachments.js";
import { forgotPassword, register, resetPassword } from "./auth-public.js";
import {
  userApprove,
  userIndex,
  userLog,
  userPhoto,
  userReject,
  userResetPassword,
  userSessions,
  userStore,
  userUpdate,
} from "./users.js";
import { toEnglish } from "./translation.js";
import { resourceConsume } from "./storage.js";
import { exclusive } from "./ai-runtime.js";
import { recognizeBusinessCard } from "./ocr.js";
import { transcribe } from "./speech.js";
import { lookupCompanyWebsite } from "./company-lookup.js";
import { validateEnvironment } from "./config.js";
import { serveStatic } from "./static.js";
import { emailError, requiredField, validate } from "./domain.js";
import { envBool } from "./env.js";

type Context = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  identity: Identity | null;
};
type Handler = (ctx: Context) => Promise<void>;
const routes = new Map<string, Handler>();
function route(method: string, path: string, handler: Handler): void {
  routes.set(`${method} ${path}`, handler);
}
const parameterRoutes: Array<{
  method: string;
  pattern: RegExp;
  handler: (ctx: Context, params: Record<string, string>) => Promise<void>;
}> = [];
function routeParams(
  method: string,
  path: string,
  handler: (ctx: Context, params: Record<string, string>) => Promise<void>,
): void {
  const source = path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "(?<$1>[^/]+)");
  parameterRoutes.push({
    method,
    pattern: new RegExp(`^${source.replace(/[.]/g, "\\.")}$`),
    handler,
  });
}
const json = (res: ServerResponse, data: unknown, status = 200) =>
  reply(res, { data }, status);

route("GET", "/api/health", async ({ res }) => {
  try {
    await db.query("SELECT 1");
    const heartbeat = await first(
      "SELECT setting_value FROM settings WHERE setting_key = 'scheduler_last_run_at'",
    );
    const lastRun = heartbeat?.setting_value;
    const scheduler = !lastRun
      ? "not_started"
      : new Date(String(lastRun).replace(" ", "T") + "Z").getTime() >=
          Date.now() - 30 * 60_000
        ? "ok"
        : "stale";
    json(res, {
      status: "ok",
      database: "ok",
      scheduler,
      scheduler_last_run_at: utc(lastRun),
      scheduler_expected_interval_minutes: 15,
    });
  } catch {
    reply(
      res,
      { error: { code: "unhealthy", message: "Сервис временно недоступен." } },
      503,
    );
  }
});

route("POST", "/api/translate", async ({ req, res, identity }) => {
  requireRole(identity!, "admin", "manager", "editor");
  const input = await body(req);
  await resourceConsume(
    "translation",
    identity!.user.id,
    Number(process.env.TRANSLATION_MAX_REQUESTS_PER_HOUR ?? 120),
  );
  json(res, { text: await toEnglish(String(input.text ?? "")) });
});
route("POST", "/api/ocr/business-card", async ({ req, res, identity }) => {
  requireRole(identity!, "admin", "manager", "editor");
  await resourceConsume(
    "ocr",
    identity!.user.id,
    Number(process.env.OCR_MAX_REQUESTS_PER_HOUR ?? 20),
  );
  json(res, await exclusive("ocr", () => recognizeBusinessCard(req)));
});
route("POST", "/api/speech/transcribe", async ({ req, res, identity }) => {
  requireRole(identity!, "admin", "manager", "editor");
  await resourceConsume(
    "speech",
    identity!.user.id,
    Number(process.env.WHISPER_MAX_REQUESTS_PER_HOUR ?? 10),
  );
  json(res, await exclusive("speech", () => transcribe(req)));
});
route("POST", "/api/company-lookup", async ({ req, res, identity }) => {
  requireRole(identity!, "admin", "manager", "editor");
  if (!envBool("COMPANY_LOOKUP_ENABLED", true))
    throw new ApiError(
      503,
      "lookup_disabled",
      "Поиск данных компании по сайту отключён.",
    );
  const input = await body(req);
  await resourceConsume(
    "company_lookup",
    identity!.user.id,
    Number(process.env.COMPANY_LOOKUP_MAX_REQUESTS_PER_HOUR ?? 60),
  );
  json(res, await lookupCompanyWebsite(String(input.website ?? "")));
});

route("POST", "/api/auth/login", async ({ req, res }) => {
  const data = await body(req);
  const email = String(data.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(data.password ?? "").trim();
  validate({
    email: requiredField(email) || emailError(email),
    password: requiredField(password),
  });
  json(res, await login(req, res, email, password));
});
route("POST", "/api/auth/logout", async ({ res, identity }) => {
  await logout(res, identity!);
  res.writeHead(204);
  res.end();
});
route("GET", "/api/auth/me", async ({ res, identity }) => {
  json(res, {
    user: identity!.user,
    permissions: permissions(identity!.user.role),
    csrf_token: identity!.csrf,
  });
});
route("POST", "/api/auth/register", async ({ req, res }) =>
  json(res, await register(req, await body(req)), 202),
);
route("POST", "/api/auth/forgot-password", async ({ req, res }) =>
  json(res, await forgotPassword(req, await body(req))),
);
route("POST", "/api/auth/reset-password", async ({ req, res }) =>
  json(res, await resetPassword(await body(req))),
);

route("GET", "/api/dashboard", async ({ res }) => {
  const kpi = await first(`SELECT
    (SELECT COUNT(*) FROM companies WHERE is_archived = 0) AS companies,
    (SELECT COUNT(*) FROM contacts k JOIN companies c ON c.id=k.company_id WHERE k.is_archived=0 AND c.is_archived=0) AS contacts,
    (SELECT COUNT(*) FROM companies c WHERE c.is_archived=0 AND EXISTS(SELECT 1 FROM contacts k WHERE k.company_id=c.id AND k.is_archived=0)) AS companies_with_contacts,
    (SELECT COUNT(*) FROM tasks t JOIN companies c ON c.id=t.company_id WHERE t.is_archived=0 AND c.is_archived=0) AS tasks_total,
    (SELECT COUNT(*) FROM tasks t JOIN companies c ON c.id=t.company_id JOIN lookups s ON s.id=t.status_lookup_id WHERE t.is_archived=0 AND c.is_archived=0 AND s.key_code='completed') AS completed_tasks,
    (SELECT COUNT(*) FROM tasks t JOIN companies c ON c.id=t.company_id JOIN lookups s ON s.id=t.status_lookup_id WHERE t.is_archived=0 AND c.is_archived=0 AND s.is_closed=0) AS open_tasks,
    (SELECT COUNT(*) FROM tasks t JOIN companies c ON c.id=t.company_id JOIN lookups s ON s.id=t.status_lookup_id WHERE t.is_archived=0 AND c.is_archived=0 AND s.is_closed=0 AND t.deadline IS NOT NULL AND t.deadline < UTC_TIMESTAMP(6)) AS overdue`);
  const funnel = await rows(
    `SELECT s.id AS status_id,s.value AS status,s.sort_order,COUNT(c.id) AS count FROM lookups s JOIN companies c ON c.status_lookup_id=s.id AND c.is_archived=0 WHERE s.type='client_status' GROUP BY s.id,s.value,s.sort_order HAVING COUNT(c.id)>0 ORDER BY s.sort_order`,
  );
  const maximum = Math.max(0, ...funnel.map((x) => Number(x.count)));
  const managers = await rows(
    `SELECT m.id AS manager_id,m.value AS manager,COUNT(t.id) AS task_count,SUM(s.is_closed=0) AS open_count FROM tasks t JOIN companies c ON c.id=t.company_id AND c.is_archived=0 JOIN lookups m ON m.id=t.manager_lookup_id JOIN lookups s ON s.id=t.status_lookup_id WHERE t.is_archived=0 GROUP BY m.id,m.value ORDER BY task_count DESC,m.value`,
  );
  json(res, {
    kpi,
    funnel: funnel.map((x) => ({
      ...x,
      percent_of_max: maximum
        ? Math.round((Number(x.count) * 1000) / maximum) / 10
        : 0,
    })),
    manager_activity: managers,
  });
});

route("GET", "/api/search", async ({ res, url }) => {
  const query = (url.searchParams.get("q") ?? "").trim();
  const empty = { query, companies: [], contacts: [], tasks: [] };
  if (!query) {
    reply(res, {
      data: empty,
      meta: { counts: { companies: 0, contacts: 0, tasks: 0 } },
    });
    return;
  }
  const like = `%${query}%`;
  const companies = await rows(
    `SELECT id,name,country,city,website,linkedin,description FROM companies WHERE is_archived=0 AND (name LIKE ? OR country LIKE ? OR city LIKE ? OR description LIKE ? OR website LIKE ? OR linkedin LIKE ?) ORDER BY name LIMIT 25`,
    Array(6).fill(like),
  );
  const contacts = await rows(
    `SELECT k.id,k.company_id,c.name AS company,k.contact_status AS status,k.first_name,k.last_name,k.position,k.email,k.phone,k.linkedin,src.value AS source,COALESCE(ini.value,k.initiated_by_text) AS initiated_by FROM contacts k JOIN companies c ON c.id=k.company_id LEFT JOIN lookups src ON src.id=k.source_lookup_id LEFT JOIN lookups ini ON ini.id=k.initiated_by_lookup_id WHERE k.is_archived=0 AND c.is_archived=0 AND (k.first_name LIKE ? OR k.last_name LIKE ? OR k.email LIKE ? OR k.phone LIKE ? OR k.position LIKE ? OR k.linkedin LIKE ? OR src.value LIKE ? OR COALESCE(ini.value,k.initiated_by_text) LIKE ?) ORDER BY k.last_name,k.first_name LIMIT 25`,
    Array(8).fill(like),
  );
  const tasks = await rows(
    `SELECT DISTINCT t.id,t.company_id,c.name AS company,t.name,t.contact_date,t.description,t.outcome_notes,m.value AS manager FROM tasks t JOIN companies c ON c.id=t.company_id JOIN lookups m ON m.id=t.manager_lookup_id LEFT JOIN task_comments tc ON tc.task_id=t.id AND tc.is_hidden=0 WHERE t.is_archived=0 AND c.is_archived=0 AND (t.name LIKE ? OR t.description LIKE ? OR t.outcome_notes LIKE ? OR m.value LIKE ? OR tc.text LIKE ?) ORDER BY t.contact_date DESC LIMIT 25`,
    Array(5).fill(like),
  );
  reply(res, {
    data: { query, companies, contacts, tasks },
    meta: {
      counts: {
        companies: companies.length,
        contacts: contacts.length,
        tasks: tasks.length,
      },
    },
  });
});

route("GET", "/api/lookups", async ({ res, url, identity }) =>
  json(res, await allLookups(url, identity!)),
);
route("GET", "/api/audit", async ({ res, url, identity }) =>
  auditIndex(url, res, identity!),
);
route("GET", "/api/settings", async ({ res, identity }) =>
  json(res, await getSettings(identity!)),
);
route("PUT", "/api/settings", async ({ req, res, identity }) =>
  json(res, await putSettings(identity!, await body(req))),
);
route("GET", "/api/profile", async ({ res, identity }) =>
  json(res, identity!.user),
);
route("PUT", "/api/profile", async ({ req, res, identity }) =>
  json(res, await updateProfile(identity!, await body(req))),
);
route("PUT", "/api/profile/password", async ({ req, res, identity }) =>
  json(res, await changePassword(identity!, await body(req))),
);
route("GET", "/api/profile/sessions", async ({ res, url, identity }) =>
  reply(res, await listSessions(url, identity!)),
);
route(
  "POST",
  "/api/profile/sessions/revoke-others",
  async ({ res, identity }) => {
    await revokeOtherSessions(identity!);
    res.writeHead(204);
    res.end();
  },
);
route("GET", "/api/app/bootstrap", async ({ res, identity }) =>
  json(res, await appBootstrap(identity!)),
);
route("GET", "/api/companies", async ({ res, url, identity }) =>
  reply(res, await companyIndex(url, identity!)),
);
route("POST", "/api/companies", async ({ req, res, identity }) =>
  json(res, await companyStore(identity!, await body(req)), 201),
);
routeParams(
  "GET",
  "/api/companies/{id}/logo",
  async ({ res, identity }, { id }) => companyLogo(res, identity!, Number(id)),
);
routeParams("GET", "/api/companies/{id}", async ({ res, identity }, { id }) =>
  json(res, await companyShow(identity!, Number(id))),
);
routeParams(
  "PUT",
  "/api/companies/{id}",
  async ({ req, res, identity }, { id }) =>
    json(res, await companyUpdate(identity!, Number(id), await body(req))),
);
routeParams(
  "POST",
  "/api/companies/{id}/archive",
  async ({ req, res, identity }, { id }) =>
    json(res, await companyArchive(identity!, Number(id), await body(req))),
);
routeParams(
  "GET",
  "/api/companies/{id}/log",
  async ({ res, url, identity }, { id }) =>
    reply(res, await companyLog(url, identity!, Number(id))),
);
routeParams(
  "GET",
  "/api/companies/{id}/contacts",
  async ({ res, url, identity }, { id }) =>
    reply(res, await contactIndex(url, identity!, Number(id))),
);
route("GET", "/api/contacts", async ({ res, url, identity }) =>
  reply(res, await contactIndex(url, identity!)),
);
route("POST", "/api/contacts", async ({ req, res, identity }) =>
  json(res, await contactStore(identity!, await body(req)), 201),
);
routeParams(
  "GET",
  "/api/contacts/{id}/photo",
  async ({ res, identity }, { id }) => contactPhoto(res, identity!, Number(id)),
);
routeParams("GET", "/api/contacts/{id}", async ({ res, identity }, { id }) =>
  json(res, await contactShow(identity!, Number(id))),
);
routeParams(
  "PUT",
  "/api/contacts/{id}",
  async ({ req, res, identity }, { id }) =>
    json(res, await contactUpdate(identity!, Number(id), await body(req))),
);
routeParams(
  "POST",
  "/api/contacts/{id}/archive",
  async ({ req, res, identity }, { id }) =>
    json(res, await contactArchive(identity!, Number(id), await body(req))),
);
routeParams(
  "GET",
  "/api/contacts/{id}/log",
  async ({ res, url, identity }, { id }) =>
    reply(res, await contactLog(url, identity!, Number(id))),
);
route("GET", "/api/tasks", async ({ res, url, identity }) =>
  reply(res, await taskIndex(url, identity!)),
);
route("POST", "/api/tasks", async ({ req, res, identity }) =>
  reply(res, await taskStore(identity!, await body(req)), 201),
);
routeParams(
  "GET",
  "/api/companies/{id}/tasks",
  async ({ res, url, identity }, { id }) =>
    reply(res, await taskIndex(url, identity!, Number(id))),
);
routeParams("GET", "/api/tasks/{id}", async ({ res, url, identity }, { id }) =>
  json(res, await taskDetail(url, identity!, Number(id))),
);
routeParams("PUT", "/api/tasks/{id}", async ({ req, res, identity }, { id }) =>
  reply(res, await taskUpdate(identity!, Number(id), await body(req))),
);
routeParams(
  "POST",
  "/api/tasks/{id}/archive",
  async ({ req, res, identity }, { id }) =>
    json(res, await taskArchive(identity!, Number(id), await body(req))),
);
routeParams(
  "GET",
  "/api/tasks/{id}/comments",
  async ({ res, url, identity }, { id }) =>
    reply(res, await taskComments(url, identity!, Number(id))),
);
routeParams(
  "POST",
  "/api/tasks/{id}/comments",
  async ({ req, res, identity }, { id }) =>
    json(res, await addComment(identity!, Number(id), await body(req)), 201),
);
routeParams(
  "PUT",
  "/api/tasks/{id}/comments/{commentId}",
  async ({ req, res, identity }, { id, commentId }) =>
    json(
      res,
      await updateComment(
        identity!,
        Number(id),
        Number(commentId),
        await body(req),
      ),
    ),
);
routeParams(
  "PATCH",
  "/api/tasks/{id}/comments/{commentId}",
  async ({ req, res, identity }, { id, commentId }) =>
    json(
      res,
      await commentVisibility(
        identity!,
        Number(id),
        Number(commentId),
        await body(req),
      ),
    ),
);
routeParams(
  "GET",
  "/api/tasks/{id}/log",
  async ({ res, url, identity }, { id }) =>
    reply(res, await taskLog(url, identity!, Number(id))),
);
routeParams(
  "GET",
  "/api/tasks/{id}/reminder.ics",
  async ({ res, identity }, { id }) => {
    const task = await findTask(identity!, Number(id), false);
    if (!task.deadline)
      throw new ApiError(
        409,
        "deadline_required",
        "Для задачи не задан дедлайн.",
      );
    res.writeHead(200, {
      "Content-Type": "text/calendar; charset=UTF-8",
      "Content-Disposition": `attachment; filename*=UTF-8''task-${id}.ics`,
      "X-Content-Type-Options": "nosniff",
    });
    res.end(taskCalendar(task));
  },
);
routeParams(
  "POST",
  "/api/tasks/{id}/attachments",
  async ({ req, res, identity }, { id }) =>
    json(res, await uploadAttachment(req, identity!, Number(id)), 201),
);
routeParams(
  "GET",
  "/api/tasks/{id}/attachments/{attachmentId}",
  async ({ res, identity }, { id, attachmentId }) =>
    downloadAttachment(res, identity!, Number(id), Number(attachmentId)),
);
routeParams(
  "DELETE",
  "/api/tasks/{id}/attachments/{attachmentId}",
  async ({ res, identity }, { id, attachmentId }) => {
    await deleteAttachment(identity!, Number(id), Number(attachmentId));
    res.writeHead(204);
    res.end();
  },
);
route("GET", "/api/users", async ({ res, url, identity }) =>
  reply(res, await userIndex(url, identity!)),
);
route("POST", "/api/users", async ({ req, res, identity }) =>
  reply(res, await userStore(identity!, await body(req)), 201),
);
routeParams("GET", "/api/users/{id}/photo", async ({ res, identity }, { id }) =>
  userPhoto(res, identity!, Number(id)),
);
routeParams("PUT", "/api/users/{id}", async ({ req, res, identity }, { id }) =>
  json(res, await userUpdate(identity!, Number(id), await body(req))),
);
routeParams(
  "POST",
  "/api/users/{id}/approve",
  async ({ req, res, identity }, { id }) =>
    json(res, await userApprove(identity!, Number(id), await body(req))),
);
routeParams("DELETE", "/api/users/{id}", async ({ res, identity }, { id }) => {
  await userReject(identity!, Number(id));
  res.writeHead(204);
  res.end();
});
routeParams(
  "POST",
  "/api/users/{id}/reset-password",
  async ({ req, res, identity }, { id }) =>
    reply(res, await userResetPassword(identity!, Number(id), await body(req))),
);
routeParams(
  "GET",
  "/api/users/{id}/log",
  async ({ res, url, identity }, { id }) =>
    reply(res, await userLog(url, identity!, Number(id))),
);
routeParams(
  "GET",
  "/api/users/{id}/sessions",
  async ({ res, url, identity }, { id }) =>
    reply(res, await userSessions(url, identity!, Number(id))),
);
routeParams(
  "GET",
  "/api/lookups/{type}",
  async ({ res, url, identity }, { type }) =>
    reply(res, await typedLookups(url, identity!, type!)),
);
routeParams(
  "POST",
  "/api/lookups/{type}",
  async ({ req, res, identity }, { type }) =>
    json(res, await lookupStore(identity!, type!, await body(req)), 201),
);
routeParams(
  "PUT",
  "/api/lookups/{type}/{id}",
  async ({ req, res, identity }, { type, id }) =>
    json(
      res,
      await lookupUpdate(identity!, type!, Number(id), await body(req)),
    ),
);
routeParams(
  "GET",
  "/api/lookups/{type}/{id}/log",
  async ({ res, url, identity }, { type, id }) =>
    reply(res, await lookupLog(url, identity!, type!, Number(id))),
);
routeParams(
  "DELETE",
  "/api/profile/sessions/{id}",
  async ({ res, identity }, { id }) => {
    await revokeSession(identity!, Number(id));
    res.writeHead(204);
    res.end();
  },
);

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=()",
  );
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.setHeader("Cache-Control", "no-store");
  const origin = req.headers.origin;
  if (
    process.env.APP_ENV === "development" &&
    (origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173")
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = decodeURIComponent(url.pathname).replace(/\/$/, "") || "/";
  if (!path.startsWith("/api/")) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'",
    );
    await serveStatic(req, res, path);
    return;
  }
  const publicRoute =
    /^\/api\/(?:health|auth\/(?:login|register|forgot-password|reset-password))$/.test(
      path,
    );
  const identity = path === "/api/health" ? null : await resolve(req, res);
  if (!publicRoute && !identity)
    throw new ApiError(401, "unauthenticated", "Требуется вход в систему.");
  if (
    !publicRoute &&
    identity?.user.must_change_password &&
    !(
      (req.method === "GET" && path === "/api/auth/me") ||
      (req.method === "POST" && path === "/api/auth/logout") ||
      (req.method === "PUT" && path === "/api/profile/password")
    )
  )
    throw new ApiError(
      403,
      "password_change_required",
      "Перед работой с CRM необходимо изменить временный пароль.",
    );
  if (!publicRoute && !["GET", "HEAD", "OPTIONS"].includes(req.method ?? ""))
    validateCsrf(req, identity!);
  let handler = routes.get(`${req.method} ${path}`);
  if (!handler)
    for (const candidate of parameterRoutes) {
      if (candidate.method !== req.method) continue;
      const match = candidate.pattern.exec(path);
      if (match) {
        handler = (ctx) => candidate.handler(ctx, match.groups ?? {});
        break;
      }
    }
  if (!handler)
    throw new ApiError(404, "route_not_found", "Эндпоинт не найден.");
  await handler({ req, res, url, identity });
}

export const server = createServer((req, res) => {
  void handle(req, res).catch((error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    if (error instanceof ApiError)
      reply(
        res,
        {
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        error.status,
      );
    else {
      console.error(error);
      const payload: {
        error: { code: string; message: string; debug?: string };
      } = {
        error: {
          code: "server_error",
          message: "Внутренняя ошибка сервера.",
        },
      };
      if (envBool("APP_DEBUG"))
        payload.error.debug =
          error instanceof Error ? error.message : String(error);
      reply(res, payload, 500);
    }
  });
});

if (process.env.NODE_ENV !== "test") {
  validateEnvironment()
    .then(() => server.listen(Number(process.env.PORT ?? 8080)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
      void db.end();
    });
}
