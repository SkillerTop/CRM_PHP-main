import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readUrlFilter, urlWithFilter } from "../app/url-filters.mjs";
import "./responsive-layout.test.mjs";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const request = new Request("http://localhost/", { headers: { accept: "text/html" } });
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };
  return typeof worker === "function" ? worker(request, env, context) : worker.fetch(
    request,
    env,
    context,
  );
}

test("renders the CRM frontend shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="en"/i);
  assert.match(html, /<title>Client Data CRM<\/title>/i);
  assert.match(html, /width=device-width/i);
  assert.match(html, /Connecting to CRM/i);
  assert.doesNotMatch(html, /ChatGPT|OpenAI|Google/i);
});

test("connects the application to the PHP API and stays responsive", async () => {
  const [component, apiClient, proxy, css, packageJson, hosting, ssrBundle] = await Promise.all([
    readFile(new URL("app/CRMApp.tsx", root), "utf8"),
    readFile(new URL("app/api-client.ts", root), "utf8"),
    readFile(new URL("app/api/backend/[...path]/route.ts", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("dist/server/ssr/index.js", root), "utf8"),
  ]);

  assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
  assert.match(component, /apiRequest<\{ data: WorkspacePayload \}>\("\/app\/bootstrap"\)/);
  assert.match(component, /apiRequest<\{ data: \{ user: ApiRecord; csrf_token: string \} \}>\("\/auth\/login"/);
  assert.match(component, /apiRequest<\{ data: \{ user: ApiRecord; csrf_token: string \} \}>\("\/auth\/me"\)/);
  assert.match(component, /apiRequest\("\/profile\/password", \{ method: "PUT"/);
  assert.match(apiClient, /credentials: "same-origin"/);
  assert.match(apiClient, /headers\.set\("x-csrf-token", csrfToken\)/);
  assert.match(apiClient, /if \(!isJson\)[\s\S]*invalid_server_response/);
  assert.match(proxy, /process\.env\.CRM_BACKEND_URL/);
  assert.match(proxy, /`\$\{backend\}\/api\/\$\{path/);
  assert.doesNotMatch(packageJson, /drizzle|database|sqlite|postgres|mysql/i);
  assert.doesNotMatch(hosting, /"d1"\s*:\s*"|"r2"\s*:\s*"/i);
  assert.doesNotMatch(ssrBundle, /from\s+["'](?:react(?:\/[^"']*)?|react-dom(?:\/[^"']*)?|react-server-dom-webpack(?:\/[^"']*)?)["']/i);
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
  const component = await readFile(new URL("app/CRMApp.tsx", root), "utf8");
  const urlHook = await readFile(new URL("app/hooks/use-url-string-state.ts", root), "utf8");

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
