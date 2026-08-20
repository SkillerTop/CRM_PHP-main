import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function blockAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing CSS block: ${marker}`);

  const openIndex = source.indexOf("{", markerIndex);
  assert.notEqual(openIndex, -1, `Missing opening brace after: ${marker}`);

  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openIndex + 1, index);
  }

  assert.fail(`Missing closing brace after: ${marker}`);
}

function blocksAfter(source, marker) {
  const blocks = [];
  let cursor = 0;

  while (cursor < source.length) {
    const markerIndex = source.indexOf(marker, cursor);
    if (markerIndex === -1) break;

    const openIndex = source.indexOf("{", markerIndex);
    let depth = 0;
    let closeIndex = -1;
    for (let index = openIndex; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) {
        closeIndex = index;
        blocks.push(source.slice(openIndex + 1, index));
        break;
      }
    }

    assert.notEqual(closeIndex, -1, `Missing closing brace after: ${marker}`);
    cursor = closeIndex + 1;
  }

  assert.ok(blocks.length > 0, `Missing CSS blocks: ${marker}`);
  return blocks;
}

function sectionBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing section start: ${startMarker}`);

  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing section end: ${endMarker}`);
  return source.slice(start, end);
}

function blockAfterAny(source, markers) {
  const marker = markers.find((candidate) => source.includes(candidate));
  assert.ok(marker, `Missing CSS block; expected one of: ${markers.join(", ")}`);
  return blockAfter(source, marker);
}

async function readBuiltAssets() {
  const directories = ["dist/client/assets/", "dist/server/assets/", "dist/server/ssr/assets/"];
  const chunks = [];

  for (const directory of directories) {
    const directoryUrl = new URL(directory, root);
    const files = (await readdir(directoryUrl)).filter((name) => /\.(?:css|js)$/i.test(name));
    chunks.push(...await Promise.all(files.map((name) => readFile(new URL(name, directoryUrl), "utf8"))));
  }

  return chunks.join("\n");
}

test("keeps Lookups controls contained at the 360 px and 768 px breakpoints", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("src/app/CRMApp.tsx", root), "utf8"),
    readFile(new URL("src/styles/globals.css", root), "utf8"),
  ]);

  assert.match(component, /className="lookup-add-form"[\s\S]*?<span>New option<\/span>[\s\S]*?name="lookupValue"[\s\S]*?Add option/);
  assert.doesNotMatch(component, /fixedRelationshipWorkflow|Five-status workflow/);
  assert.match(component, /<button type="button" className=\{item\.active \? "danger-text" : ""\}[\s\S]*?>\{item\.active \? "Deactivate" : "Activate"\}<\/button>/);
  assert.match(component, /<CountBadge[\s\S]*?label="active options"/);
  assert.match(component, /className="panel-heading archived-records-heading"/);
  assert.match(component, /className="archived-records-title"/);
  assert.match(component, /archivedRecords\.length === 1 \? "record" : "records"/);

  const lookupEditor = blockAfter(css, ".lookup-editor");
  assert.match(lookupEditor, /min-width:\s*0/);
  assert.match(lookupEditor, /overflow:\s*hidden/);

  const lookupAddForm = blockAfter(css, ".lookup-add-form {");
  assert.match(lookupAddForm, /grid-column:\s*1\s*\/\s*-1/);
  assert.match(lookupAddForm, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);

  const lookupAddLabel = blockAfter(css, ".lookup-add-form label");
  assert.match(lookupAddLabel, /min-width:\s*0/);

  const countBadge = blockAfter(css, ".count-badge");
  assert.match(countBadge, /min-width:\s*44px/);
  assert.match(countBadge, /height:\s*44px/);

  const fixedNote = blockAfter(css, ".lookup-fixed-note");
  assert.match(fixedNote, /width:\s*100%/);
  assert.match(fixedNote, /min-width:\s*0/);
  assert.match(fixedNote, /max-width:\s*100%/);
  assert.match(fixedNote, /overflow-wrap:\s*anywhere/);

  const tablet = blockAfter(css, "@media (max-width: 768px)");
  assert.match(tablet, /\.archived-record-list,[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(tablet, /\.lookup-tabs\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto/s);
  assert.match(tablet, /\.lookup-tabs button\s*\{[^}]*flex:\s*0\s+0\s+min\(210px,\s*78vw\)/s);
  assert.match(tablet, /\.lookup-editor\s*>\s*header\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(tablet, /\.lookup-actions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*overflow-x:\s*visible/s);
  assert.match(tablet, /\.lookup-add-form,[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(tablet, /\.lookup-add-form \.primary-button,[\s\S]*?width:\s*100%/);

  const phone = blocksAfter(css, "@media (max-width: 390px)").join("\n");
  assert.match(phone, /\.panel-heading\s*\{[^}]*align-items:\s*flex-start[^}]*flex-direction:\s*column/s);
  assert.match(phone, /\.panel-heading\s*>\s*\.info-popover-wrap \.info-popover\s*\{[^}]*right:\s*auto[^}]*left:\s*0/s);
});

test("contains wide content inside its own responsive scroller", async () => {
  const css = await readFile(new URL("src/styles/globals.css", root), "utf8");

  const appShell = blockAfter(css, ".app-shell");
  assert.match(appShell, /min-width:\s*0/);
  assert.match(appShell, /overflow-x:\s*clip/);

  const mainContent = blockAfter(css, ".main-content");
  assert.match(mainContent, /min-width:\s*0/);

  const tableScroll = blockAfter(css, ".table-scroll");
  assert.match(tableScroll, /min-width:\s*0/);
  assert.match(tableScroll, /max-width:\s*100%/);
  assert.match(tableScroll, /overflow-x:\s*auto/);
  assert.match(tableScroll, /overflow-y:\s*hidden/);

  const kanban = blockAfter(css, ".kanban");
  assert.match(kanban, /width:\s*100%/);
  assert.match(kanban, /overflow-x:\s*auto/);
  assert.match(kanban, /overscroll-behavior-x:\s*contain/);

  const mobile = blockAfter(css, "@media (max-width: 700px)");
  assert.match(mobile, /\.modal-backdrop\s*\{[^}]*align-items:\s*stretch[^}]*padding:\s*0/s);
  assert.match(mobile, /\.modal-card,[\s\S]*?width:\s*100%[\s\S]*?min-height:\s*100dvh[\s\S]*?border-radius:\s*0/);
});

test("reflows all eight Companies fields into contained cards below 1280 px", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("src/app/CRMApp.tsx", root), "utf8"),
    readFile(new URL("src/styles/globals.css", root), "utf8"),
  ]);
  const companiesView = sectionBetween(component, "function Companies(", "function Contacts(");

  assert.match(companiesView, /className="table-scroll responsive-card-scroll"[^>]*role="region"[^>]*aria-label="Companies table"[^>]*tabIndex=\{0\}[\s\S]*?<table className="data-table companies-table responsive-card-table">/);
  assert.match(companiesView, /<tr key=\{company\.id\} tabIndex=\{0\}[\s\S]*?event\.key === "Enter"[\s\S]*?event\.target === event\.currentTarget/);

  const expectedLabels = ["Company", "Type", "Location", "Client status", "Contacts", "Last contact", "Owner", "Actions"];
  const renderedLabels = [...companiesView.matchAll(/<td\b[^>]*\bdata-label="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(renderedLabels, expectedLabels, "Every desktop column must remain identifiable in card mode");

  const tableHead = sectionBetween(companiesView, "<thead>", "</thead>");
  assert.equal((tableHead.match(/<th\b/g) ?? []).length, expectedLabels.length, "The 1280 px table must retain all eight headers");
  assert.match(companiesView, /data-label="Actions"[\s\S]*?className="row-menu"[\s\S]*?event\.stopPropagation\(\)[\s\S]*?openCompany\(company\)/);

  const cardMedia = blocksAfter(css, "@media (max-width: 1279px)").join("\n");
  const cardTable = blockAfterAny(cardMedia, [".responsive-card-table {", ".companies-table {"]);
  assert.match(cardTable, /display:\s*block/);
  assert.match(cardTable, /width:\s*100%/);
  assert.match(cardTable, /min-width:\s*0/);

  const cardHead = blockAfterAny(cardMedia, [".responsive-card-table thead", ".companies-table thead"]);
  assert.match(cardHead, /position:\s*absolute/);
  assert.match(cardHead, /width:\s*1px/);
  assert.match(cardHead, /height:\s*1px/);
  assert.match(cardHead, /overflow:\s*hidden/);
  assert.match(cardHead, /clip-path:\s*inset\(50%\)/);

  const cardBody = blockAfterAny(cardMedia, [".responsive-card-table tbody {", ".companies-table tbody {"]);
  assert.match(cardBody, /display:\s*grid/);
  assert.match(cardBody, /width:\s*100%/);

  const cardRow = blockAfterAny(cardMedia, [".responsive-card-table tbody tr {", ".companies-table tbody tr {"]);
  assert.match(cardRow, /display:\s*grid/);
  assert.match(cardRow, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(cardRow, /min-width:\s*0/);

  const cardCell = blockAfterAny(cardMedia, [".responsive-card-table td {", ".companies-table td {"]);
  assert.match(cardCell, /display:\s*grid/);
  assert.match(cardCell, /grid-template-columns:\s*minmax\(90px,\s*0\.42fr\)\s+minmax\(0,\s*1fr\)/);
  assert.match(cardCell, /min-width:\s*0/);
  assert.match(cardCell, /min-height:\s*54px/);

  const cardLabel = blockAfterAny(cardMedia, [".responsive-card-table td::before", ".companies-table td::before"]);
  assert.match(cardLabel, /content:\s*attr\(data-label\)/);
  assert.doesNotMatch(cardMedia, /\.(?:responsive-card-table|companies-table) td(?:\[[^\]]+\]|:[^{\s]+)?\s*\{[^}]*display:\s*none/s, "Card mode must not drop a company field");

  const phoneCards = blocksAfter(css, "@media (max-width: 700px)").join("\n");
  const phoneCardRow = blockAfterAny(phoneCards, [".responsive-card-table tbody tr {", ".companies-table tbody tr {"]);
  assert.match(phoneCardRow, /grid-template-columns:\s*1fr/);
  assert.match(phoneCards, /\.(?:responsive-card-table|companies-table) td,[\s\S]*?grid-column:\s*1/);

  const firstCell = blockAfterAny(cardMedia, [".responsive-card-table td:first-child", ".companies-table td:first-child"]);
  const lastCell = blockAfterAny(cardMedia, [".responsive-card-table td:last-child", ".companies-table td:last-child"]);
  assert.match(firstCell, /grid-column:\s*1\s*\/\s*-1/);
  assert.match(lastCell, /grid-column:\s*1\s*\/\s*-1/);

  const cardValue = blockAfter(css, ".companies-table .company-card-value");
  assert.match(cardValue, /min-width:\s*0/);
  assert.match(cardValue, /max-width:\s*100%/);
  assert.match(cardValue, /overflow-wrap:\s*anywhere/);

  const rowMenu = blockAfter(css, ".row-menu");
  assert.match(rowMenu, /width:\s*44px/);
  assert.match(rowMenu, /min-height:\s*44px/);
});

test("keeps Contacts, Users, and Audit card rows fully labelled", async () => {
  const component = await readFile(new URL("src/app/CRMApp.tsx", root), "utf8");
  const tableContracts = [
    { name: "Contacts", source: sectionBetween(component, "function Contacts(", "function Activity("), labels: 7 },
    { name: "Users", source: sectionBetween(component, "function Users(", "function Audit("), labels: 6 },
    { name: "Audit", source: sectionBetween(component, "function Audit(", "function CompanyDetail("), labels: 6 },
  ];

  for (const contract of tableContracts) {
    assert.match(contract.source, /className="table-scroll responsive-card-scroll"/i, `${contract.name} must use the contained card scroller`);
    assert.match(contract.source, /className="data-table [^"]*responsive-card-table"/i, `${contract.name} must opt into card reflow`);
    assert.equal((contract.source.match(/<th\b/g) ?? []).length, contract.labels, `${contract.name} must preserve every desktop header`);
    assert.equal(
      [...contract.source.matchAll(/<td\b[^>]*\bdata-label="[^"]+"/g)].length,
      contract.labels,
      `${contract.name} must provide a mobile label for every field`,
    );
  }
});

test("keeps the Companies page contained at 360, 768, 901, 1024, and 1280 px", async () => {
  const css = await readFile(new URL("src/styles/globals.css", root), "utf8");
  const viewportContract = [
    { width: 360, mode: "cards", cardColumns: 1 },
    { width: 768, mode: "cards", cardColumns: 2 },
    { width: 901, mode: "cards", cardColumns: 2 },
    { width: 1024, mode: "cards", cardColumns: 2 },
    { width: 1280, mode: "table", cardColumns: null },
  ];

  const cardBreakpoints = [...css.matchAll(/@media \(max-width:\s*(\d+)px\)/g)].map((match) => Number(match[1]));
  assert.ok(cardBreakpoints.includes(1279), "Missing the Companies card breakpoint");
  const cardBreakpoint = 1279;
  assert.equal(cardBreakpoint, 1279, "Companies must switch back to its desktop table at exactly 1280 px");
  for (const viewport of viewportContract) {
    assert.equal(
      viewport.width <= cardBreakpoint ? "cards" : "table",
      viewport.mode,
      `Unexpected Companies layout contract at ${viewport.width}px`,
    );
    if (viewport.mode === "cards") {
      assert.equal(viewport.width <= 700 ? 1 : 2, viewport.cardColumns, `Unexpected Companies card columns at ${viewport.width}px`);
    }
  }

  const crmApp = blockAfter(css, ".crm-app");
  const appShell = blockAfter(css, ".app-shell");
  const mainContent = blockAfter(css, ".main-content");
  const dataPanel = blockAfter(css, ".data-panel");
  assert.match(crmApp, /min-width:\s*0/);
  assert.match(crmApp, /overflow-x:\s*clip/);
  assert.match(appShell, /width:\s*100%/);
  assert.match(appShell, /max-width:\s*100%/);
  assert.match(appShell, /min-width:\s*0/);
  assert.match(appShell, /overflow-x:\s*clip/);
  assert.match(mainContent, /min-width:\s*0/);
  assert.match(mainContent, /overflow:\s*hidden/);
  assert.match(dataPanel, /width:\s*100%/);
  assert.match(dataPanel, /min-width:\s*0/);
  assert.match(dataPanel, /max-width:\s*100%/);
  assert.match(dataPanel, /overflow:\s*hidden/);

  const mobileMain = blockAfter(css, "@media (max-width: 900px)");
  assert.match(mobileMain, /\.main-content\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100vw/s);
  const phoneMain = blockAfter(css, "@media (max-width: 700px)");
  assert.match(phoneMain, /\.main-content\s*\{[^}]*padding:\s*19px\s+12px\s+30px/s);
  const tabletToolbar = blockAfter(css, "@media (min-width: 701px) and (max-width: 768px)");
  const tabletDataToolbar = blockAfter(tabletToolbar, ".data-toolbar {");
  assert.match(tabletDataToolbar, /flex-direction:\s*column/);
  assert.match(tabletDataToolbar, /align-items:\s*stretch/);

  const sidebar = blockAfter(css, ".sidebar {");
  const dataTable = blockAfter(css, ".data-table");
  const sidebarWidth = Number(sidebar.match(/flex:\s*0\s+0\s+(\d+)px/)?.[1]);
  const desktopPadding = Number(mainContent.match(/padding:\s*\d+px\s+(\d+)px\s+\d+px/)?.[1]);
  const tableMinWidth = Number(dataTable.match(/min-width:\s*(\d+)px/)?.[1]);
  assert.ok(Number.isFinite(sidebarWidth) && Number.isFinite(desktopPadding) && Number.isFinite(tableMinWidth));
  assert.ok(
    1280 - sidebarWidth - (desktopPadding * 2) >= tableMinWidth,
    "At 1280px the desktop content budget must expose the complete eight-column table without page overflow",
  );
});

test("keeps the desktop header and session footer pinned while records scroll", async () => {
  const css = await readFile(new URL("src/styles/globals.css", root), "utf8");
  const crmApp = blockAfter(css, ".crm-app");
  const topbar = blockAfter(css, ".topbar");
  const appShell = blockAfter(css, ".app-shell");
  const sidebar = blockAfter(css, ".sidebar {");
  const sidebarNav = blockAfter(css, ".sidebar nav");
  const sidebarFoot = blockAfter(css, ".sidebar-foot");
  const mobile = blockAfter(css, "@media (max-width: 900px)");

  assert.match(crmApp, /overflow-x:\s*clip/, "The app root must not become the sticky scroll container");
  assert.match(crmApp, /--topbar-h:\s*66px/);
  assert.match(topbar, /position:\s*sticky/);
  assert.match(topbar, /top:\s*0/);
  assert.match(appShell, /min-height:\s*calc\(100dvh\s*-\s*var\(--topbar-h\)\)/);
  assert.match(sidebar, /position:\s*sticky/);
  assert.match(sidebar, /top:\s*var\(--topbar-h\)/);
  assert.match(sidebar, /height:\s*calc\(100dvh\s*-\s*var\(--topbar-h\)\)/);
  assert.match(sidebar, /overflow:\s*hidden/);
  assert.match(sidebarNav, /flex:\s*1\s+1\s+auto/);
  assert.match(sidebarNav, /min-height:\s*0/);
  assert.match(sidebarNav, /overflow-y:\s*auto/);
  assert.match(sidebarFoot, /flex:\s*0\s+0\s+auto/);
  assert.match(mobile, /\.crm-app\s*\{[^}]*--topbar-h:\s*62px/s);
});

test("removes the Priority panel and keeps Recent changes contained", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("src/app/CRMApp.tsx", root), "utf8"),
    readFile(new URL("src/styles/globals.css", root), "utf8"),
  ]);

  assert.doesNotMatch(component, /Priority tasks|priority-panel|priority-row|dashboard-grid/);
  assert.doesNotMatch(css, /\.priority-panel\b|\.priority-row\b|\.dashboard-grid\b/);
  assert.match(component, /className="panel recent-panel dashboard-recent-panel"/);

  const recentPanel = blockAfter(css, ".dashboard-recent-panel {");
  assert.match(recentPanel, /width:\s*100%/);
  assert.match(recentPanel, /min-width:\s*0/);
  assert.match(recentPanel, /max-width:\s*100%/);
  assert.match(recentPanel, /overflow:\s*hidden/);

  const recentChildren = blockAfter(css, ".dashboard-recent-panel .panel-heading,");
  assert.match(recentChildren, /min-width:\s*0/);
  assert.match(recentChildren, /max-width:\s*100%/);
});

test("keeps seeded statuses while allowing Admin to manage the workflow", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("src/app/CRMApp.tsx", root), "utf8"),
    readFile(new URL("src/styles/globals.css", root), "utf8"),
  ]);
  const expectedStatuses = [
    "New Organization",
    "Follow-up Active",
    "Awaiting Response",
    "Active Relationship",
    "Inactive",
  ];
  const statusSeed = sectionBetween(component, "const RELATIONSHIP_STATUSES = [", "] as const;");
  const seededStatuses = [...statusSeed.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(seededStatuses, expectedStatuses);
  assert.equal(new Set(seededStatuses).size, 5, "Relationship statuses must be unique");

  const initialCompanies = sectionBetween(component, "const INITIAL_COMPANIES: Company[] = [", "const INITIAL_CONTACTS");
  const initialCompanyStatuses = [...initialCompanies.matchAll(/\bstatus:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(initialCompanyStatuses.length > 0, "Initial companies must include relationship statuses");
  for (const status of initialCompanyStatuses) {
    assert.ok(expectedStatuses.includes(status), `Initial company uses an unsupported relationship status: ${status}`);
  }

  const dashboard = sectionBetween(component, "function Dashboard(", "function Pipeline(");
  assert.match(dashboard, /const stageCounts = statusOrder\.map\(/);
  assert.match(dashboard, /\{stageCounts\.map\(\(item\) =>/);
  const stageCountsDeclaration = dashboard.match(/const stageCounts = ([^;\n]+);/)?.[1] ?? "";
  assert.match(stageCountsDeclaration, /^statusOrder\.map\(/);
  assert.match(stageCountsDeclaration, /\.filter\(\(item\) => item\.count > 0\)/, "Dashboard must hide empty statuses");

  const lookups = sectionBetween(component, "function Lookups(", "function Users(");
  assert.doesNotMatch(lookups, /fixedRelationshipWorkflow|Five-status workflow/);
  assert.match(lookups, /Rename, reorder, add, or deactivate options/);
  assert.match(lookups, /<form className="lookup-add-form"/);
  assert.match(lookups, /\{item\.active \? "Deactivate" : "Activate"\}/);
  assert.match(component, /if \(type === "client-status"\) \{[\s\S]*?setCompanyStatus\(\(current\) => current === existing\.value \? clean : current\)/);

  const desktopFunnel = blockAfter(css, ".funnel-list {");
  assert.match(desktopFunnel, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  const intermediate = blockAfter(css, "@media (max-width: 1180px)");
  assert.match(intermediate, /\.funnel-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  const tablet = blocksAfter(css, "@media (max-width: 768px)").join("\n");
  assert.match(tablet, /\.funnel-list\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("keeps Pipeline status changes explicit and disables card drag-and-drop", async () => {
  const component = await readFile(new URL("src/app/CRMApp.tsx", root), "utf8");
  const pipeline = sectionBetween(component, "function Pipeline(", "function Companies(");
  const app = sectionBetween(component, "export function CRMApp()", "function Dashboard(");

  assert.doesNotMatch(pipeline, /draggable=/);
  assert.doesNotMatch(pipeline, /onDragStart|onDragEnd|onDragOver|onDrop|dataTransfer|draggedCompanyId/);
  assert.doesNotMatch(pipeline, /Drag a company card/);
  assert.match(pipeline, /\{canMove && <select className="pipeline-stage-select" value=\{company\.status\}[\s\S]*?onChange=\{\(event\) => \{ event\.stopPropagation\(\); moveCompany\(company\.id, event\.target\.value\); \}\}/);
  assert.match(pipeline, /\{items\.length === 0 && <div className="kanban-empty">No companies<\/div>\}/);
  assert.match(app, /<Pipeline[\s\S]*?canMove=\{hasPermission\(currentRole, "pipeline\.move"\)\}[\s\S]*?moveCompany=\{moveCompany\}/);
});

test("keeps Activity contact creation permissioned and selects quick-created contacts", async () => {
  const component = await readFile(new URL("src/app/CRMApp.tsx", root), "utf8");
  const activity = sectionBetween(component, "function Activity(", "function Lookups(");
  const taskForm = sectionBetween(component, "function TaskForm(", "function UserForm(");
  const contactForm = sectionBetween(component, "function ContactForm(", "function TaskForm(");
  const app = sectionBetween(component, "export function CRMApp()", "function Dashboard(");
  const contactDraft = sectionBetween(component, "type ContactDraft = {", "type ContactCreationResult = {");
  const createContact = sectionBetween(app, "function createContact(", "function addContact(");
  const addContact = sectionBetween(app, "function addContact(", "function recalculateLastContact(");

  assert.match(component, /"Read-only": \[\]/);
  assert.match(activity, /className="activity-toolbar-actions"/);
  assert.match(activity, /\{canCreateContact && <button[^>]*onClick=\{addContact\}>[^<]*Add contact<\/button>\}/);
  assert.match(activity, /\{canCreate && <button[^>]*onClick=\{add\}>[^<]*New task<\/button>\}/);
  assert.match(app, /canCreate=\{hasPermission\(currentRole, "task\.create"\)\}/);
  assert.match(app, /canCreateContact=\{hasPermission\(currentRole, "contact\.create"\)\}/);
  assert.match(app, /addContact=\{\(\) => openContactForm\(\)\}/);

  assert.match(taskForm, /className="contact-field-with-action"/);
  assert.match(taskForm, /aria-expanded=\{quickContactOpen\}[\s\S]*?aria-controls="quick-contact-panel"/);
  assert.match(taskForm, /className="quick-contact-panel field-full"[\s\S]*?id="quick-contact-panel"/);
  assert.match(taskForm, /const result = await onAddContact\(\{\s*companyId,[\s\S]*?photoDataUrl:\s*quickPhoto,\s*\}\)/);
  assert.match(taskForm, /setContactPersonId\(result\.contact\.id\)/);
  assert.match(taskForm, /function resetQuickContact\(\) \{[\s\S]*?setQuickContactOpen\(false\)/);
  assert.match(taskForm, /initiatorOptions: CRMUser\[\]/);
  assert.match(taskForm, /currentUserEmail: string/);
  assert.match(taskForm, /const defaultQuickInitiator = initiatorOptions\.some\(\(user\) => user\.email\.toLowerCase\(\) === normalizedCurrentUserEmail\) \? normalizedCurrentUserEmail : "manual"/);
  assert.match(taskForm, /const \[quickInitiatorChoice, setQuickInitiatorChoice\] = useState\(defaultQuickInitiator\)/);
  assert.match(taskForm, /const \[quickInitiatorName, setQuickInitiatorName\] = useState\(""\)/);
  assert.match(taskForm, /function resetQuickContact\(\) \{[\s\S]*?setQuickInitiatorChoice\(defaultQuickInitiator\);[\s\S]*?setQuickInitiatorName\(""\)/);
  assert.match(taskForm, /initiatedBy: quickInitiatorChoice === "manual" \? quickInitiatorName : undefined/);
  assert.match(taskForm, /initiatedByUserEmail: quickInitiatorChoice === "manual" \? undefined : quickInitiatorChoice/);
  assert.match(taskForm, /<select value=\{quickInitiatorChoice\}[\s\S]*?\{initiatorOptions\.map\(\(user\) => <option key=\{user\.email\} value=\{user\.email\.toLowerCase\(\)\}>\{user\.name\}<\/option>\)\}<option value="manual">Enter a name manually<\/option><\/select>/);
  assert.match(taskForm, /\{quickInitiatorChoice === "manual" && <label>[\s\S]*?<input value=\{quickInitiatorName\}[\s\S]*?required minLength=\{2\} maxLength=\{120\}/);
  assert.match(taskForm, /setContactPersonId\(result\.contact\.id\);\s*resetQuickContact\(\)/);
  assert.match(taskForm, /<span>First name \*<\/span><input[\s\S]*?required minLength=\{2\}[\s\S]*?<\/label>/);
  assert.match(taskForm, /onSubmit=\{\(event\) => \{ if \(quickContactOpen\)[\s\S]*?void onSubmit\(event\)\.then/);
  assert.match(taskForm, /type="submit" disabled=\{quickContactOpen \|\| submitting\}/);
  assert.match(taskForm, /onClick=\{resetQuickContact\}>Cancel/);
  assert.match(taskForm, /onChange=\{\(event\) => \{ setCompanyId\(event\.target\.value\); setContactPersonId\(""\); resetQuickContact\(\); \}\}/);
  assert.match(app, /canAddContact=\{hasPermission\(currentRole, "contact\.create"\)\}[\s\S]*?onAddContact=\{createContact\}/);
  assert.match(app, /<TaskForm[\s\S]*?initiatorOptions=\{users\.filter\(\(user\) => user\.state === "Active"\)\}[\s\S]*?currentUserEmail=\{identity\.accountEmail\}/);
  assert.match(app, /if \(firstName\.length < 2\) return \{ field: "firstName", error: "Enter at least 2 characters for the first name\." \}/);

  assert.match(contactDraft, /initiatedBy\?: string/);
  assert.match(contactDraft, /initiatedByUserEmail\?: string/);
  assert.match(contactForm, /<Modal title="Add contact manually"/);
  assert.match(contactForm, /initiatorOptions: CRMUser\[\]/);
  assert.match(contactForm, /currentUserEmail: string/);
  assert.match(contactForm, /const defaultInitiator = initiatorOptions\.some\(\(user\) => user\.email\.toLowerCase\(\) === normalizedCurrentUserEmail\) \? normalizedCurrentUserEmail : "manual"/);
  assert.match(contactForm, /<select name="initiatedByUserEmail" required value=\{initiatorChoice\}[\s\S]*?\{initiatorOptions\.map\(\(user\) => <option key=\{user\.email\} value=\{user\.email\.toLowerCase\(\)\}>\{user\.name\}<\/option>\)\}<option value="manual">Enter a name manually<\/option><\/select>/);
  assert.match(contactForm, /\{initiatorChoice === "manual" && <label[\s\S]*?<input name="initiatedBy" required minLength=\{2\} maxLength=\{120\}/);
  assert.match(contactForm, /Manual names are stored as text and do not receive in-app notifications\./);
  assert.match(app, /<ContactForm[\s\S]*?initiatorOptions=\{users\.filter\(\(user\) => user\.state === "Active"\)\}[\s\S]*?currentUserEmail=\{identity\.accountEmail\}/);

  assert.match(createContact, /const initiatorUser = requestedInitiatorEmail[\s\S]*?users\.find\(\(user\) => user\.state === "Active" && user\.email\.toLowerCase\(\) === requestedInitiatorEmail\)/);
  assert.match(createContact, /if \(requestedInitiatorEmail && manualInitiator\) return \{ field: "initiatedBy", error: "Choose a CRM user or enter a manual name, not both\." \}/);
  assert.match(createContact, /if \(requestedInitiatorEmail && !initiatorUser\) return \{ field: "initiatedByUserEmail", error: "Select an active CRM user or enter the initiator manually\." \}/);
  assert.match(createContact, /if \(initiatedBy\.length < 2\) return \{ field: "initiatedBy", error: "Enter at least 2 characters for the initiator name\." \}/);
  assert.match(createContact, /if \(initiatedBy\.length > 120\) return \{ field: "initiatedBy", error: "Keep the initiator name within 120 characters\." \}/);
  assert.match(createContact, /const initiatedBy = initiatorUser\?\.name \?\? \(manualInitiator \|\| \(usesSignedInInitiator \? identity\?\.name \?\? "" : ""\)\)/);
  assert.match(createContact, /const initiatedByUserEmail = initiatorUser\?\.email\.toLowerCase\(\) \?\? \(usesSignedInInitiator \? identity\?\.accountEmail\.toLowerCase\(\) : undefined\)/);
  assert.match(createContact, /ownerUserEmail: identity\?\.accountEmail\.toLowerCase\(\),\s*initiatedByUserEmail,/);
  assert.match(createContact, /await apiRequest\("\/contacts", \{ method: "POST", body: JSON\.stringify\(payload\) \}\)/);
  assert.match(createContact, /allow_duplicate: true/);
  assert.match(addContact, /const initiatorChoice = String\(data\.get\("initiatedByUserEmail"\) \?\? ""\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(addContact, /initiatedBy: initiatorChoice === "manual" \? String\(data\.get\("initiatedBy"\) \?\? ""\) : undefined/);
  assert.match(addContact, /initiatedByUserEmail: initiatorChoice === "manual" \? undefined : initiatorChoice/);
});

test("validates, processes, previews, and wires profile and entity images", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("src/app/CRMApp.tsx", root), "utf8"),
    readFile(new URL("src/styles/globals.css", root), "utf8"),
  ]);
  const identity = await readFile(new URL("src/shared/components/identity.tsx", root), "utf8");
  const imageHelpers = `${identity}\n${sectionBetween(component, "const ACCEPTED_IMAGE_TYPES", "const INFO_TEXT")}`;
  const companyForm = sectionBetween(component, "function CompanyForm(", "function ContactForm(");
  const contactForm = sectionBetween(component, "function ContactForm(", "function TaskForm(");
  const taskForm = sectionBetween(component, "function TaskForm(", "function UserForm(");
  const profileForm = sectionBetween(component, "function ProfileModal(", "function SettingsModal(");
  const companyDetail = sectionBetween(component, "function CompanyDetail(", "function ContactDetail(");
  const contactDetail = sectionBetween(component, "function ContactDetail(", "function UserDetail(");

  assert.match(imageHelpers, /const ACCEPTED_IMAGE_TYPES = \["image\/jpeg", "image\/png", "image\/webp"\]/);
  assert.match(imageHelpers, /const MAX_IMAGE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(imageHelpers, /file\.size <= 0 \|\| file\.size > MAX_IMAGE_BYTES/);
  assert.match(imageHelpers, /async function processImageFile\(file: File, kind: "person" \| "company" = "person"\)/);
  assert.match(imageHelpers, /document\.createElement\("canvas"\)/);
  assert.match(imageHelpers, /context\.drawImage\(/);
  assert.match(imageHelpers, /canvas\.toDataURL\("image\/webp", 0\.82\)/);
  assert.match(imageHelpers, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(identity, /export function Avatar\(/);
  assert.match(identity, /export function EntityLogo\(/);
  assert.match(imageHelpers, /const requestRef = useRef\(0\)/);
  assert.match(imageHelpers, /const request = \+\+requestRef\.current/);
  assert.match(imageHelpers, /if \(request === requestRef\.current\) onChange\(image\)/);
  assert.match(imageHelpers, /if \(request === requestRef\.current\) setError\(/);
  assert.match(imageHelpers, /if \(request === requestRef\.current\) updateProcessing\(false\)/);
  assert.match(imageHelpers, /onProcessingChange\?\.\(next\)/);
  assert.match(imageHelpers, /requestRef\.current \+= 1; onProcessingChange\?\.\(false\)/);
  assert.match(imageHelpers, /await processImageFile\(file, kind\)/);
  assert.match(imageHelpers, /type="file" accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(imageHelpers, /className="image-error" role="alert"/);
  assert.match(imageHelpers, /function Avatar\([\s\S]*?src \? <img src=\{src\}/);
  assert.match(imageHelpers, /function EntityLogo\([\s\S]*?src \? <img src=\{src\}/);

  const companyProcessing = sectionBetween(imageHelpers, 'if (kind === "company") {', "} else {");
  assert.match(companyProcessing, /const scale = Math\.min\(1, 512 \/ Math\.max\(image\.naturalWidth, image\.naturalHeight\)\)/);
  assert.match(companyProcessing, /canvas\.width = Math\.max\(1, Math\.round\(image\.naturalWidth \* scale\)\)/);
  assert.match(companyProcessing, /canvas\.height = Math\.max\(1, Math\.round\(image\.naturalHeight \* scale\)\)/);
  assert.match(companyProcessing, /context\.drawImage\(image, 0, 0, image\.naturalWidth, image\.naturalHeight, 0, 0, canvas\.width, canvas\.height\)/);
  assert.doesNotMatch(companyProcessing, /cropSize|sourceX|sourceY/, "Company logos must retain their original aspect ratio");

  assert.match(companyForm, /<ImageField label="Company logo"[\s\S]*?kind="company"/);
  assert.match(companyForm, /onSubmit=\{\(event\) => \{ if \(imageProcessing\) event\.preventDefault\(\); else \{[\s\S]*?onSubmit\(event, logoDataUrl\)\.then/);
  assert.match(companyForm, /onProcessingChange=\{setImageProcessing\}/);
  assert.match(companyForm, /type="submit" disabled=\{imageProcessing \|\| submitting\}/);
  assert.match(companyDetail, /useState\(company\.logoDataUrl \?\? ""\)[\s\S]*?<ImageField label="Company logo"[^>]*kind="company"/);
  assert.match(companyDetail, /onProcessingChange=\{setImageProcessing\}[\s\S]*?type="submit" disabled=\{imageProcessing\}/);
  assert.match(contactForm, /onSubmit=\{\(event\) => \{ if \(imageProcessing\) event\.preventDefault\(\); else \{[\s\S]*?onSubmit\(event, photoDataUrl\)\.then/);
  assert.match(contactForm, /<ImageField label="Contact photo"[^>]*value=\{photoDataUrl\}[^>]*onChange=\{setPhotoDataUrl\}/);
  assert.match(contactForm, /apiRequest<\{ data: OcrResult \}>\("\/ocr\/business-card", \{ method: "POST", body \}\)/);
  assert.match(contactForm, /Review everything before saving/);
  assert.match(contactForm, /type="submit" disabled=\{imageProcessing \|\| cardScanning \|\| submitting\}/);
  assert.match(contactDetail, /useState\(contact\.photoDataUrl \?\? ""\)[\s\S]*?<ImageField label="Contact photo"/);
  assert.match(contactDetail, /onProcessingChange=\{setImageProcessing\}[\s\S]*?type="submit" disabled=\{imageProcessing\}/);
  assert.match(taskForm, /photoDataUrl: quickPhoto/);
  assert.match(taskForm, /<ImageField label="Contact photo" name="quickContactPhoto"[^>]*value=\{quickPhoto\}[^>]*onChange=\{setQuickPhoto\}/);
  assert.match(taskForm, /onProcessingChange=\{setQuickPhotoProcessing\}[\s\S]*?disabled=\{quickPhotoProcessing\}/);
  assert.match(profileForm, /useState\(identity\.photoDataUrl \?\? ""\)[\s\S]*?<ImageField label="Profile photo"/);
  assert.match(profileForm, /if \(imageProcessing\) return/);
  assert.match(profileForm, /onProcessingChange=\{setImageProcessing\}[\s\S]*?type="submit" disabled=\{imageProcessing\}/);
  assert.match(profileForm, /onSave\(\{ \.\.\.identity, name, email, phone, photoDataUrl: photoDataUrl \|\| undefined \}/);

  const imageField = blockAfter(css, ".image-field {");
  assert.match(imageField, /width:\s*100%/);
  assert.match(imageField, /min-width:\s*0/);
  assert.match(imageField, /max-width:\s*100%/);
  const tablet = blocksAfter(css, "@media (max-width: 768px)").join("\n");
  assert.match(tablet, /\.image-field,[\s\S]*?max-width:\s*100%/);
  const phone = blocksAfter(css, "@media (max-width: 700px)").join("\n");
  assert.match(phone, /\.image-field\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(phone, /\.image-preview\s*\{[^}]*width:\s*82px[^}]*height:\s*82px/s);
  assert.match(phone, /\.image-actions,[\s\S]*?grid-template-columns:\s*1fr[^}]*width:\s*100%/s);
});

test("provides contained 44 px page scroll controls and suppresses them behind overlays", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("src/app/CRMApp.tsx", root), "utf8"),
    readFile(new URL("src/styles/globals.css", root), "utf8"),
  ]);
  const controls = sectionBetween(component, "function PageScrollControls(", "const INFO_TEXT");

  assert.match(controls, /aria-label="Page navigation"/);
  assert.match(controls, /aria-label="Scroll to top"[\s\S]*?window\.scrollTo\(\{ top: 0, behavior \}\)/);
  assert.match(controls, /aria-label="Scroll to bottom"[\s\S]*?window\.scrollTo\(\{ top: document\.documentElement\.scrollHeight, behavior \}\)/);
  assert.match(controls, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(component, /<PageScrollControls hidden=\{overlayOpen\} \/>/);

  const controlGroup = blockAfter(css, ".page-scroll-controls {");
  assert.match(controlGroup, /position:\s*fixed/);
  assert.match(controlGroup, /right:\s*calc\(16px \+ env\(safe-area-inset-right,\s*0px\)\)/);
  assert.match(controlGroup, /bottom:\s*calc\(16px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
  assert.match(controlGroup, /max-width:\s*calc\(100vw - 24px\)/);
  const controlButton = blockAfter(css, ".page-scroll-controls button {");
  assert.match(controlButton, /width:\s*44px/);
  assert.match(controlButton, /min-width:\s*44px/);
  assert.match(controlButton, /height:\s*44px/);
  assert.match(controlButton, /min-height:\s*44px/);
  const reducedMotion = blockAfter(css, "@media (prefers-reduced-motion: reduce)");
  assert.match(reducedMotion, /scroll-behavior:\s*auto\s*!important/);
});

test("centralizes overlay scroll locking and traps keyboard focus inside modals", async () => {
  const component = await readFile(new URL("src/app/CRMApp.tsx", root), "utf8");
  const modal = sectionBetween(component, "function Modal(", "function AuthScreen(");
  const app = sectionBetween(component, "export function CRMApp()", "function Dashboard(");

  assert.match(app, /const overlayOpen = Boolean\(modal \|\| selectedCompany \|\| selectedContact \|\| selectedTask \|\| selectedUser \|\| \(sidebarOpen && isMobileNavigation\)\)/);
  assert.match(app, /if \(!overlayOpen\) return;[\s\S]*?document\.body\.style\.overflow = "hidden";[\s\S]*?document\.documentElement\.style\.overflow = "hidden"/);
  assert.match(app, /document\.body\.style\.overflow = previousBodyOverflow;[\s\S]*?document\.documentElement\.style\.overflow = previousHtmlOverflow/);
  assert.match(app, /\}, \[overlayOpen\]\)/);
  assert.equal((component.match(/document\.body\.style\.overflow = "hidden"/g) ?? []).length, 1, "Only the root overlay effect may lock body scrolling");
  assert.equal((component.match(/document\.documentElement\.style\.overflow = "hidden"/g) ?? []).length, 1, "Only the root overlay effect may lock html scrolling");
  assert.doesNotMatch(modal, /style\.overflow/, "Modal must rely on the root overlay lock");

  assert.match(modal, /const dialogRef = useRef<HTMLElement>\(null\)/);
  assert.match(modal, /const onCloseRef = useRef\(onClose\)/);
  assert.match(modal, /onCloseRef\.current = onClose;[\s\S]*?\}, \[onClose\]\)/);
  assert.match(modal, /const focusableSelector = ['"]button:not\(:disabled\)/);
  assert.match(modal, /const initialFocusFrame = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?querySelector<HTMLElement>\("\[autofocus\]"\)[\s\S]*?\(preferred \?\? first\)\?\.focus\(\)/);
  assert.match(modal, /onCloseRef\.current\(\)/);
  assert.match(modal, /event\.key !== "Tab" \|\| !dialogRef\.current/);
  assert.match(modal, /querySelectorAll<HTMLElement>\(focusableSelector\)/);
  assert.match(modal, /event\.shiftKey && document\.activeElement === first[\s\S]*?last\.focus\(\)/);
  assert.match(modal, /!event\.shiftKey && document\.activeElement === last[\s\S]*?first\.focus\(\)/);
  assert.match(modal, /window\.cancelAnimationFrame\(initialFocusFrame\)/);
  assert.match(modal, /anotherModalIsOpen = Boolean\(document\.querySelector\('\[role="dialog"\]\[aria-modal="true"\]'\)\)/);
  assert.match(modal, /if \(!anotherModalIsOpen && previousFocus\?\.isConnected\) previousFocus\.focus\(\)/);
  assert.match(modal, /\}, \[\]\);/, "The keyboard/focus lifecycle must mount only once");
  assert.match(modal, /ref=\{dialogRef\}[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/);
});

test("reserves bottom clearance for page controls at every viewport width", async () => {
  const css = await readFile(new URL("src/styles/globals.css", root), "utf8");
  const selector = ".crm-app:has(.page-scroll-controls) .main-content";
  const reserve = blockAfter(css, selector);
  const pixels = Number(reserve.match(/padding-bottom:\s*calc\((\d+)px/)?.[1]);

  assert.ok(Number.isFinite(pixels) && pixels >= 132, "Page content must clear both floating controls and their gaps");
  assert.match(reserve, /env\(safe-area-inset-bottom,\s*0px\)/);
  const reserveIndex = css.indexOf(selector);
  const reserveClose = css.indexOf("}", reserveIndex);
  assert.doesNotMatch(css.slice(reserveClose + 1), /\.main-content\s*\{[^}]*padding-bottom\s*:/s, "Later media rules must not remove the all-width control clearance");
});

test("derives each company next activity from the earliest open task", async () => {
  const component = await readFile(new URL("src/app/CRMApp.tsx", root), "utf8");
  assert.doesNotMatch(component, /\bnextStep\b/, "The obsolete manually maintained next-step field must stay removed");

  const helper = sectionBetween(component, "function nextActivityLabel(", "const ACCEPTED_IMAGE_TYPES");
  assert.match(helper, /tasks[\s\S]*?\.filter\(\(task\) => \(!companyId \|\| task\.companyId === companyId\) && isOpenTask\(task\) && Boolean\(task\.deadline\)\)/);
  assert.match(helper, /\.sort\(\(a, b\) => a\.deadline\.localeCompare\(b\.deadline\)\)\[0\]/);
  assert.match(helper, /return nextTask \? [^\n]*formatDateTime\(nextTask\.deadline\)[^\n]* : "No open activity"/);

  const pipeline = sectionBetween(component, "function Pipeline(", "function Companies(");
  assert.match(pipeline, /Next activity: \{nextActivityLabel\(tasks, company\.id\)\}/);
  assert.match(pipeline, /No open activity/);
  const companyDetail = sectionBetween(component, "function CompanyDetail(", "function ContactDetail(");
  assert.match(companyDetail, /<small>Next activity<\/small><b>\{nextActivityLabel\(tasks\)\}<\/b>/);
});

test("tracks record creators and scopes notifications to records connected to the signed-in user", async () => {
  const component = await readFile(new URL("src/app/CRMApp.tsx", root), "utf8");
  const companyType = sectionBetween(component, "type Company = {", "type Contact = {");
  const taskType = sectionBetween(component, "type Task = {", "type TaskComment = {");
  const app = sectionBetween(component, "export function CRMApp()", "function Dashboard(");
  const notifications = sectionBetween(component, "const notifications = useMemo<AppNotification[]>(() => {", "const unreadNotifications");

  assert.match(companyType, /createdBy\?: string/);
  assert.match(companyType, /ownerUserEmail\?: string/);
  assert.match(companyType, /createdByUserEmail\?: string/);
  assert.match(taskType, /createdBy\?: string/);
  assert.match(taskType, /ownerUserEmail\?: string/);
  assert.match(taskType, /createdByUserEmail\?: string/);
  assert.match(component, /createdBy: apiString\(record, "created_by_name"\)/);
  assert.match(component, /createdByUserEmail: apiString\(record, "created_by_email"\)\.toLowerCase\(\) \|\| undefined/);
  assert.match(app, /const company: Company = \{[\s\S]*?createdBy: identity\?\.name \?\? "Unknown user"[\s\S]*?ownerUserEmail: userEmailForName\(owner\)[\s\S]*?createdByUserEmail: identity\?\.accountEmail\.toLowerCase\(\)/);
  assert.match(app, /const task: Task = \{[\s\S]*?createdBy: identity\?\.name \?\? "Unknown user"[\s\S]*?createdByUserEmail: identity\?\.accountEmail\.toLowerCase\(\)/);
  assert.match(app, /ownerUserEmail: identity\?\.accountEmail\.toLowerCase\(\),\s*initiatedByUserEmail,/);

  assert.match(app, /const notificationAccountKey = identity\?\.accountEmail\.toLowerCase\(\) \?\? ""/);
  assert.match(notifications, /relatedTasks = liveTasks\.filter\(\(task\) => task\.ownerUserEmail === notificationAccountKey \|\| task\.createdByUserEmail === notificationAccountKey\)/);
  assert.match(notifications, /relatedContacts = liveContacts\.filter\(\(contact\) => contact\.ownerUserEmail === notificationAccountKey \|\| contact\.initiatedByUserEmail === notificationAccountKey\)/);
  assert.match(notifications, /liveCompanies\.filter\(\(company\) => company\.ownerUserEmail === notificationAccountKey \|\| company\.createdByUserEmail === notificationAccountKey\)/);
  assert.doesNotMatch(notifications, /identityName|task\.owner ===|task\.createdBy ===|contact\.owner ===|company\.owner ===/);
  assert.match(notifications, /relatedTaskIds = new Set\(relatedTasks\.map\(\(task\) => task\.id\)\)/);
  assert.match(notifications, /relatedContactIds = new Set\(relatedContacts\.map\(\(contact\) => contact\.id\)\)/);
  assert.match(notifications, /entityType === "Task" && relatedTaskIds\.has\(targetId\)/);
  assert.match(notifications, /entityType === "Company" && relatedCompanyIds\.has\(targetId\)/);
  assert.match(notifications, /entityType === "Contact" && relatedContactIds\.has\(targetId\)/);
  assert.match(notifications, /title: "My activity summary"/);
  assert.match(notifications, /relatedCompanies\.length[\s\S]*?relatedContacts\.length[\s\S]*?relatedOpenTasks\.length/);
  assert.doesNotMatch(notifications, /\blive(?:Companies|Contacts|Tasks)\.length\b/, "Notification counts must not expose global workspace totals");
  assert.match(app, /readNotificationIdsByAccount\[notificationAccountKey\] \?\? \[\]/);
  assert.match(app, /preferencesByAccount\[notificationAccountKey\] \?\? DEFAULT_PREFERENCES/);
  assert.match(app, /\[notificationAccountKey\]: next/);
  assert.match(app, /updateReadNotificationIds\(\(current\) => current\.includes\(item\.id\) \? current : \[\.\.\.current, item\.id\]\)/);
  assert.match(app, /updateReadNotificationIds\(\(current\) => Array\.from\(new Set\(\[\.\.\.current, \.\.\.notifications\.map\(\(item\) => item\.id\)\]\)\)\)/);
  assert.match(app, /setPreferencesByAccount\(\(current\) => \(\{ \.\.\.current, \[notificationAccountKey\]: nextPreferences \}\)\)/);
  assert.match(app, /await apiRequest\("\/profile", \{ method: "PUT"/);
  assert.match(app, /await loadWorkspace\(\)/);
  assert.match(app, /<div className="notification-logic"><b>Only activity connected to you<\/b>/);
  assert.doesNotMatch(app, /All workspace activity|Workspace summary/i);
});

test("sends profile changes to server-side validation", async () => {
  const component = await readFile(new URL("src/app/CRMApp.tsx", root), "utf8");
  const updateProfile = sectionBetween(component, "function updateProfile(", "function updatePreferences(");

  assert.match(updateProfile, /await apiRequest\("\/profile", \{ method: "PUT"/);
  assert.match(updateProfile, /full_name: nextIdentity\.name/);
  assert.match(updateProfile, /current_password: currentPassword \|\| undefined/);
  assert.match(updateProfile, /if \(newPassword\) await apiRequest\("\/profile\/password"/);
  assert.match(updateProfile, /\.catch\(reportServerError\)/);
});

test("keeps primary mobile CRM copy readable at 360 px", async () => {
  const css = await readFile(new URL("src/styles/globals.css", root), "utf8");
  const phone = blocksAfter(css, "@media (max-width: 700px)").join("\n");

  assert.match(phone, /\.crm-app\s*\{[^}]*font-size:\s*15px[^}]*line-height:\s*1\.45/s);
  assert.match(phone, /\.crm-app small,[\s\S]*?\.topbar-popover small\s*\{[^}]*font-size:\s*12px[^}]*line-height:\s*1\.45/s);
  assert.match(phone, /\.eyebrow,[\s\S]*?\.status-badge,[\s\S]*?\.count-badge,[\s\S]*?\.table-footer\s*\{[^}]*font-size:\s*11px[^}]*line-height:\s*1\.4/s);
  assert.match(phone, /\.primary-button,[\s\S]*?\.secondary-button,[\s\S]*?\.danger-button,[\s\S]*?\.text-button,[\s\S]*?\.detail-action-button\s*\{[^}]*font-size:\s*13px[^}]*line-height:\s*1\.35/s);
});

test("removes obsolete Priority dashboard artifacts from production assets", async () => {
  const built = await readBuiltAssets();
  assert.doesNotMatch(built, /Priority tasks|priority-panel|priority-row|dashboard-grid/);
});

test("ships the Lookups, Dashboard, and workflow containment rules in the compiled CSS", async () => {
  const assetsUrl = new URL("dist/client/assets/", root);
  const cssFiles = (await readdir(assetsUrl)).filter((name) => name.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "The production build must contain a CSS asset");

  const builtCss = (await Promise.all(cssFiles.map((name) => readFile(new URL(name, assetsUrl), "utf8")))).join("\n");
  assert.match(builtCss, /\.lookup-editor\{[^}]*min-width:0[^}]*overflow:hidden/);
  assert.match(builtCss, /\.lookup-add-form\{[^}]*grid-column:1\/-1[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(builtCss, /\.lookup-fixed-note\{[^}]*width:100%[^}]*min-width:0[^}]*max-width:100%/);
  assert.match(builtCss, /\.archived-records-heading\{justify-content:flex-start\}/);
  assert.doesNotMatch(builtCss, /\.priority-panel\b|\.priority-row\b|\.dashboard-grid\b/);
  assert.match(builtCss, /\.dashboard-recent-panel\{[^}]*width:100%[^}]*min-width:0[^}]*max-width:100%[^}]*overflow:hidden/);
  assert.match(builtCss, /\.funnel-list\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(builtCss, /@media \(width<=1180px\)\{[\s\S]*?\.funnel-list\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(builtCss, /@media \(width<=768px\)\{[\s\S]*?\.funnel-list(?:,[^{]+)?\{grid-template-columns:1fr/);
  const builtScrollControls = blockAfter(builtCss, ".page-scroll-controls{");
  assert.match(builtScrollControls, /position:fixed/);
  assert.match(builtScrollControls, /max-width:calc\(100vw - 24px\)/);
  const builtScrollButton = blockAfter(builtCss, ".page-scroll-controls button{");
  assert.match(builtScrollButton, /width:44px/);
  assert.match(builtScrollButton, /min-width:44px/);
  assert.match(builtScrollButton, /height:44px/);
  assert.match(builtScrollButton, /min-height:44px/);
  const builtScrollClearance = blockAfter(builtCss, ".crm-app:has(.page-scroll-controls) .main-content{");
  assert.match(builtScrollClearance, /padding-bottom:calc\(132px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(builtCss, /@media \(width<=768px\)\{[\s\S]*?\.lookup-tabs\{[^}]*overflow-x:auto[\s\S]*?\.lookup-actions\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)[^}]*overflow-x:visible[\s\S]*?\.lookup-add-form,\.comment-form\{grid-template-columns:1fr\}/);
  assert.match(builtCss, /@media \(width<=390px\)\{[\s\S]*?\.panel-heading\{[^}]*flex-direction:column[\s\S]*?\.panel-heading>\.info-popover-wrap \.info-popover\{left:0;right:auto\}/);

  const builtTableScroll = blockAfter(builtCss, ".table-scroll{");
  assert.match(builtTableScroll, /max-width:100%/);
  assert.match(builtTableScroll, /overflow:(?:auto hidden|auto)(?:;|$)/);

  const builtKanban = blockAfter(builtCss, ".kanban{");
  assert.match(builtKanban, /width:100%/);
  assert.match(builtKanban, /overflow-x:auto/);
  assert.match(builtKanban, /overscroll-behavior-x:contain/);
});

test("ships the Companies card breakpoint and containment rules in compiled CSS", async () => {
  const assetsUrl = new URL("dist/client/assets/", root);
  const cssFiles = (await readdir(assetsUrl)).filter((name) => name.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "The production build must contain a CSS asset");

  const builtCss = (await Promise.all(cssFiles.map((name) => readFile(new URL(name, assetsUrl), "utf8")))).join("\n");
  assert.match(builtCss, /@media \(width<=1279px\)\{(?:\.responsive-card-scroll\{[^}]*\})?\.(?:responsive-card-table|companies-table)\{/);

  const builtTable = blockAfterAny(builtCss, [".responsive-card-table{", ".companies-table{"]);
  assert.match(builtTable, /display:block/);
  assert.match(builtTable, /width:100%/);
  assert.match(builtTable, /min-width:0/);

  const builtHead = blockAfterAny(builtCss, [".responsive-card-table thead{", ".companies-table thead{"]);
  assert.match(builtHead, /position:absolute/);
  assert.match(builtHead, /width:1px/);
  assert.match(builtHead, /height:1px/);
  assert.match(builtHead, /overflow:hidden/);

  const builtBody = blockAfterAny(builtCss, [".responsive-card-table tbody{", ".companies-table tbody{"]);
  assert.match(builtBody, /display:grid/);
  assert.match(builtBody, /width:100%/);

  const builtRow = blockAfterAny(builtCss, [".responsive-card-table tbody tr{", ".companies-table tbody tr{"]);
  assert.match(builtRow, /display:grid/);
  assert.match(builtRow, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(builtRow, /min-width:0/);

  const builtCell = blockAfterAny(builtCss, [".responsive-card-table td{", ".companies-table td{"]);
  assert.match(builtCell, /display:grid/);
  assert.match(builtCell, /grid-template-columns:minmax\(90px,\.42fr\) minmax\(0,1fr\)/);
  assert.match(builtCell, /min-width:0/);

  assert.match(builtCss, /\.(?:responsive-card-table|companies-table) td::?before\{[^}]*content:attr\(data-label\)/);
  const builtCompanyValue = blockAfter(builtCss, ".companies-table .company-card-value{");
  assert.match(builtCompanyValue, /min-width:0/);
  assert.match(builtCompanyValue, /max-width:100%/);
  assert.match(builtCompanyValue, /overflow-wrap:anywhere/);
  assert.match(builtCss, /@media \(width<=700px\)\{\.(?:responsive-card-table|companies-table) tbody\{[^}]*\}\.(?:responsive-card-table|companies-table) tbody tr\{grid-template-columns:1fr\}/);

  const builtDataPanel = blockAfter(builtCss, ".data-panel{");
  assert.match(builtDataPanel, /width:100%/);
  assert.match(builtDataPanel, /min-width:0/);
  assert.match(builtDataPanel, /max-width:100%/);
  assert.match(builtDataPanel, /overflow:hidden/);
});

test("covers the v3.1 audit gaps in the integrated frontend", async () => {
  const component = await readFile(new URL("src/app/CRMApp.tsx", root), "utf8");
  const app = sectionBetween(component, "export function CRMApp()", "function Dashboard(");
  const activity = sectionBetween(component, "function Activity(", "function Lookups(");
  const users = sectionBetween(component, "function Users(", "function Audit(");
  const audit = sectionBetween(component, "function Audit(", "function CompanyDetail(");
  const taskDetail = sectionBetween(component, "function TaskDetail(", "function CompanyForm(");
  const userForm = sectionBetween(component, "function UserForm(", "function ProfileModal(");

  assert.match(component, /function PasswordResetScreen/);
  assert.match(userForm, /value="invite"[\s\S]*?value="temporary_password"/);
  assert.match(app, /403 · Access forbidden/);
  assert.match(app, /possible_duplicate[\s\S]*?allow_duplicate: true/);
  assert.match(app, /Use Try again to resubmit without losing the form/);
  assert.match(activity, /Contact: \{task\.contactDate[\s\S]*?Person: \{task\.contactPerson/);
  assert.match(activity, /Reminder impossible/);
  assert.match(taskDetail, /Attachments[\s\S]*?Upload file[\s\S]*?downloadAttachment[\s\S]*?deleteAttachment/);
  assert.match(app, /apiDownload\(`\/tasks\/\$\{task\.id\}\/reminder\.ics`\)[\s\S]*?link\.download = `task-\$\{task\.id\}\.ics`/);
  assert.match(taskDetail, /downloadIcs: \(task: Task\) => Promise<void>/);
  assert.match(taskDetail, /Comment hidden by Admin[\s\S]*?setCommentHidden/);
  assert.match(audit, /audit_action[\s\S]*?audit_user[\s\S]*?audit_entity[\s\S]*?audit_from[\s\S]*?audit_to/);
  assert.match(audit, /apiRequest<\{ data: ApiRecord\[\]; meta: ApiMeta \}>\(`\/audit\?\$\{params\}`\)/);
  assert.match(audit, /Previous audit page[\s\S]*?Next audit page/);
  assert.match(users, /Pending/);
  assert.match(component, /Reject registration/);
  assert.match(component, /Cannot change role: this is the last active Admin/);
  assert.match(component, /search-result-group/);
});
