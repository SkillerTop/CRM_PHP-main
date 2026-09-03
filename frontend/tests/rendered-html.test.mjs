import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { loadReadNotificationIds, READ_NOTIFICATIONS_STORAGE_KEY, saveReadNotificationIds, updateReadNotificationAccount } from "../src/shared/utils/notification-storage.ts";
import { readUrlFilter, urlWithFilter } from "../src/shared/utils/url-filters.mjs";

const root = new URL("../", import.meta.url);

async function readBuiltAssets() {
  const assetsUrl = new URL("dist/assets/", root);
  const files = (await readdir(assetsUrl)).filter((name) => /\.(?:css|js)$/i.test(name));
  return (await Promise.all(files.map((name) => readFile(new URL(name, assetsUrl), "utf8")))).join("\n");
}

test("builds the CRM as a static SPA shell", async () => {
  const html = await readFile(new URL("dist/index.html", root), "utf8");
  const assets = await readBuiltAssets();

  assert.match(html, /<html[^>]*lang="en"/i);
  assert.match(html, /<title>Client Data CRM<\/title>/i);
  assert.match(html, /width=device-width/i);
  assert.match(html, /<div id="root"><\/div>/i);
  assert.match(html, /\/assets\/[^"']+\.js/i);
  assert.match(assets, /Connecting to CRM/i);
  assert.doesNotMatch(html, /ChatGPT|OpenAI|Google/i);
  await assert.rejects(access(new URL("dist/server/", root)));
});

test("connects the static application directly to the same-origin PHP API", async () => {
  const [component, apiClient, viteConfig, css, packageJson, hosting, htaccess, main] = await Promise.all([
    readFile(new URL("src/app/CRMApp.tsx", root), "utf8"),
    readFile(new URL("src/shared/api/api-client.ts", root), "utf8"),
    readFile(new URL("vite.config.ts", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("public/.htaccess", root), "utf8"),
    readFile(new URL("src/main.tsx", root), "utf8"),
  ]);

  assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
  assert.match(component, /apiRequest<\{ data: WorkspacePayload \}>\("\/app\/bootstrap\?include_records=0"\)/);
  assert.match(component, /apiRequest<\{ data: \{ user: ApiRecord; csrf_token: string \} \}>\("\/auth\/login"/);
  assert.match(component, /apiRequest<\{ data: \{ user: ApiRecord; csrf_token: string \} \}>\("\/auth\/me"\)/);
  assert.match(component, /apiRequest\("\/profile\/password", \{ method: "PUT"/);
  assert.match(component, /link\.href = `\/api\/audit\?\$\{params\}`/);
  assert.match(apiClient, /credentials: "same-origin"/);
  assert.match(apiClient, /credentials: normalizedBaseUrl === "" \? "same-origin" : "include"/);
  assert.match(apiClient, /headers\.set\("x-csrf-token", csrfToken\)/);
  assert.match(apiClient, /fetch\(`\$\{normalizedBaseUrl\}\/api\$\{path\.startsWith/);
  assert.doesNotMatch(apiClient, /\/api\/backend/);
  assert.match(apiClient, /if \(!isJson\)[\s\S]*invalid_server_response/);
  assert.match(viteConfig, /plugins: \[react\(\)\]/);
  assert.match(viteConfig, /base: "\/"/);
  assert.match(viteConfig, /outDir: "dist"/);
  assert.match(viteConfig, /"\/api": \{/);
  assert.match(viteConfig, /CRM_PROXY_TIMEOUT_MS \|\| "900000"/);
  assert.match(viteConfig, /proxyTimeout/);
  assert.match(main, /createRoot\(root\)\.render\(<CRMApp \/>\)/);
  assert.match(main, /\.\.\/app\/globals\.css/);
  assert.match(htaccess, /DirectoryIndex index\.html/);
  assert.match(htaccess, /RewriteRule \^api[^\n]+index\.php \[QSA,L\]/);
  assert.match(htaccess, /RewriteRule \^assets[^\n]+\[R=404,L\]/);
  assert.match(htaccess, /RewriteRule \^ index\.html \[L\]/);
  assert.match(htaccess, /AddType text\/plain \.aff \.dic/);
  assert.match(htaccess, /Content-Security-Policy/);
  assert.doesNotMatch(packageJson, /next|vinext|cloudflare|react-server-dom/i);
  assert.doesNotMatch(hosting, /"d1"\s*:\s*"|"r2"\s*:\s*"/i);
  assert.match(css, /\.table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /@media\s*\(max-width:\s*700px\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(component, /Viewing as|Viewing permissions as role/);
  assert.match(component, /const currentRole = identity\?\.role/);
  assert.match(component, /Awaiting Response/);
  assert.match(component, /CJN Manager/);
  assert.match(component, /task\.comment/);
  assert.match(component, /Lookups/);
  assert.doesNotMatch(component, /€|₴|£|¥|\b(?:USD|EUR|UAH|GBP|revenue|turnover|money|cash|currency|amount|pricing|price|budget|invoice|billing|payment|profit|commission|expense|sales|commercial|quotation|quote|proposal|opportunity|qualified|potential)\b|preferred-rate/i);
});

test("keeps list filters in shareable URL parameters", async () => {
  const component = await readFile(new URL("src/app/CRMApp.tsx", root), "utf8");
  const urlHook = await readFile(new URL("src/shared/hooks/use-url-string-state.ts", root), "utf8");

  const companyUrl = urlWithFilter("http://localhost/?view=companies", "company_status", "Lead", "All statuses");
  assert.equal(companyUrl, "/?view=companies&company_status=Lead");
  assert.equal(readUrlFilter("?view=companies&company_status=Lead", "company_status", "All statuses"), "Lead");
  assert.equal(readUrlFilter("?task_state=Unknown", "task_state", "Actual", ["Actual", "Completed"]), "Actual");
  assert.equal(urlWithFilter(`http://localhost${companyUrl}`, "company_status", "All statuses", "All statuses"), "/?view=companies");

  assert.match(component, /useUrlStringState<View>\("view", "dashboard", ALL_VIEWS\)/);
  for (const parameter of [
    "company_q", "company_status", "company_owner", "company_country", "company_type",
    "contact_q", "contact_source", "contact_initiator", "contact_company", "contact_linkedin",
    "task_state", "task_manager", "audit_user", "audit_entity", "audit_from", "audit_to",
  ]) {
    assert.match(component, new RegExp(`useUrlStringState\\(\\"${parameter}\\"`), `Missing URL state for ${parameter}`);
  }
  assert.match(urlHook, /window\.addEventListener\("popstate", restoreFromUrl\)/);
  assert.match(urlHook, /window\.history\.replaceState/);
  assert.match(component, /window\.history\.pushState/);
});

test("persists read notification ids per account across page reloads", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const initial = updateReadNotificationAccount({}, "user:17", ["audit:E-42", "audit:E-42", "deadline:T-7:2026-08-27"]);
  saveReadNotificationIds(initial, storage);

  assert.equal(values.has(READ_NOTIFICATIONS_STORAGE_KEY), true);
  assert.deepEqual(loadReadNotificationIds(storage), {
    "user:17": ["audit:E-42", "deadline:T-7:2026-08-27"],
  });

  values.set(READ_NOTIFICATIONS_STORAGE_KEY, "invalid json");
  assert.deepEqual(loadReadNotificationIds(storage), {});

  const component = await readFile(new URL("src/app/CRMApp.tsx", root), "utf8");
  assert.match(component, /useState<Record<string, string\[\]>>\(\(\) => loadReadNotificationIds\(\)\)/);
  assert.match(component, /const notificationReadAccountKey = identity\?\.id \? `user:\$\{identity\.id\}`/);
  assert.match(component, /saveReadNotificationIds\(readNotificationIdsByAccount\)/);
});
