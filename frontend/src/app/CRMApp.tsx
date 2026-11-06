"use client";

import { type Dispatch, FormEvent, ReactNode, type SetStateAction, Suspense, type RefObject, lazy, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ApiError, apiDownload, apiMessage, apiRequest, loadAllPages, setCsrfToken } from "../shared/api/api-client";
import { Avatar, EntityLogo } from "../shared/components/identity";
import { appendVoiceText } from "../shared/utils/voice-text";
import { useCookieDraft } from "../shared/hooks/use-cookie-draft";
import { DraftScopeContext, useFormDraft } from "../shared/hooks/use-form-draft";
import { useUrlStringState } from "../shared/hooks/use-url-string-state";
import { DEFAULT_TIME_ZONE, formatDateTime, formatUserDateTime, formatUserDateTimeInput, getBrowserTimeZone, isLocalDateTimePast, localDateTimeToUtc, timeZoneCityLabel, todayUser, userGreeting, userWeekQuarter } from "../shared/utils/dates";
import { clearAccountDrafts, clearFormDraft, clearOtherAccountDrafts, draftScopeForAccount, readFormDraft, writeFormDraft } from "../shared/utils/form-draft";
import { clearAllSecureVoiceDrafts, clearAllVoiceDrafts, clearOtherSecureVoiceDrafts } from "../shared/utils/voice-draft";
import { loadReadNotificationIds, saveReadNotificationIds, updateReadNotificationAccount } from "../shared/utils/notification-storage";
import { readUrlFilter, urlWithFilter } from "../shared/utils/url-filters.mjs";

const LazyVoiceInputButton = lazy(() => import("../shared/components/voice-input").then(({ VoiceInputButton }) => ({ default: VoiceInputButton })));

function VoiceInputButton(props: { onText: (text: string) => void; disabled?: boolean }) {
  return <Suspense fallback={null}><LazyVoiceInputButton {...props} /></Suspense>;
}

const focusHistory: HTMLElement[] = [];

type View =
  | "dashboard"
  | "companies"
  | "contacts"
  | "activity"
  | "lookups"
  | "users"
  | "audit";

const ALL_VIEWS: readonly View[] = ["dashboard", "companies", "contacts", "activity", "lookups", "users", "audit"];
const CONTACT_LINKEDIN_VALUES = ["Any LinkedIn", "Has LinkedIn", "No LinkedIn"] as const;

type Company = {
  id: string;
  name: string;
  kind: string;
  country: string;
  city: string;
  status: string;
  contacts: number;
  lastContact: string;
  owner: string;
  createdBy?: string;
  ownerUserEmail?: string;
  createdByUserEmail?: string;
  website: string;
  linkedin?: string;
  ndaStatus?: NdaStatus;
  logoDataUrl?: string;
  description: string;
  typeId?: number;
  statusId?: number;
  managerId?: number;
  updatedAt?: string;
  isArchived?: boolean;
};

type Contact = {
  id: string;
  companyId: string;
  name: string;
  position: string;
  email: string;
  phone: string;
  contactStatus?: "active" | "inactive";
  linkedin?: string;
  source: string;
  sourceDetail?: string;
  referredBy?: string;
  owner: string;
  initiatedBy?: string;
  ownerUserEmail?: string;
  initiatedByUserEmail?: string;
  photoDataUrl?: string;
  businessCardDataUrl?: string;
  businessCardFileName?: string;
  businessCardBackDataUrl?: string;
  businessCardBackFileName?: string;
  firstName?: string;
  lastName?: string;
  sourceId?: number;
  initiatedById?: number;
  managerId?: number;
  updatedAt?: string;
  isArchived?: boolean;
};

type Task = {
  id: string;
  companyId: string;
  parentTaskId?: string;
  title: string;
  contactDate?: string;
  deadline: string;
  owner: string;
  createdBy?: string;
  ownerUserEmail?: string;
  createdByUserEmail?: string;
  contactPersonId?: string;
  status: string;
  statusKey?: string;
  completedAt?: string;
  isClosed?: boolean;
  priority: "High" | "Medium" | "Low";
  note: string;
  outcomeStatus?: string;
  outcomeNotes?: string;
  reminderLeads?: string[];
  reminderLeadIds?: number[];
  managerId?: number;
  statusId?: number;
  outcomeStatusId?: number;
  updatedAt?: string;
  isArchived?: boolean;
  contactPerson?: string;
  reminderPossible?: boolean;
  commentCount?: number;
  changeCount?: number;
  participantContactIds?: string[];
  participantManagers?: string[];
};

const NDA_STATUSES = ["Not Signed", "Company-wide", "Project-specific", "Expired"] as const;
type NdaStatus = typeof NDA_STATUSES[number];

const TASK_PRIORITIES: Task["priority"][] = ["Low", "Medium", "High"];

type TaskComment = {
  id: string;
  taskId: string;
  author: string;
  createdAt: string;
  updatedAt?: string;
  text: string;
  authorUserId?: number;
  isHidden?: boolean;
};

type TaskAttachment = {
  id: number;
  taskId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  authorUserId: number;
  author: string;
  createdAt: string;
};

type SystemSettings = {
  systemNotificationEmail: string;
  notifyNewRegistrations: boolean;
  registrationAllowedDomains: string[];
};

type AuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
  actorUserId?: number;
  entityType?: string;
};

type Role = "Admin" | "Manager" | "Editor" | "Read-only";

type Permission =
  | "company.create"
  | "company.edit"
  | "pipeline.move"
  | "contact.create"
  | "contact.edit"
  | "task.create"
  | "task.edit"
  | "task.comment"
  | "record.archive"
  | "lookup.manage"
  | "user.manage"
  | "audit.view"
  | "audit.export";

type CRMUser = {
  id?: number;
  name: string;
  email: string;
  role: Role;
  state: "Active" | "Inactive" | "Pending";
  lastLogin: string;
  photoDataUrl?: string;
  updatedAt?: string;
};

type AuthIdentity = {
  id?: number;
  name: string;
  email: string;
  accountEmail: string;
  method: "Email";
  role: Role;
  phone?: string;
  photoDataUrl?: string;
};

type LookupItem = { id: string; value: string; active: boolean; keyCode?: string; updatedAt?: string; userId?: number; email?: string };
type LookupGroup = { type: string; label: string; items: LookupItem[] };

type AppNotification = {
  id: string;
  kind: "overdue" | "update" | "audit";
  title: string;
  detail: string;
  target: "task" | "company" | "contact" | "activity" | "audit";
  targetId?: string;
};

type Preferences = {
  deadlineReminders: boolean;
  overdueNotifications: boolean;
  workspaceSummary: boolean;
};

type ContactDraft = {
  companyId: string;
  firstName: string;
  lastName?: string;
  position?: string;
  email?: string;
  phone?: string;
  contactStatus?: "active" | "inactive";
  linkedin?: string;
  source?: string;
  sourceDetail?: string;
  referredBy?: string;
  initiatedBy?: string;
  initiatedByUserEmail?: string;
  photoDataUrl?: string;
  businessCardDataUrl?: string;
  businessCardFileName?: string;
  businessCardBackDataUrl?: string;
  businessCardBackFileName?: string;
};

type ContactCreationResult = {
  contact?: Contact;
  field?: keyof ContactDraft;
  error?: string;
};

type ToastState = { message: string; tone: "success" | "warning" };
type GlobalSearchResult = { type: "Company" | "Contact" | "Task"; label: string; meta: string; id: string };
const GLOBAL_SEARCH_PAGE_SIZE = 10;
type OcrDraft = { first_name?: string; last_name?: string; position?: string; phone?: string; email?: string; linkedin?: string; website?: string; company?: string; address?: string };
type OcrLineType = "name" | "position" | "company" | "email" | "phone" | "website" | "linkedin" | "address" | "location" | "offices" | "registry" | "other";
type OcrResult = { raw_text: string; draft: OcrDraft; confidence: "low" | "medium" | "high"; lines?: { text: string; type: OcrLineType }[]; company_candidates?: string[]; company_domain?: string | null };

const OCR_LINE_LABELS: Record<OcrLineType, string> = { name: "Name", position: "Position", company: "Company", email: "Email", phone: "Phone", website: "Website", linkedin: "LinkedIn", address: "Address", location: "Location", offices: "Offices", registry: "Reg. no.", other: "Other" };
const OCR_FILLED_LINE_TYPES = new Set<OcrLineType>(["name", "position", "company", "email", "phone", "linkedin"]);
const OCR_CARD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff"];
type CardSide = { dataUrl: string; name: string; result: OcrResult | null };
const CARD_IMAGES_MAX_CHARS = 28 * 1024 * 1024;

// One reading of a two-sided card: the front wins, the back fills what the front lacks.
function mergeOcrResults(results: (OcrResult | null | undefined)[]): OcrResult | null {
  const present = results.filter((result): result is OcrResult => Boolean(result));
  if (present.length <= 1) return present[0] ?? null;
  const draft: OcrDraft = {};
  for (const result of [...present].reverse()) Object.assign(draft, Object.fromEntries(Object.entries(result.draft).filter(([, value]) => value)));
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return {
    raw_text: present.map((result) => result.raw_text).join("\n"),
    draft,
    confidence: present.reduce((best, result) => rank[result.confidence] > rank[best] ? result.confidence : best, present[0].confidence),
    lines: present.flatMap((result) => result.lines ?? result.raw_text.split("\n").map((text) => ({ text, type: "other" as const }))),
    company_candidates: [...new Set(present.flatMap((result) => result.company_candidates ?? []))],
    company_domain: present.find((result) => result.company_domain)?.company_domain ?? null,
  };
}

const DEFAULT_PREFERENCES: Preferences = { deadlineReminders: true, overdueNotifications: true, workspaceSummary: true };
const OCR_INPUT_ENABLED = true;
const CLIENT_TIME_ZONE = getBrowserTimeZone();
const CLIENT_TIME_ZONE_IS_DEFAULT = CLIENT_TIME_ZONE === DEFAULT_TIME_ZONE;
const CLIENT_TIME_ZONE_LABEL = timeZoneCityLabel(CLIENT_TIME_ZONE);

const ROLE_ORDER: Role[] = ["Admin", "Manager", "Editor", "Read-only"];

const ROLE_DETAILS: Record<Role, { summary: string; permissions: string[] }> = {
  Admin: {
    summary: "Full access, including administration",
    permissions: ["All CRM records", "Archive records", "Lookups, users, and Audit Log"],
  },
  Manager: {
    summary: "View and edit every CRM record",
    permissions: ["Companies and contacts", "Relationship board and tasks", "Task comments"],
  },
  Editor: {
    summary: "View and edit every CRM record",
    permissions: ["Same access as Manager", "Relationship board and tasks", "Task comments"],
  },
  "Read-only": {
    summary: "View workspace data without changes",
    permissions: ["Dashboard and relationship board", "Companies and contacts", "Tasks"],
  },
};

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  Admin: ["company.create", "company.edit", "pipeline.move", "contact.create", "contact.edit", "task.create", "task.edit", "task.comment", "record.archive", "lookup.manage", "user.manage", "audit.view", "audit.export"],
  Manager: ["company.create", "company.edit", "pipeline.move", "contact.create", "contact.edit", "task.create", "task.edit", "task.comment"],
  Editor: ["company.create", "company.edit", "pipeline.move", "contact.create", "contact.edit", "task.create", "task.edit", "task.comment"],
  "Read-only": [],
};

const RELATIONSHIP_STATUSES = [
  "New Lead",
  "Quotation Sent",
  "Active Client",
  "On Hold",
  "Lost / Declined",
  "Black List",
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function hasPermission(role: Role, permission: Permission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}
function setFieldError(form: HTMLFormElement, fieldName: string, message: string) {
  const field = form.elements.namedItem(fieldName);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return false;
  field.setCustomValidity(message);
  field.reportValidity();
  const clear = () => field.setCustomValidity("");
  field.addEventListener("input", clear, { once: true });
  field.addEventListener("change", clear, { once: true });
  return false;
}

function isStrongPassword(value: string) {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

type ApiRecord = Record<string, unknown>;
type WorkspacePayload = {
  identity: ApiRecord;
  current_manager?: ApiRecord | null;
  csrf_token: string;
  companies: ApiRecord[];
  contacts: ApiRecord[];
  tasks: ApiRecord[];
  comments: ApiRecord[];
  attachments: ApiRecord[];
  lookups: Record<string, ApiRecord[]>;
  users: ApiRecord[];
  audit: ApiRecord[];
  countries?: string[];
};


type ApiMeta = {
  page: number;
  per_page: number;
  total: number;
  pages: number;
};

type DashboardSummary = {
  kpi: { companies: number; contacts: number; companies_with_contacts: number; tasks_total: number; completed_tasks: number; open_tasks: number; overdue: number };
  funnel: Array<{ status: string; count: number }>;
  manager_activity: Array<{ manager: string; task_count: number; open_count: number }>;
};

const apiString = (record: ApiRecord, key: string) => String(record[key] ?? "");
const apiNumber = (record: ApiRecord, key: string) => record[key] == null ? undefined : Number(record[key]);
const apiBoolean = (record: ApiRecord, key: string) => Boolean(record[key]);
const roleFromApi = (value: unknown): Role => ({ admin: "Admin", manager: "Manager", editor: "Editor", readonly: "Read-only" }[String(value)] as Role | undefined) ?? "Read-only";
const roleToApi = (value: Role) => ({ Admin: "admin", Manager: "manager", Editor: "editor", "Read-only": "readonly" }[value]);
const lookupTypeToUi = (value: string) => ({
  company_type: "company-type", client_status: "client-status", task_status: "task-status",
  outcome_status: "outcome-status", contact_source: "contact-source",
  reminder_lead_time: "reminder-lead", cjn_manager: "cjn-manager",
}[value] ?? value.replaceAll("_", "-"));
const lookupTypeToApi = (value: string) => ({
  "company-type": "company_type", "client-status": "client_status", "task-status": "task_status",
  "outcome-status": "outcome_status", "contact-source": "contact_source",
  "reminder-lead": "reminder_lead_time", "cjn-manager": "cjn_manager",
}[value] ?? value.replaceAll("-", "_"));

function mapCompany(record: ApiRecord): Company {
  return {
    id: apiString(record, "id"), name: apiString(record, "name"), kind: apiString(record, "type"),
    country: apiString(record, "country"), city: apiString(record, "city"), status: apiString(record, "status"),
    contacts: 0, lastContact: apiString(record, "last_contact_date") || "—", owner: apiString(record, "manager") || "Unassigned",
    createdBy: apiString(record, "created_by_name"), ownerUserEmail: apiString(record, "manager_email").toLowerCase() || undefined,
    createdByUserEmail: apiString(record, "created_by_email").toLowerCase() || undefined,
    website: apiString(record, "website"), linkedin: apiString(record, "linkedin") || undefined,
    ndaStatus: (NDA_STATUSES.includes(apiString(record, "nda_status") as NdaStatus) ? apiString(record, "nda_status") : "Not Signed") as NdaStatus,
    logoDataUrl: apiString(record, "logo_data_url") || undefined, description: apiString(record, "description"),
    typeId: apiNumber(record, "type_id"), statusId: apiNumber(record, "status_id"), managerId: apiNumber(record, "manager_id"),
    updatedAt: apiString(record, "updated_at"), isArchived: apiBoolean(record, "is_archived"),
  };
}

function mapContact(record: ApiRecord): Contact {
  const firstName = apiString(record, "first_name");
  const lastName = apiString(record, "last_name");
  return {
    id: apiString(record, "id"), companyId: apiString(record, "company_id"), name: [firstName, lastName].filter(Boolean).join(" "),
    firstName, lastName, position: apiString(record, "position"), email: apiString(record, "email"), phone: apiString(record, "phone"),
    linkedin: apiString(record, "linkedin") || undefined, source: apiString(record, "source"), sourceDetail: apiString(record, "source_detail"),
    referredBy: apiString(record, "referred_by"), owner: apiString(record, "manager") || "Unassigned", initiatedBy: apiString(record, "initiated_by"),
    contactStatus: apiString(record, "status") === "inactive" ? "inactive" : "active",
    ownerUserEmail: apiString(record, "manager_email").toLowerCase() || undefined, photoDataUrl: apiString(record, "photo_data_url") || undefined,
    sourceId: apiNumber(record, "source_id"), initiatedById: apiNumber(record, "initiated_by_id"), managerId: apiNumber(record, "manager_id"),
    updatedAt: apiString(record, "updated_at"), isArchived: apiBoolean(record, "is_archived"),
  };
}

function mapTask(record: ApiRecord): Task {
  const rawLeads = Array.isArray(record.reminder_leads) ? record.reminder_leads as ApiRecord[] : [];
  return {
    id: apiString(record, "id"), companyId: apiString(record, "company_id"), title: apiString(record, "name"),
    parentTaskId: apiString(record, "parent_task_id") || undefined,
    contactDate: apiString(record, "contact_date"), deadline: formatUserDateTimeInput(apiString(record, "deadline")), owner: apiString(record, "manager"),
    createdBy: apiString(record, "created_by_name"), ownerUserEmail: apiString(record, "manager_email").toLowerCase() || undefined,
    createdByUserEmail: apiString(record, "created_by_email").toLowerCase() || undefined,
    contactPersonId: apiString(record, "contact_person_id") || undefined, status: apiString(record, "status"),
    statusKey: apiString(record, "status_key") || undefined, completedAt: apiString(record, "completed_at") || undefined,
    isClosed: record.is_closed == null ? undefined : apiBoolean(record, "is_closed"),
    priority: (apiString(record, "priority") || "Low") as Task["priority"], note: apiString(record, "description"),
    outcomeStatus: apiString(record, "outcome_status"), outcomeNotes: apiString(record, "outcome_notes"),
    reminderLeads: rawLeads.map((lead) => apiString(lead, "value")), reminderLeadIds: rawLeads.map((lead) => Number(lead.id)),
    managerId: apiNumber(record, "manager_id"), statusId: apiNumber(record, "status_id"), outcomeStatusId: apiNumber(record, "outcome_status_id"),
    updatedAt: apiString(record, "updated_at"), isArchived: apiBoolean(record, "is_archived"),
    contactPerson: apiString(record, "contact_person") || undefined,
    reminderPossible: record.reminder_possible == null ? undefined : apiBoolean(record, "reminder_possible"),
    commentCount: apiNumber(record, "comment_count"), changeCount: apiNumber(record, "change_count"),
    participantContactIds: Array.isArray(record.participant_contact_ids) ? (record.participant_contact_ids as unknown[]).map(String) : undefined,
    participantManagers: Array.isArray(record.participant_managers) ? (record.participant_managers as unknown[]).map(String) : undefined,
  };
}

function mapUser(record: ApiRecord): CRMUser {
  return {
    id: apiNumber(record, "id"), name: apiString(record, "full_name"), email: apiString(record, "email"), role: roleFromApi(record.role),
    state: apiBoolean(record, "pending_approval") ? "Pending" : apiBoolean(record, "is_active") ? "Active" : "Inactive",
    lastLogin: formatUserDateTime(apiString(record, "last_login_at")) || (apiBoolean(record, "pending_approval") ? "Awaiting approval" : "Not signed in yet"),
    photoDataUrl: apiString(record, "photo_data_url") || undefined, updatedAt: apiString(record, "updated_at"),
  };
}

function mapIdentity(record: ApiRecord): AuthIdentity {
  const email = apiString(record, "email").toLowerCase();
  return { id: apiNumber(record, "id"), name: apiString(record, "full_name"), email, accountEmail: email, method: "Email", role: roleFromApi(record.role), phone: apiString(record, "phone") || undefined, photoDataUrl: apiString(record, "photo_data_url") || undefined };
}

function mapAuditEvent(event: ApiRecord): AuditEvent {
  const from = apiString(event, "from");
  const to = apiString(event, "to");
  const field = apiString(event, "field");
  return {
    id: `E-${apiString(event, "id")}`,
    at: formatUserDateTime(apiString(event, "timestamp")),
    actor: apiString(event, "actor"),
    actorUserId: apiNumber(event, "actor_user_id"),
    action: apiString(event, "action"),
    entityType: apiString(event, "entity_type"),
    entity: `${apiString(event, "entity_type")} · ${apiString(event, "entity_id")}`,
    detail: field ? `${field}: ${from || "—"} → ${to || "—"}` : apiString(event, "entity_label"),
  };
}

const VIEW_META: Record<View, { label: string; eyebrow: string; icon: string }> = {
  dashboard: { label: "Dashboard", eyebrow: "Team overview", icon: "⌂" },
  companies: { label: "Companies", eyebrow: "Client database", icon: "▦" },
  contacts: { label: "Contacts", eyebrow: "Contact directory", icon: "◎" },
  activity: { label: "Activity", eyebrow: "Tasks & deadlines", icon: "✓" },
  lookups: { label: "Lookups", eyebrow: "Administration", icon: "≡" },
  users: { label: "Users & Roles", eyebrow: "Administration", icon: "♙" },
  audit: { label: "Audit Log", eyebrow: "Change history", icon: "↻" },
};

function companyName(companies: Company[], id: string) {
  return companies.find((company) => company.id === id)?.name ?? "Unknown company";
}

// Exact name first, then ignoring accents and punctuation: "Cote" finds "Côte" and vice versa.
function companyByName(companies: Company[], value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  const exact = companies.find((company) => company.name.trim().toLocaleLowerCase() === normalized);
  if (exact) return exact;
  const fold = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
  const folded = fold(value);
  return folded ? companies.find((company) => fold(company.name) === folded) : undefined;
}

const COMPANY_LEGAL_FORM_WORDS = new Set(["llc", "ltd", "limited", "inc", "corp", "gmbh", "ag", "plc", "kft", "srl", "bv", "nv", "тзов", "тов", "прат", "пат", "ооо", "оао", "зао", "пао", "фоп"]);

// Company name words without legal forms: "CONOSHIP INTERNATIONAL POLAND SP.Z O.O." → conoship international poland.
function companyMatchWords(value: string) {
  const joined = ` ${companySearchWords(value).join(" ")} `.replace(/ (?:sp z o o|s a|b v|n v|s r o|d o o)(?= )/gu, " ");
  return joined.split(" ").filter((word) => word && !COMPANY_LEGAL_FORM_WORDS.has(word));
}

function websiteHost(value: string) {
  return value.trim().toLocaleLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
}

// Matches a scanned card to an existing CRM company by email/website domain, then by name words.
function matchOcrCompany(companies: Company[], result: OcrResult) {
  const domain = result.company_domain ? websiteHost(result.company_domain) : "";
  if (domain) {
    const byDomain = companies.find((company) => {
      const host = websiteHost(company.website ?? "");
      return host !== "" && (host === domain || domain.endsWith(`.${host}`));
    });
    if (byDomain) return byDomain;
  }
  const candidates = result.company_candidates ?? (result.draft.company ? [result.draft.company] : []);
  const indexed = companies.map((company) => ({ company, words: companyMatchWords(company.name) })).filter(({ words }) => words.join("").length >= 3);
  for (const candidate of candidates) {
    const words = companyMatchWords(candidate);
    if (words.length === 0) continue;
    const key = words.join(" ");
    const exact = indexed.find((item) => item.words.join(" ") === key);
    if (exact) return exact.company;
    // Every word of the CRM name appears on the card: "Conoship" ⊂ "Conoship International Poland".
    const contained = indexed
      .filter((item) => item.words.every((word) => words.includes(word)))
      .sort((left, right) => right.words.length - left.words.length)[0];
    if (contained) return contained.company;
  }
  return undefined;
}

type CompanyPrefill = { name: string; country: string; city: string; website: string; linkedin: string; description: string; kind: string; cardImages: string[] };

// "NAOS-BCN, S.L." → "NAOS-BCN"; "ТОВ «Морські системи»" → "Морські системи". The CRM keeps the brand name.
const TRAILING_LEGAL_FORM = /[\s,.]+(?:s\.?\s?l\.?(?:\s?u\.?)?|s\.?\s?a\.?(?:\s?u\.?)?|s\.?\s?r\.?\s?l\.?|s\.?\s?p\.?\s?a\.?|sp\.?\s?z\s?o\.?\s?o\.?|gmbh(?:\s?&\s?co\.?\s?kg)?|ag|kg|llc|l\.l\.c\.|ltd\.?|limited|inc\.?|corp\.?|plc|b\.?\s?v\.?|n\.?\s?v\.?|a\/s|as|asa|aps|ab|oy|oyj|oü|uab|sia|kft|s\.?r\.?o\.?|d\.?o\.?o\.?|тов|тзов|прат|пат|ооо|фоп)\.?$/iu;
const LEADING_LEGAL_FORM = /^(?:тов|тзов|прат|пат|ооо|оао|зао|пао|фоп)\s+/iu;

function companyBrandName(name: string) {
  const brand = name.trim().replace(TRAILING_LEGAL_FORM, "").replace(LEADING_LEGAL_FORM, "").replace(/^[«"“]+|[»"”]+$/gu, "").trim();
  return brand.length >= 2 ? brand : name.trim();
}

// Company type suggested from words on the card; only values present in the CRM lookup are used.
const COMPANY_KIND_HINTS: [string, RegExp][] = [
  ["Ship design", /design|naval architect|engineering|ingenier|consult|проект|конструктор/iu],
  ["Shipyard", /shipyard|(?<!\p{L})yard(?!\p{L})|astillero|verft|stocznia|cantiere|werft|верф|суднобуд/iu],
  ["Software developer", /software|(?<!\p{L})it(?!\p{L})|digital|developer|програм/iu],
  ["Equipment", /equipment|machinery|propulsion|systems|обладнан|оборудован/iu],
  ["Supplier", /supplier|supply|trading|distribut|постач|поставщ/iu],
];

function cardCompanyKind(result: OcrResult, kinds: string[]) {
  const text = (result.lines ?? []).filter((line) => !["name", "email", "phone", "website", "linkedin"].includes(line.type)).map((line) => line.text).join(" ");
  for (const [kind, pattern] of COMPANY_KIND_HINTS) {
    const known = kinds.find((value) => value.toLocaleLowerCase() === kind.toLocaleLowerCase());
    if (known && pattern.test(text)) return known;
  }
  return "";
}

// Native and short spellings seen on cards → names used in the CRM country list.
const COUNTRY_ALIASES: Record<string, string> = {
  polska: "Poland", "україна": "Ukraine", "украина": "Ukraine", norge: "Norway", deutschland: "Germany", "españa": "Spain", espana: "Spain",
  nederland: "Netherlands", holland: "Netherlands", "the netherlands": "Netherlands", sverige: "Sweden", danmark: "Denmark", suomi: "Finland",
  uk: "United Kingdom", england: "United Kingdom", scotland: "United Kingdom", "united states": "USA", us: "USA", turkey: "Türkiye",
  lietuva: "Lithuania", latvija: "Latvia", eesti: "Estonia", italia: "Italy", "czech republic": "Czechia", "česko": "Czechia",
};
const PHONE_COUNTRY_PREFIXES: [string, string][] = [
  ["380", "Ukraine"], ["370", "Lithuania"], ["371", "Latvia"], ["372", "Estonia"], ["373", "Moldova"], ["358", "Finland"], ["351", "Portugal"],
  ["357", "Cyprus"], ["356", "Malta"], ["385", "Croatia"], ["359", "Bulgaria"], ["420", "Czechia"], ["421", "Slovakia"], ["353", "Ireland"],
  ["971", "United Arab Emirates"], ["48", "Poland"], ["47", "Norway"], ["46", "Sweden"], ["45", "Denmark"], ["49", "Germany"], ["31", "Netherlands"],
  ["32", "Belgium"], ["33", "France"], ["34", "Spain"], ["39", "Italy"], ["30", "Greece"], ["90", "Türkiye"], ["40", "Romania"], ["36", "Hungary"],
  ["43", "Austria"], ["41", "Switzerland"], ["44", "United Kingdom"], ["82", "South Korea"], ["81", "Japan"], ["86", "China"], ["65", "Singapore"], ["1", "USA"],
];
const DOMAIN_COUNTRIES: Record<string, string> = {
  ua: "Ukraine", pl: "Poland", no: "Norway", se: "Sweden", dk: "Denmark", fi: "Finland", de: "Germany", nl: "Netherlands", be: "Belgium", fr: "France",
  es: "Spain", it: "Italy", pt: "Portugal", gr: "Greece", tr: "Türkiye", cy: "Cyprus", mt: "Malta", hr: "Croatia", ro: "Romania", bg: "Bulgaria",
  cz: "Czechia", sk: "Slovakia", hu: "Hungary", at: "Austria", ch: "Switzerland", uk: "United Kingdom", ie: "Ireland", lt: "Lithuania", lv: "Latvia",
  ee: "Estonia", md: "Moldova", kr: "South Korea", jp: "Japan", cn: "China", sg: "Singapore", ae: "United Arab Emirates",
};

function ocrLinesOfType(result: OcrResult, ...types: OcrLineType[]) {
  return (result.lines ?? []).filter((line) => types.includes(line.type)).map((line) => line.text);
}

function titleCaseIfUpper(value: string) {
  return value === value.toLocaleUpperCase() ? value.toLocaleLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase()) : value;
}

// CRM countries named in a line, in the order the card prints them.
function countriesInLine(line: string, countries: string[]) {
  const known = (name: string) => countries.length === 0 ? name : countries.find((country) => country.toLocaleLowerCase() === name.toLocaleLowerCase()) ?? "";
  const lower = ` ${line.toLocaleLowerCase().replace(/[(),.|/]/g, " ")} `;
  const found = new Map<string, number>();
  const note = (name: string, country: string) => {
    const at = lower.indexOf(` ${name.toLocaleLowerCase()} `);
    const previous = found.get(country);
    if (at >= 0 && country && (previous === undefined || at < previous)) found.set(country, at);
  };
  for (const country of countries) note(country, country);
  for (const [alias, country] of Object.entries(COUNTRY_ALIASES)) note(alias, known(country));
  return [...found.entries()].sort((left, right) => left[1] - right[1]).map(([country]) => country);
}

// Country from the card: an address line naming one country wins, then the phone prefix, then the web
// domain. Office lists ("GÖTEBORG | SWEDEN TRIESTE | ITALY BARCELONA | SPAIN") name several countries;
// they only confirm a phone or domain country, never pick one on their own.
function cardCountry(result: OcrResult, countries: string[]) {
  const known = (name: string) => countries.length === 0 ? name : countries.find((country) => country.toLocaleLowerCase() === name.toLocaleLowerCase()) ?? "";
  const phoneCountry = contactPhones(result.draft.phone)
    .map((phone) => phone.trim().startsWith("+") ? phone.replace(/\D/g, "") : "")
    .map((digits) => known(PHONE_COUNTRY_PREFIXES.find(([prefix]) => digits.startsWith(prefix))?.[1] ?? ""))
    .find(Boolean) ?? "";
  const tld = (result.company_domain ?? "").split(".").pop() ?? "";
  const domainCountry = DOMAIN_COUNTRIES[tld] ? known(DOMAIN_COUNTRIES[tld]) : "";
  const named = ocrLinesOfType(result, "location", "address", "offices").map((line) => countriesInLine(line, countries));
  const single = named.filter((found) => found.length === 1).map(([country]) => country);
  if (single.length > 0) return [phoneCountry, domainCountry].find((country) => country && single.includes(country)) ?? single[0];
  return phoneCountry || domainCountry;
}

const CARD_STREET_PATTERN = /(?<!\p{L})(?:(?:ul|al|str|ave|avda|av|vul|вул|ул|pl|pza|c)[./]|(?:street|straße|strasse|road|avenue|carrer|calle|avenida|plaza|plaça|passeig|paseo|via|viale|rue|rua|strada|gata|gate|vej|weg|straat|laan|ulica|aleja|вулиця|улица|проспект)(?!\p{L}))/iu;

// City: "GDANSK, POLAND", "El Astillero (Cantabria) SPAIN", "6090 Fosnavaag, Norway", "80-175 Gdansk" or
// "08870, Carrer San Sebastià, Barcelona, Spain". The part with or right before the country is read first;
// streets and parts that still carry a house number are skipped.
function cardCity(result: OcrResult, country: string) {
  const countryNames = [country, ...Object.entries(COUNTRY_ALIASES).filter(([, name]) => name === country).map(([alias]) => alias)].filter(Boolean);
  const countryPattern = countryNames.length > 0 ? new RegExp(`(?<!\\p{L})(?:${countryNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?!\\p{L})`, "giu") : null;
  const lines = [...ocrLinesOfType(result, "location"), ...ocrLinesOfType(result, "address")];
  for (const line of lines) {
    const parts = line.replace(/\([^)]*\)/g, " ").split(",").map((part) => part.trim()).filter(Boolean);
    const countryAt = countryPattern ? parts.findIndex((part) => part.search(countryPattern) >= 0) : -1;
    const ordered = countryAt >= 0 ? [parts[countryAt], parts[countryAt - 1]].filter((part): part is string => Boolean(part)) : parts;
    for (const part of ordered) {
      if (CARD_STREET_PATTERN.test(part)) continue;
      let text = part.replace(/(?<!\d)\d{2}-\d{3}(?!\d)|(?<!\d)\d{4,6}(?!\d)/g, " ");
      if (countryPattern) text = text.replace(countryPattern, " ");
      text = text.replace(/\s+/g, " ").trim();
      if (!text || /\d/.test(text)) continue;
      if (/^\p{L}[\p{L}\s'-]{1,40}$/u.test(text) && text.split(/\s+/).length <= 3) return titleCaseIfUpper(text);
    }
  }
  return "";
}

function companyPrefillFromCard(name: string, result: OcrResult | null, countries: string[], kinds: string[], cardImages: string[]): CompanyPrefill {
  const brand = companyBrandName(name);
  if (!result) return { name: brand, country: "", city: "", website: "", linkedin: "", description: brand !== name.trim() ? `Legal name: ${name.trim()}` : "", kind: "", cardImages };
  const country = cardCountry(result, countries);
  const address = ocrLinesOfType(result, "address", "location").join(", ");
  const registry = ocrLinesOfType(result, "registry").join("; ");
  const offices = ocrLinesOfType(result, "offices").join("; ");
  const description = [
    brand !== name.trim() && `Legal name: ${name.trim()}`,
    address && `Address: ${address}`,
    offices && `Offices: ${offices}`,
    registry && `Registration: ${registry}`,
    "Created from a scanned business card.",
  ].filter(Boolean).join("\n");
  return {
    name: brand,
    country,
    city: cardCity(result, country),
    website: result.draft.website ?? result.company_domain ?? "",
    linkedin: result.draft.linkedin?.includes("/company/") ? result.draft.linkedin : "",
    description,
    kind: cardCompanyKind(result, kinds),
    cardImages,
  };
}

function companySearchWords(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .split(/[^\p{L}]+/u)
    .map((word) => word.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
}

function companySearchSyllables(value: string) {
  return companySearchWords(value);
}

function searchTextMatches(text: string, query: string) {
  const syllables = companySearchSyllables(query);
  if (syllables.length === 0) return true;
  const words = companySearchWords(text);
  return syllables.every((syllable) => words.some((word) => word.includes(syllable)));
}

function companyLocation(company: Pick<Company, "city" | "country">) {
  return [company.city, company.country].filter((value) => value.trim() !== "").join(", ");
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

function isOverdue(task: Task) {
  return isOpenTask(task) && isLocalDateTimePast(task.deadline);
}

function isOpenTask(task: Task) {
  if (task.isClosed !== undefined) return !task.isClosed;
  return !["Completed", "Canceled", "Deferred", "Not interested"].includes(task.status);
}

const COMPLETED_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isCompletedTask(task: Task) {
  return task.statusKey === "completed" || task.status === "Completed";
}

function taskCompletionTime(task: Task) {
  const value = task.completedAt || task.updatedAt;
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isTaskEditLocked(task: Task, now = Date.now()) {
  if (!isCompletedTask(task)) return false;
  const completedAt = taskCompletionTime(task);
  return completedAt === null || now >= completedAt + COMPLETED_EDIT_WINDOW_MS;
}

function taskCompletionEditLabel(task: Task, now = Date.now()) {
  if (!isCompletedTask(task)) return "";
  const completedAt = taskCompletionTime(task);
  if (completedAt === null || now >= completedAt + COMPLETED_EDIT_WINDOW_MS) return "Completed · editing locked";
  const days = Math.max(1, Math.ceil((completedAt + COMPLETED_EDIT_WINDOW_MS - now) / (24 * 60 * 60 * 1000)));
  return `Completed · editable for ${days} more ${days === 1 ? "day" : "days"}`;
}

function latestCompanyTask(tasks: Task[], companyId: string) {
  return tasks
    .filter((task) => task.companyId === companyId)
    .sort((a, b) => Number(b.id) - Number(a.id))[0];
}

function companyTaskSequence(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    const activeDifference = Number(!isCompletedTask(b)) - Number(!isCompletedTask(a));
    if (activeDifference !== 0) return activeDifference;
    return Number(b.id) - Number(a.id);
  });
}

type TaskDeadlinePreset = "week" | "two-weeks" | "month";

function taskDeadlineFromContactDate(contactDate: string, preset: TaskDeadlinePreset = "month") {
  const [year, month, day] = contactDate.split("-").map(Number);
  const date = year && month && day ? new Date(year, month - 1, day, 14, 0, 0, 0) : new Date();
  if (!year || !month || !day) date.setHours(14, 0, 0, 0);
  if (preset === "week") date.setDate(date.getDate() + 7);
  else if (preset === "two-weeks") date.setDate(date.getDate() + 14);
  else date.setMonth(date.getMonth() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T14:00`;
}

function normalizeTaskDeadline(value: string) {
  if (!value) return value;
  const [datePart, timePart = "14:00"] = value.split("T");
  const [hour = "14", minute = "00"] = timePart.split(":");
  return `${datePart}T${hour.padStart(2, "0")}:${Number(minute) < 30 ? "00" : "30"}`;
}

const TASK_DEADLINE_HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));

function taskDeadlineParts(value: string) {
  const normalized = normalizeTaskDeadline(value || `${todayUser()}T14:00`);
  const [date = todayUser(), time = "14:00"] = normalized.split("T");
  const [hour = "14", minute = "00"] = time.split(":");
  return { date, hour, minute: minute === "30" ? "30" : "00" };
}

function taskDeadlineDraftValue(initialValue: (name: string, fallback?: string) => string, fallback: string) {
  const drafted = initialValue("deadline", fallback);
  // A draft saved with the deadline switched off stays off.
  if (!drafted) return "";
  const fallbackParts = taskDeadlineParts(drafted);
  const date = initialValue("deadlineDate", fallbackParts.date);
  if (!date) return "";
  const hour = initialValue("deadlineHour", fallbackParts.hour);
  const minute = initialValue("deadlineMinute", fallbackParts.minute) === "30" ? "30" : "00";
  return `${date}T${TASK_DEADLINE_HOURS.includes(hour) ? hour : "14"}:${minute}`;
}

function TaskDeadlineInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  // An empty value means "no deadline": the checkbox is off and the date/time inputs are locked.
  // Switching it back on restores the last date shown, or 14:00 today.
  const [remembered, setRemembered] = useState(value);
  const enabled = Boolean(value);
  const { date, hour, minute } = taskDeadlineParts(value || remembered);
  const update = (nextDate: string, nextHour: string, nextMinute: string) => {
    const next = nextDate ? `${nextDate}T${nextHour}:${nextMinute}` : "";
    if (next) setRemembered(next);
    onChange(next);
  };
  return <div className="task-deadline-control"><label className="task-deadline-toggle"><input type="checkbox" checked={enabled} onChange={(event) => { if (event.target.checked) onChange(`${date}T${hour}:${minute}`); else { setRemembered(value); onChange(""); } }} /><span>Deadline · {CLIENT_TIME_ZONE_LABEL}</span></label><div className="task-deadline-input"><input name="deadline" type="hidden" value={enabled ? `${date}T${hour}:${minute}` : ""} /><input name="deadlineDate" type="date" value={date} disabled={!enabled} required={enabled} aria-label="Deadline date" onChange={(event) => update(event.target.value, hour, minute)} /><select name="deadlineHour" value={hour} disabled={!enabled} aria-label="Deadline hour" onChange={(event) => update(date, event.target.value, minute)}>{TASK_DEADLINE_HOURS.map((option) => <option key={option} value={option}>{option}</option>)}</select><span aria-hidden="true">:</span><select name="deadlineMinute" value={minute} disabled={!enabled} aria-label="Deadline minutes" onChange={(event) => update(date, hour, event.target.value)}><option value="00">00</option><option value="30">30</option></select></div></div>;
}

function linkedRecordFromUrl(search: string): { type: "Company" | "Contact" | "Task"; id: string } | null {
  const params = new URLSearchParams(search);
  for (const [param, type] of [["task", "Task"], ["contact", "Contact"], ["company", "Company"]] as const) {
    const id = params.get(param) ?? "";
    if (/^\d+$/.test(id)) return { type, id };
  }
  return null;
}

// Extra people on a task: the company's other contacts plus every CJN manager.
// Picked from one dropdown, shown as removable chips; hidden inputs carry them into the form data.
function TaskParticipantsField({ contacts, contactPersonId, managers, selectedContactIds = [], selectedManagers = [] }: { contacts: Contact[]; contactPersonId?: string; managers: string[]; selectedContactIds?: string[]; selectedManagers?: string[] }) {
  const [contactIds, setContactIds] = useState(selectedContactIds);
  const [managerNames, setManagerNames] = useState(selectedManagers);
  // Contacts of another company (after a company change) or the chosen contact person drop out on their own.
  const contactOptions = contacts.filter((contact) => contact.id !== contactPersonId);
  const managerOptions = Array.from(new Set([...managers, ...selectedManagers]));
  const chosenContacts = contactOptions.filter((contact) => contactIds.includes(contact.id));
  const chosenManagers = managerOptions.filter((manager) => managerNames.includes(manager));
  const freeContacts = contactOptions.filter((contact) => !contactIds.includes(contact.id));
  const freeManagers = managerOptions.filter((manager) => !managerNames.includes(manager));
  const nothingLeft = freeContacts.length + freeManagers.length === 0;
  function add(value: string) {
    const separator = value.indexOf(":");
    const id = value.slice(separator + 1);
    if (value.startsWith("contact:")) setContactIds((current) => [...current, id]);
    else if (value.startsWith("manager:")) setManagerNames((current) => [...current, id]);
  }
  return <div className="field field-full task-participants">
    <label><span>Additional participants</span><select value="" disabled={nothingLeft} onChange={(event) => add(event.target.value)}>
      <option value="">{nothingLeft ? "Everyone is already added" : "Add a participant…"}</option>
      {freeContacts.length > 0 && <optgroup label="Contacts">{freeContacts.map((contact) => <option key={contact.id} value={`contact:${contact.id}`}>{contact.name}</option>)}</optgroup>}
      {freeManagers.length > 0 && <optgroup label="Managers">{freeManagers.map((manager) => <option key={manager} value={`manager:${manager}`}>{manager}</option>)}</optgroup>}
    </select></label>
    {chosenContacts.length + chosenManagers.length > 0 && <div className="participant-chips">
      {chosenContacts.map((contact) => <span className="participant-chip" key={`contact-${contact.id}`}><b>{contact.name}</b><small>contact</small><button type="button" aria-label={`Remove ${contact.name}`} onClick={() => setContactIds((current) => current.filter((id) => id !== contact.id))}>×</button><input type="hidden" name="participantContactIds" value={contact.id} /></span>)}
      {chosenManagers.map((manager) => <span className="participant-chip" key={`manager-${manager}`}><b>{manager}</b><small>manager</small><button type="button" aria-label={`Remove ${manager}`} onClick={() => setManagerNames((current) => current.filter((name) => name !== manager))}>×</button><input type="hidden" name="participantManagers" value={manager} /></span>)}
    </div>}
  </div>;
}

function TranslateToEnglishButton({ text, onChange }: { text: string; onChange: (value: string) => void }) {
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState("");

  async function translate() {
    if (!text.trim() || translating) return;
    setTranslating(true);
    setTranslationError("");
    try {
      const response = await apiRequest<{ data: { text: string } }>("/translate", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      onChange(response.data.text);
    } catch (error) {
      setTranslationError(apiMessage(error));
    } finally {
      setTranslating(false);
    }
  }

  return <span className="translate-control"><button className="text-button translate-button" type="button" disabled={!text.trim() || translating} title="Translate the entered text to English in this field" onClick={() => void translate()}>{translating ? "Translating…" : "Translate to English"}</button>{translationError && <small className="translate-error" role="alert">{translationError}</small>}</span>;
}

function priorityToneClass(priority: Task["priority"] | string) {
  return `priority-${priority.toLowerCase()}`;
}

function commentParagraphs(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const enteredParagraphs = normalized.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  if (enteredParagraphs.length > 1 || normalized.includes("\n")) {
    return enteredParagraphs.flatMap((paragraph) => paragraph.split(/\n+/).map((line) => line.trim()).filter(Boolean));
  }
  if (normalized.length < 320) return [normalized];
  const sentences = normalized.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [normalized];
  const paragraphs: string[] = [];
  let current = "";
  sentences.forEach((sentence) => {
    if (current && `${current} ${sentence}`.length > 280) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  });
  if (current) paragraphs.push(current);
  return paragraphs;
}

function websiteHref(value: string) {
  if (!value) return "#";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function contactMailto(contact: Contact, company: string) {
  const firstName = contact.name.trim().split(/\s+/)[0] || contact.name;
  return `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(`${company} — ${contact.name}`)}&body=${encodeURIComponent(`Hello ${firstName},\n\n`)}`;
}

function vCardValue(value: string | undefined) {
  return (value ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

// A contact's phone field may hold several numbers separated by ";" (mobile; office).
function contactPhones(value: string | undefined) {
  return (value ?? "").split(";").map((phone) => phone.trim()).filter((phone) => phone !== "" && phone !== "—");
}

function validContactPhones(value: string) {
  return contactPhones(value).every((phone) => /^[+()\d\s.-]{7,24}$/.test(phone));
}

const CONTACT_PHONE_ERROR = "Enter valid phone numbers; separate several numbers with “;”.";

function PhoneLinks({ value, className, stopPropagation = false }: { value: string | undefined; className?: string; stopPropagation?: boolean }) {
  const phones = contactPhones(value);
  if (phones.length === 0) return null;
  return <span className="phone-links">{phones.map((phone) => <a key={phone} className={className} href={`tel:${phone.replace(/[^\d+]/g, "")}`} onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}>{phone}</a>)}</span>;
}

function exportContactToOutlook(contact: Contact, company: string) {
  const names = contact.name.trim().split(/\s+/);
  const firstName = contact.firstName || names[0] || "";
  const lastName = contact.lastName || names.slice(1).join(" ");
  const notes = [
    contact.source && `Source: ${contact.source}`,
    contact.sourceDetail && `Source detail: ${contact.sourceDetail}`,
    contact.referredBy && `Referred by: ${contact.referredBy}`,
    contact.initiatedBy && `Initiated by: ${contact.initiatedBy}`,
    contact.owner && `CJN Manager: ${contact.owner}`,
  ].filter(Boolean).join(" · ");
  const card = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vCardValue(lastName)};${vCardValue(firstName)};;;`,
    `FN:${vCardValue(contact.name)}`,
    company && `ORG:${vCardValue(company)}`,
    contact.position && `TITLE:${vCardValue(contact.position)}`,
    ...contactPhones(contact.phone).map((phone) => `TEL;TYPE=WORK:${vCardValue(phone)}`),
    contact.email && `EMAIL;TYPE=INTERNET,WORK:${vCardValue(contact.email)}`,
    contact.linkedin && `URL;TYPE=LinkedIn:${vCardValue(websiteHref(contact.linkedin))}`,
    notes && `NOTE:${vCardValue(notes)}`,
    "END:VCARD",
  ].filter(Boolean).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([card], { type: "text/vcard;charset=utf-8" }));
  link.download = `${contact.name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "contact"}.vcf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

const COMPANY_WEBSITE_LABEL_LIMIT = 28;

function companyWebsiteLabel(value: string) {
  return value.length > COMPANY_WEBSITE_LABEL_LIMIT
    ? `${value.slice(0, COMPANY_WEBSITE_LABEL_LIMIT)}…`
    : value;
}

function nextActivityLabel(tasks: Task[], companyId?: string) {
  const nextTask = tasks
    .filter((task) => (!companyId || task.companyId === companyId) && isOpenTask(task) && Boolean(task.deadline))
    .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  return nextTask ? `${isOverdue(nextTask) ? "Overdue · " : ""}${formatDateTime(nextTask.deadline)}` : "No open activity";
}

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;

async function processImageFile(file: File, kind: "person" | "company" = "person") {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) throw new Error("Choose a JPG, PNG, or WebP image.");
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error("Choose an image up to 5 MB.");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    image.decoding = "async";
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The selected image could not be opened."));
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
      throw new Error("Choose an image smaller than 40 megapixels.");
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preview is not supported by this browser.");
    if (kind === "company") {
      const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, 0, canvas.width, canvas.height);
    } else {
      const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
      const targetSize = Math.min(512, cropSize);
      const sourceX = (image.naturalWidth - cropSize) / 2;
      const sourceY = (image.naturalHeight - cropSize) / 2;
      canvas.width = targetSize;
      canvas.height = targetSize;
      context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, targetSize, targetSize);
    }
    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

type CompanyWebsiteInfo = { website: string; name: string | null; description: string | null; address: string | null; city: string | null; country: string | null; logo_data_url: string | null };

// Website logos arrive as SVG, ICO, PNG…; company logos are stored as WebP up to 512 px.
// An <img> never runs scripts inside an SVG, and the canvas output is a plain raster image.
async function rasterizeLogo(dataUrl: string) {
  const image = new window.Image();
  image.decoding = "async";
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The website logo could not be opened."));
  });
  const width = image.naturalWidth || 512;
  const height = image.naturalHeight || 512;
  // Vector logos scale up cleanly, raster ones are only scaled down.
  const factor = dataUrl.startsWith("data:image/svg+xml") ? 512 / Math.max(width, height) : Math.min(1, 512 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * factor));
  canvas.height = Math.max(1, Math.round(height * factor));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Image preview is not supported by this browser.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  // Logos made for dark site headers are white on transparent and vanish on the CRM's white
  // cards: put those on the CRM's dark navy instead.
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let opaque = 0;
  let luminance = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    opaque += 1;
    luminance += (0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]) / 255;
  }
  if (opaque > 0 && opaque < pixels.length / 4 * 0.85 && luminance / opaque > 0.85) {
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#0b2f48";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL("image/webp", 0.82);
}

// Website country: a name ("Norway", "Polska") or an ISO code ("NO") → the CRM country list.
function countryFromWebsite(value: string | null, countries: string[]) {
  const lower = value?.trim().toLocaleLowerCase() ?? "";
  if (!lower) return "";
  const candidate = countries.find((country) => country.toLocaleLowerCase() === lower)
    ?? COUNTRY_ALIASES[lower]
    ?? (lower.length === 2 ? DOMAIN_COUNTRIES[lower === "gb" ? "uk" : lower] : undefined)
    ?? "";
  return countries.length === 0 || countries.includes(candidate) ? candidate : "";
}

function ImageField({ label, name, value, onChange, onProcessingChange, kind = "person" }: {
  label: string;
  name: string;
  value?: string;
  onChange: (value: string) => void;
  onProcessingChange?: (processing: boolean) => void;
  kind?: "person" | "company";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);

  useEffect(() => () => { requestRef.current += 1; onProcessingChange?.(false); }, [onProcessingChange]);

  function updateProcessing(next: boolean) {
    setProcessing(next);
    onProcessingChange?.(next);
  }

  async function chooseImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const request = ++requestRef.current;
    updateProcessing(true);
    setError("");
    try {
      const image = await processImageFile(file, kind);
      if (request === requestRef.current) onChange(image);
    } catch (caught) {
      if (request === requestRef.current) setError(caught instanceof Error ? caught.message : "The selected image could not be processed.");
    } finally {
      if (request === requestRef.current) updateProcessing(false);
    }
  }

  return (
    <div className="image-field field-full">
      <div className={`image-preview ${kind === "company" ? "company" : "person"}`}>
        {value ? <img src={value} alt={`${label} preview`} /> : <span aria-hidden="true">{kind === "company" ? "LOGO" : "PHOTO"}</span>}
      </div>
      <div className="image-field-copy">
        <b>{label}</b>
        <small>JPG, PNG, or WebP · up to 5 MB. {kind === "company" ? "Logo proportions are preserved." : "The photo is cropped to a square."}</small>
        <div className="image-actions">
          <button className="secondary-button" type="button" disabled={processing} onClick={() => inputRef.current?.click()}>{processing ? "Processing…" : value ? "Replace image" : "Choose image"}</button>
          {value && <button className="text-button" type="button" onClick={() => { requestRef.current += 1; updateProcessing(false); onChange(""); setError(""); }}>Remove</button>}
        </div>
        <input ref={inputRef} className="image-input" name={name} type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseImage} aria-describedby={`${name}-image-help`} />
        <span className="sr-only" id={`${name}-image-help`}>Accepted formats are JPG, PNG, and WebP, up to 5 MB.</span>
        {error && <small className="image-error" role="alert">{error}</small>}
      </div>
    </div>
  );
}

// "Take logo from card": drag a rectangle over the scanned card; the selection becomes the company logo.
function CardLogoCrop({ images, onLogo, onProcessingChange }: { images: string[]; onLogo: (logo: string) => void; onProcessingChange: (processing: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const [selection, setSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [error, setError] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  // Pointer position as a fraction of the displayed image, so the crop is resolution independent.
  function point(event: React.PointerEvent) {
    const box = imageRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) };
  }

  function drag(event: React.PointerEvent) {
    const start = startRef.current;
    if (!start) return;
    const current = point(event);
    setSelection({ x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y) });
  }

  async function applySelection() {
    const image = imageRef.current;
    if (!image || !selection || selection.width < 0.02 || selection.height < 0.02) {
      setError("Drag a rectangle around the logo first.");
      return;
    }
    onProcessingChange(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(selection.width * image.naturalWidth));
      canvas.height = Math.max(1, Math.round(selection.height * image.naturalHeight));
      canvas.getContext("2d")?.drawImage(image, selection.x * image.naturalWidth, selection.y * image.naturalHeight, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The selected area could not be read.");
      onLogo(await processImageFile(new File([blob], "card-logo.png", { type: "image/png" }), "company"));
      setOpen(false);
      setSelection(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The selected area could not be used as a logo.");
    } finally {
      onProcessingChange(false);
    }
  }

  if (!open) return <div className="field-full"><button className="text-button" type="button" onClick={() => setOpen(true)}>✂ Take logo from the business card</button></div>;
  return (
    <div className="logo-crop field-full">
      <small>Drag a rectangle around the logo on the card.</small>
      <div className="logo-crop-stage" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startRef.current = point(event); setSelection(null); }} onPointerMove={drag} onPointerUp={(event) => { drag(event); startRef.current = null; }}>
        <img ref={imageRef} src={images[imageIndex]} alt="Business card" draggable={false} />
        {selection && <span className="logo-crop-selection" style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%` }} />}
      </div>
      {error && <small className="image-error" role="alert">{error}</small>}
      <div className="logo-crop-actions">
        <button className="secondary-button" type="button" onClick={() => void applySelection()}>Use as logo</button>
        {images.length > 1 && <button className="text-button" type="button" onClick={() => { setImageIndex((index) => (index + 1) % images.length); setSelection(null); }}>Show {imageIndex === 0 ? "back" : "front"} side</button>}
        <button className="text-button" type="button" onClick={() => { setOpen(false); setSelection(null); setError(""); }}>Cancel</button>
      </div>
    </div>
  );
}

function CompanyCombobox({ inputId, label, companies, value, onChange, required = false }: {
  inputId: string;
  label: string;
  companies: Company[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = value.trim().toLocaleLowerCase();
  const matches = companies
    .filter((company) => !query || company.name.toLocaleLowerCase().includes(query))
    .slice(0, 12);
  const selectedCompany = companyByName(companies, value);
  const listId = `${inputId}-options`;
  const visibleActiveIndex = Math.min(activeIndex, Math.max(0, matches.length - 1));

  function choose(company: Company) {
    onChange(company.name);
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(current + 1, Math.max(0, matches.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter" && open && matches.length > 0) {
      event.preventDefault();
      choose(matches[visibleActiveIndex] ?? matches[0]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="field field-full company-combobox-field" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <label className="company-combobox-label" htmlFor={inputId}>{label}</label>
      <div className="company-combobox-control">
        <input
          id={inputId}
          name="companyName"
          value={value}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-activedescendant={open && matches.length > 0 ? `${listId}-${matches[visibleActiveIndex].id}` : undefined}
          onFocus={() => { setOpen(true); setActiveIndex(0); }}
          onChange={(event) => { onChange(event.target.value); setOpen(true); setActiveIndex(0); }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
          required={required}
        />
        <button className="company-combobox-toggle" type="button" aria-label={open ? "Close company list" : "Open company list"} aria-expanded={open} onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen((current) => !current); setActiveIndex(0); }}><span aria-hidden="true">•••</span></button>
        <input name="companyId" type="hidden" value={selectedCompany?.id ?? ""} />
        {open && <div className="company-combobox-options" id={listId} role="listbox" aria-label="Companies">
          {matches.length > 0 ? matches.map((company, index) => <button id={`${listId}-${company.id}`} className={index === visibleActiveIndex ? "active" : ""} key={company.id} type="button" role="option" aria-selected={company.id === selectedCompany?.id} onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(company)}><EntityLogo name={company.name} src={company.logoDataUrl} /><span><b>{company.name}</b><small>{companyLocation(company) || "Location not specified"}</small></span>{company.id === selectedCompany?.id && <span className="company-combobox-check" aria-hidden="true">✓</span>}</button>) : <div className="company-combobox-empty">No companies found</div>}
        </div>}
      </div>
    </div>
  );
}

function PageScrollControls({ hidden = false }: { hidden?: boolean }) {
  const [state, setState] = useState({ scrollable: false, atTop: true, atBottom: false });

  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const root = document.documentElement;
        const maximum = Math.max(root.scrollHeight, document.body.scrollHeight) - window.innerHeight;
        const current = window.scrollY || root.scrollTop;
        setState({ scrollable: maximum > 24, atTop: current <= 8, atBottom: current >= maximum - 8 });
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (observer) observer.observe(document.body);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [hidden]);

  if (hidden || !state.scrollable) return null;
  const behavior = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  return (
    <nav className="page-scroll-controls" aria-label="Page navigation">
      <button type="button" disabled={state.atTop} aria-label="Scroll to top" title="Scroll to top" onClick={() => window.scrollTo({ top: 0, behavior })}>↑</button>
      <button type="button" disabled={state.atBottom} aria-label="Scroll to bottom" title="Scroll to bottom" onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior })}>↓</button>
    </nav>
  );
}

const INFO_TEXT: Record<string, string> = {
  "New Organization": "A newly added organization whose first interaction is still being arranged.",
  "Follow-up Active": "The team is coordinating the client request and its next step.",
  "Awaiting Response": "The team is waiting for the client's response or decision.",
  "Active Relationship": "The organization has current tasks or ongoing work.",
  "Not Started": "The task has been created, but work has not started.",
  Started: "The task is currently in progress.",
  Completed: "The task has been completed.",
  Canceled: "The task was canceled and remains available in history.",
  Deferred: "The task has been postponed.",
  Active: "The user has access to the CRM.",
  Inactive: "This record or account is inactive and retained for history.",
  Pending: "The registration is waiting for administrator approval.",
  Admin: "Full access to data, users, and settings.",
  Manager: "Works with clients, contacts, the relationship board, and tasks.",
  Editor: "Can create and edit the same CRM records as Manager.",
  "Read-only": "Can view data without editing.",
  "High priority": "High priority: this task needs immediate attention.",
  "Medium priority": "Medium priority: complete this task within the current plan.",
  "Low priority": "Low priority with no urgent escalation.",
};

function StatusBadge({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  const slug = value.toLowerCase().replace(/[^a-z]+/g, "-");
  const detail = INFO_TEXT[value] ?? `Field option: ${value}. Select again to close this information.`;
  function toggle(event: { stopPropagation: () => void }) {
    event.stopPropagation();
    setOpen((current) => !current);
  }
  return (
    <span className="info-popover-wrap">
      <button className={`status-badge status-${slug} interactive-chip`} type="button" aria-expanded={open} onClick={toggle}>{value}</button>
      {open && <span className="info-popover" role="status"><b>{value}</b><small>{detail}</small></span>}
    </span>
  );
}

function StaticStatusBadge({ value }: { value: string }) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return <span className={`status-badge status-${slug}`}>{value}</span>;
}

function CountBadge({ count, label, detail }: { count: number; label: string; detail: string }) {
  const [open, setOpen] = useState(false);
  const displayLabel = count === 1 ? label.replace(/ies$/, "y").replace(/s$/, "") : label;
  function toggle(event: { stopPropagation: () => void }) {
    event.stopPropagation();
    setOpen((current) => !current);
  }
  return (
    <span className="info-popover-wrap count-popover-wrap">
      <button className="count-badge interactive-chip" type="button" aria-label={`${displayLabel}: ${count}`} aria-expanded={open} onClick={toggle}>{count}</button>
      {open && <span className="info-popover count-info-popover" role="status"><b>{count} · {displayLabel}</b><small>{detail}</small></span>}
    </span>
  );
}

function useDialogFocusTrap(dialogRef: RefObject<HTMLElement | null>, onClose: () => void, active = true, returnFocusRef?: RefObject<HTMLElement | null>) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousFocus = returnFocusRef?.current ?? (
      activeElement && !dialogRef.current?.contains(activeElement)
        ? activeElement
        : [...focusHistory].reverse().find((element) => element.isConnected && !dialogRef.current?.contains(element)) ?? null
    );
    const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
    const initialFocusFrame = window.requestAnimationFrame(() => {
      const preferred = dialogRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus], [autofocus]");
      const first = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (preferred ?? first)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      // With stacked dialogs (contact → new company) only the topmost one handles keys.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(initialFocusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => {
        const remainingDialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
        const remainingDialog = remainingDialogs[remainingDialogs.length - 1];
        if (previousFocus?.isConnected && (!remainingDialog || remainingDialog.contains(previousFocus))) previousFocus.focus();
      });
    };
  }, [active, dialogRef, returnFocusRef]);
}

// Forms pass closeOnBackdrop={false}: a stray click beside a half-filled form must not hide it.
function Modal({ title, eyebrow, onClose, children, wide = false, initialScroll = "top", closeOnBackdrop = true }: { title: string; eyebrow?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; initialScroll?: "top" | "bottom"; closeOnBackdrop?: boolean }) {
  const dialogRef = useRef<HTMLElement>(null);
  const [nudged, setNudged] = useState(false);
  useDialogFocusTrap(dialogRef, onClose);

  useEffect(() => {
    if (!nudged) return;
    const timer = window.setTimeout(() => setNudged(false), 2400);
    return () => window.clearTimeout(timer);
  }, [nudged]);

  useEffect(() => {
    const initialScrollFrame = window.requestAnimationFrame(() => {
      if (!dialogRef.current) return;
      dialogRef.current.scrollTop = initialScroll === "bottom" ? dialogRef.current.scrollHeight : 0;
    });
    return () => window.cancelAnimationFrame(initialScrollFrame);
  }, [initialScroll]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => closeOnBackdrop ? onClose() : setNudged(true)}>
      <section
        ref={dialogRef}
        className={`modal-card${wide ? " modal-wide" : ""}${nudged ? " modal-nudged" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog">×</button>
        </header>
        {nudged && <p className="modal-stay-hint" role="status">The form stays open so nothing is lost. Close it with × or Cancel.</p>}
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function AuthScreen({ onLogin, onRegister, onRecover }: {
  onLogin: (email: string, password: string) => Promise<string | null>;
  onRegister: (name: string, email: string, password: string) => Promise<string | null>;
  onRecover: (email: string) => Promise<string | null>;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const signInTabRef = useRef<HTMLButtonElement>(null);
  const registerTabRef = useRef<HTMLButtonElement>(null);
  const recoveryDialogRef = useRef<HTMLElement>(null);
  const recoveryTriggerRef = useRef<HTMLButtonElement>(null);
  useDialogFocusTrap(recoveryDialogRef, () => setRecoveryOpen(false), recoveryOpen, recoveryTriggerRef);

  function selectMode(nextMode: "signin" | "signup", focusTab = false) {
    setMode(nextMode);
    setMessage("");
    setFormError("");
    if (focusTab) {
      window.requestAnimationFrame(() => (nextMode === "signin" ? signInTabRef : registerTabRef).current?.focus());
    }
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextMode = event.key === "Home" ? "signin" : event.key === "End" ? "signup" : mode === "signin" ? "signup" : "signin";
    selectMode(nextMode, true);
  }

  async function emailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "").trim();
    const confirmPassword = String(data.get("confirmPassword") ?? "");
    setFormError("");

    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      setFormError("Enter a valid work email address.");
      return;
    }
    if (!isStrongPassword(password)) {
      setFormError("Use at least 8 characters with both letters and numbers.");
      return;
    }

    if (mode === "signup") {
      if (name.length < 2) {
        setFormError("Enter your full name.");
        return;
      }
      if (password !== confirmPassword) {
        setFormError("Passwords do not match.");
        return;
      }
      setSubmitting(true);
      const registrationError = await onRegister(name, email, password);
      setSubmitting(false);
      if (registrationError) return setFormError(registrationError);
      selectMode("signin");
      setMessage("Registration submitted. An administrator must approve the Read-only account before sign-in.");
      return;
    }

    setSubmitting(true);
    const loginError = await onLogin(email, password);
    setSubmitting(false);
    if (loginError) setFormError(loginError);
  }

  async function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("recoveryEmail") ?? "").trim();
    if (!EMAIL_PATTERN.test(email)) return setFieldError(event.currentTarget, "recoveryEmail", "Enter a valid email address.");
    const recoveryError = await onRecover(email);
    setMessage(recoveryError ?? `If ${email} is registered, password recovery instructions have been sent.`);
    setRecoveryOpen(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-shell" aria-label="Client Data CRM authentication">
        <div className="auth-intro">
          <div className="auth-brand"><span className="brand-mark">C</span><span><b>Client Data</b><small>CRM workspace</small></span></div>
          <div className="auth-intro-copy"><p className="eyebrow">CRM workspace</p><h1>Clients, contacts, and tasks in one clear workflow.</h1><p>Use email and password to review the role-aware frontend.</p></div>
          <div className="auth-benefits"><span><i>✓</i>Four clearly separated roles</span><span><i>✓</i>Responsive client workflow</span><span><i>✓</i>Browser-local reminder dates</span></div>
          <div className="auth-orbit auth-orbit-one" /><div className="auth-orbit auth-orbit-two" />
        </div>
        <div className="auth-card-wrap">
          <div className="auth-card">
            <div className="auth-mobile-brand"><span className="brand-mark">C</span><span><b>Client Data</b><small>CRM workspace</small></span></div>
            <header><p className="eyebrow">Welcome</p><h2>{mode === "signin" ? "Sign in to CRM" : "Request access"}</h2><p>{mode === "signin" ? "Use your email and password." : "New registrations start as pending Read-only accounts."}</p></header>
            <div className="auth-tabs" role="tablist" aria-label="Authentication mode" onKeyDown={handleTabKeyDown}>
              <button ref={signInTabRef} id="auth-tab-signin" type="button" role="tab" aria-selected={mode === "signin"} aria-controls="auth-mode-panel" tabIndex={mode === "signin" ? 0 : -1} className={mode === "signin" ? "active" : ""} onClick={() => selectMode("signin")}>Sign in</button>
              <button ref={registerTabRef} id="auth-tab-signup" type="button" role="tab" aria-selected={mode === "signup"} aria-controls="auth-mode-panel" tabIndex={mode === "signup" ? 0 : -1} className={mode === "signup" ? "active" : ""} onClick={() => selectMode("signup")}>Register</button>
            </div>
            <div id="auth-mode-panel" role="tabpanel" aria-labelledby={mode === "signin" ? "auth-tab-signin" : "auth-tab-signup"}>
              <form className="auth-form" onSubmit={emailLogin} key={mode}>
                {mode === "signup" && <label><span>Full name</span><input name="name" autoComplete="name" required minLength={2} maxLength={120} placeholder="Andrey Zherebetsky" /></label>}
                <label><span>Work email</span><input name="email" type="email" autoComplete="email" required maxLength={254} autoFocus defaultValue={mode === "signin" ? "" : ""} placeholder="name@company.com" /></label>
                <label><span>Password</span><span className="password-field"><input name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} maxLength={128} placeholder="8+ characters, letters and numbers" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "Hide" : "Show"}</button></span></label>
                {mode === "signup" && <label><span>Confirm password</span><input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} placeholder="Repeat your password" /></label>}
                <div className="auth-form-options auth-form-options-end">{mode === "signin" && <button ref={recoveryTriggerRef} type="button" onClick={() => { setRecoveryOpen(true); setMessage(""); }}>Forgot password?</button>}</div>
                <button className="primary-button auth-submit" type="submit" disabled={submitting}>{submitting ? "Please wait…" : mode === "signin" ? "Sign in to CRM" : "Submit registration"}<span>→</span></button>
              </form>
            </div>
            <p className="auth-security-note"><span>⌾</span> Your data is stored securely by the CRM server.</p>
            {formError && <div className="auth-message auth-error" role="alert">{formError}</div>}
            {message && <div className="auth-message" role="status">{message}</div>}
          </div>
        </div>
      </section>
      {recoveryOpen && (
        <div className="auth-recovery-backdrop" role="presentation" onMouseDown={() => setRecoveryOpen(false)}><section ref={recoveryDialogRef} className="auth-recovery" role="dialog" aria-modal="true" aria-label="Password recovery" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">Password recovery</p><h2>Reset password</h2></div><button className="icon-button" type="button" onClick={() => setRecoveryOpen(false)} aria-label="Close">×</button></header><p>Enter your work email and the CRM will send the available recovery instructions.</p><form onSubmit={recover}><label><span>Work email</span><input name="recoveryEmail" type="email" required autoFocus data-dialog-initial-focus placeholder="name@company.com" /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setRecoveryOpen(false)}>Cancel</button><button className="primary-button" type="submit">Continue</button></div></form></section></div>
      )}
    </main>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("The selected file could not be read."));
    reader.readAsDataURL(file);
  });
}

function PasswordChangeScreen({ identity, onChange, onSignOut, signingOut }: {
  identity: AuthIdentity;
  onChange: (currentPassword: string, newPassword: string) => Promise<string | null>;
  onSignOut: () => Promise<void>;
  signingOut: boolean;
}) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (!isStrongPassword(newPassword)) return setError("Use at least 8 characters with both letters and numbers.");
    if (newPassword !== confirmation) return setError("Passwords do not match.");
    if (newPassword === currentPassword) return setError("Choose a password different from the temporary one.");
    setSubmitting(true);
    const nextError = await onChange(currentPassword, newPassword);
    setSubmitting(false);
    if (nextError) setError(nextError);
  }

  return (
    <main className="auth-page">
      <section className="auth-shell" aria-label="Required password change">
        <div className="auth-intro"><div className="auth-brand"><span className="brand-mark">C</span><span><b>Client Data</b><small>CRM workspace</small></span></div><div className="auth-intro-copy"><p className="eyebrow">Account security</p><h1>Create your permanent password.</h1><p>The temporary password must be replaced before CRM data becomes available.</p></div></div>
        <div className="auth-card-wrap"><div className="auth-card"><header><p className="eyebrow">Signed in as {identity.email}</p><h2>Change password</h2><p>This one-time step protects your new account.</p></header><form className="auth-form" onSubmit={submit}><label><span>Temporary password</span><input name="currentPassword" type="password" autoComplete="current-password" required /></label><label><span>New password</span><input name="newPassword" type="password" autoComplete="new-password" minLength={8} required /></label><label><span>Confirm new password</span><input name="confirmation" type="password" autoComplete="new-password" minLength={8} required /></label><button className="primary-button auth-submit" type="submit" disabled={submitting || signingOut}>{submitting ? "Saving…" : "Save password and continue"}<span>→</span></button><button className="text-button" type="button" onClick={() => { void onSignOut(); }} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button></form>{error && <div className="auth-message auth-error" role="alert">{error}</div>}</div></div>
      </section>
    </main>
  );
}

function PasswordResetScreen({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (!isStrongPassword(password)) return void setFieldError(form, "password", "Use at least 8 characters with letters and numbers.");
    if (password !== confirmation) return void setFieldError(form, "confirmation", "Passwords do not match.");
    setSubmitting(true);
    setError("");
    try {
      await apiRequest("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password, password_confirmation: confirmation }) });
      setDone(true);
    } catch (requestError) {
      setError(apiMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="auth-page"><section className="auth-shell" aria-label="Set account password"><div className="auth-intro"><div className="auth-brand"><span className="brand-mark">C</span><span><b>Client Data</b><small>CRM workspace</small></span></div><div className="auth-intro-copy"><p className="eyebrow">Account access</p><h1>Set your CRM password.</h1><p>The invitation or recovery link can be used only once.</p></div></div><div className="auth-card-wrap"><div className="auth-card"><header><p className="eyebrow">Secure link</p><h2>{done ? "Password saved" : "Create a new password"}</h2></header>{done ? <><div className="auth-message" role="status">Your password is ready. You can now sign in.</div><button className="primary-button auth-submit" type="button" onClick={() => { window.location.href = "/"; }}>Continue to sign in →</button></> : <form className="auth-form" onSubmit={submit}><label><span>New password</span><input name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus /></label><label><span>Confirm password</span><input name="confirmation" type="password" autoComplete="new-password" required minLength={8} /></label><button className="primary-button auth-submit" type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save password"}<span>→</span></button></form>}{error && <div className="auth-message auth-error" role="alert">{error}</div>}</div></div></section></main>;
}

export function CRMApp() {
  useEffect(() => { clearAllVoiceDrafts(); }, []);
  useEffect(() => {
    const rememberFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      focusHistory.push(event.target);
      if (focusHistory.length > 20) focusHistory.shift();
    };
    document.addEventListener("focusin", rememberFocus, true);
    return () => document.removeEventListener("focusin", rememberFocus, true);
  }, []);
  const [passwordResetToken] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") ?? "");
  const [view, setView] = useUrlStringState<View>("view", "dashboard", ALL_VIEWS);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const recordsLoadedRef = useRef(false);
  const recordsLoadingRef = useRef<Promise<void> | null>(null);
  const recordsEpochRef = useRef(0);
  const managerEmailsRef = useRef(new Map<string, string>());
  const [taskComments, setTaskComments] = useState<TaskComment[]>([]);
  const [taskAttachments, setTaskAttachments] = useState<TaskAttachment[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [users, setUsers] = useState<CRMUser[]>([]);
  const [lookups, setLookups] = useState<LookupGroup[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [archivedCompanyIds, setArchivedCompanyIds] = useState<string[]>([]);
  const [archivedContactIds, setArchivedContactIds] = useState<string[]>([]);
  const [archivedTaskIds, setArchivedTaskIds] = useState<string[]>([]);
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalSearchIndex, setGlobalSearchIndex] = useState(-1);
  const [globalSearchPage, setGlobalSearchPage] = useState(1);
  const [globalResults, setGlobalResults] = useState<GlobalSearchResult[]>([]);
  const [companyQuery, setCompanyQuery] = useUrlStringState("company_q", "");
  const debouncedCompanyQuery = useDebouncedValue(companyQuery, 200);
  const [companyStatus, setCompanyStatus] = useUrlStringState("company_status", "All statuses");
  const [contactQuery, setContactQuery] = useUrlStringState("contact_q", "");
  const [taskFilter, setTaskFilter] = useUrlStringState("task_state", "All");
  const [taskManagerFilter, setTaskManagerFilter] = useUrlStringState("task_manager", "All managers");
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedUser, setSelectedUser] = useState<CRMUser | null>(null);
  // Read before the sync below rewrites the address, so a pasted card link survives the sign-in screen.
  const linkedRecordRef = useRef(typeof window === "undefined" ? null : linkedRecordFromUrl(window.location.search));
  // The open company/contact/task card lives in the address bar, so it can be copied and shared as-is.
  useEffect(() => {
    if (linkedRecordRef.current) return;
    const url = new URL(window.location.href);
    for (const [param, id] of [["company", selectedCompany?.id], ["contact", selectedContact?.id], ["task", selectedTask?.id]] as const) {
      if (id) url.searchParams.set(param, id);
      else url.searchParams.delete(param);
    }
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [selectedCompany?.id, selectedContact?.id, selectedTask?.id]);
  const [modal, setModal] = useState<"company" | "contact" | "task" | "user" | "profile" | "settings" | null>(null);
  const [modalCompanyId, setModalCompanyId] = useState<string | undefined>();
  const [cardCompany, setCardCompany] = useState<{ prefill: CompanyPrefill; onCreated: (company: Company) => void } | null>(null);
  const [modalParentTaskId, setModalParentTaskId] = useState<string | undefined>();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [readNotificationIdsByAccount, setReadNotificationIdsByAccount] = useState<Record<string, string[]>>(() => loadReadNotificationIds());
  const [preferencesByAccount, setPreferencesByAccount] = useState<Record<string, Preferences>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [currentManagerId, setCurrentManagerId] = useState<number | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const signingOutRef = useRef(false);
  const restoredDraftWindowScopeRef = useRef("");
  const skipNextDraftWindowWriteRef = useRef(false);
  const notificationAccountKey = identity?.accountEmail.toLowerCase() ?? "";
  const draftScope = identity ? draftScopeForAccount(identity.id, identity.accountEmail) : "";
  const notificationReadAccountKey = identity?.id ? `user:${identity.id}` : (notificationAccountKey ? `email:${notificationAccountKey}` : "");
  const readNotificationIds = readNotificationIdsByAccount[notificationReadAccountKey] ?? [];
  const preferences = preferencesByAccount[notificationAccountKey] ?? DEFAULT_PREFERENCES;
  const loadRecordsInEffect = useEffectEvent(loadRecords);

  useEffect(() => {
    if (!draftScope) return;
    clearOtherAccountDrafts(draftScope);
    clearOtherSecureVoiceDrafts(draftScope);
  }, [draftScope]);

  useEffect(() => {
    if (!identity || !draftScope || restoredDraftWindowScopeRef.current === draftScope) return;
    const draft = readFormDraft(draftScope, "open-window");
    const kind = draft?.kind?.[0] ?? "";
    if (["company-detail", "contact-detail", "task-detail"].includes(kind) && !recordsLoadedRef.current) {
      void loadRecordsInEffect(identity.role === "Admin").catch((error) => notify(apiMessage(error), "warning"));
      return;
    }
    restoredDraftWindowScopeRef.current = draftScope;
    const id = draft?.id?.[0] ?? "";
    const companyId = draft?.companyId?.[0] || undefined;
    const parentTaskId = draft?.parentTaskId?.[0] || undefined;
    skipNextDraftWindowWriteRef.current = true;
    queueMicrotask(() => {
      if (["company", "contact", "task", "user", "profile", "settings"].includes(kind)) {
        setModalCompanyId(companyId);
        setModalParentTaskId(parentTaskId);
        setModal(kind as typeof modal);
      } else if (kind === "company-detail") setSelectedCompany(companies.find((company) => company.id === id) ?? null);
      else if (kind === "contact-detail") setSelectedContact(contacts.find((contact) => contact.id === id) ?? null);
      else if (kind === "task-detail") setSelectedTask(tasks.find((task) => task.id === id) ?? null);
      else if (kind === "user-detail") setSelectedUser(users.find((user) => String(user.id ?? user.email.toLowerCase()) === id) ?? null);
    });
  }, [companies, contacts, draftScope, identity, tasks, users]);

  useEffect(() => {
    if (!draftScope || restoredDraftWindowScopeRef.current !== draftScope) return;
    if (skipNextDraftWindowWriteRef.current) {
      skipNextDraftWindowWriteRef.current = false;
      return;
    }
    if (modal) writeFormDraft(draftScope, "open-window", { kind: [modal], companyId: modalCompanyId ? [modalCompanyId] : [], parentTaskId: modalParentTaskId ? [modalParentTaskId] : [] });
    else if (selectedCompany) writeFormDraft(draftScope, "open-window", { kind: ["company-detail"], id: [selectedCompany.id] });
    else if (selectedContact) writeFormDraft(draftScope, "open-window", { kind: ["contact-detail"], id: [selectedContact.id] });
    else if (selectedTask) writeFormDraft(draftScope, "open-window", { kind: ["task-detail"], id: [selectedTask.id] });
    else if (selectedUser) writeFormDraft(draftScope, "open-window", { kind: ["user-detail"], id: [String(selectedUser.id ?? selectedUser.email.toLowerCase())] });
    else clearFormDraft(draftScope, "open-window");
  }, [draftScope, modal, modalCompanyId, modalParentTaskId, selectedCompany, selectedContact, selectedTask, selectedUser]);

  async function loadWorkspace() {
    const epoch = recordsEpochRef.current;
    const [response, dashboardResponse] = await Promise.all([
      apiRequest<{ data: WorkspacePayload }>("/app/bootstrap?include_records=0"),
      apiRequest<{ data: DashboardSummary }>("/dashboard"),
    ]);
    if (epoch !== recordsEpochRef.current) return;
    const payload = response.data;
    const includeArchived = apiString(payload.identity, "role") === "admin";
    setCsrfToken(payload.csrf_token);
    setDashboardSummary(dashboardResponse.data);
    const lookupGroups = Object.entries(payload.lookups).map(([type, items]) => ({
      type: lookupTypeToUi(type),
      label: ({ company_type: "Company Type", client_status: "Relationship Status", task_status: "Task Status", outcome_status: "Outcome Status", contact_source: "Contact Source", reminder_lead_time: "Reminder Advance Notice", cjn_manager: "CJN Manager" } as Record<string, string>)[type] ?? type,
      items: items.map((item) => ({ id: apiString(item, "id"), value: apiString(item, "value"), active: apiBoolean(item, "is_active"), keyCode: apiString(item, "key"), updatedAt: apiString(item, "updated_at"), userId: apiNumber(item, "user_id"), email: apiString(item, "email") || undefined })),
    }));
    const managerEmails = new Map((payload.lookups.cjn_manager ?? []).map((manager) => [apiString(manager, "value"), apiString(manager, "email").toLowerCase()]));
    managerEmailsRef.current = managerEmails;
    const mappedUsers = payload.users.map(mapUser);
    setTaskComments([]);
    setTaskAttachments([]);
    setLookups(lookupGroups);
    setCountries(payload.countries ?? []);
    setCurrentManagerId(payload.current_manager ? apiNumber(payload.current_manager, "id") ?? null : null);
    setUsers(mappedUsers);
    if (typeof window !== "undefined" && readUrlFilter(window.location.search, "view", "dashboard", ALL_VIEWS) === "users") {
      const requestedUserId = Number(new URLSearchParams(window.location.search).get("user") ?? 0);
      if (requestedUserId) setSelectedUser(mappedUsers.find((user) => user.id === requestedUserId) ?? null);
    }
    setAudit(payload.audit.map(mapAuditEvent));
    setIdentity(mapIdentity(payload.identity));
    setPasswordChangeRequired(false);
    const requestedView = typeof window === "undefined" ? view : readUrlFilter(window.location.search, "view", "dashboard", ALL_VIEWS);
    if (recordsLoadedRef.current || ["companies", "contacts", "activity", "lookups"].includes(requestedView)) {
      await loadRecords(includeArchived, true).catch((error) => notify(apiMessage(error), "warning"));
    }
    // A card address (?company=12, ?contact=5 or ?task=34) opens that card once after sign-in.
    const linked = linkedRecordRef.current;
    linkedRecordRef.current = null;
    if (linked) void openRecordById(linked.type, linked.id);
  }

  async function loadRecords(includeArchived: boolean, refresh = false): Promise<void> {
    if (recordsLoadingRef.current) return recordsLoadingRef.current;
    if (recordsLoadedRef.current && !refresh) return;
    setRecordsLoading(true);
    setRecordsError("");
    const epoch = recordsEpochRef.current;
    const loading = (async () => {
      const [companiesResponse, contactsResponse, tasksResponse] = await Promise.all([
        loadAllPages<ApiRecord>("/companies", "name", "asc", includeArchived),
        loadAllPages<ApiRecord>("/contacts", "last_name", "asc", includeArchived),
        loadAllPages<ApiRecord>("/tasks?state=all", "contact_date", "desc", includeArchived),
      ]);
      if (epoch !== recordsEpochRef.current) return;
      const mappedContacts = contactsResponse.map(mapContact);
      const contactCounts = new Map<string, number>();
      for (const contact of mappedContacts) {
        if (!contact.isArchived) contactCounts.set(contact.companyId, (contactCounts.get(contact.companyId) ?? 0) + 1);
      }
      const mappedCompanies = companiesResponse.map(mapCompany).map((company) => ({ ...company, contacts: contactCounts.get(company.id) ?? 0 }));
      const mappedTasks = tasksResponse.map(mapTask);
      setCompanies(mappedCompanies);
      setContacts(mappedContacts.map((contact) => ({ ...contact, initiatedByUserEmail: managerEmailsRef.current.get(contact.initiatedBy ?? "") || undefined })));
      setTasks(mappedTasks);
      setArchivedCompanyIds(mappedCompanies.filter((company) => company.isArchived).map((company) => company.id));
      setArchivedContactIds(mappedContacts.filter((contact) => contact.isArchived).map((contact) => contact.id));
      setArchivedTaskIds(mappedTasks.filter((task) => task.isArchived).map((task) => task.id));
      recordsLoadedRef.current = true;
    })();
    recordsLoadingRef.current = loading;
    try {
      await loading;
    } catch (error) {
      if (epoch !== recordsEpochRef.current) return;
      setRecordsError(apiMessage(error));
      throw error;
    } finally {
      if (recordsLoadingRef.current === loading) {
        recordsLoadingRef.current = null;
        setRecordsLoading(false);
      }
    }
  }

  async function openTaskDetail(task: Task, detailRecord?: ApiRecord) {
    const targetTask = task;
    setSelectedTask(targetTask);
    try {
      const detail = detailRecord ?? (await apiRequest<{ data: ApiRecord }>(`/tasks/${targetTask.id}`)).data;
      const mapped = mapTask(detail);
      setTasks((current) => current.map((item) => item.id === mapped.id ? mapped : item));
      setTaskComments((detail.comments as ApiRecord[] | undefined ?? []).map((comment) => ({
        id: apiString(comment, "id"), taskId: apiString(comment, "task_id"), author: apiString(comment, "author_name"),
        createdAt: formatUserDateTime(apiString(comment, "created_at")), text: apiString(comment, "text"),
        updatedAt: formatUserDateTime(apiString(comment, "updated_at")), authorUserId: apiNumber(comment, "author_user_id"), isHidden: apiBoolean(comment, "is_hidden"),
      })));
      setTaskAttachments((detail.attachments as ApiRecord[] | undefined ?? []).map((attachment) => ({
        id: Number(attachment.id), taskId: apiString(attachment, "task_id"), name: apiString(attachment, "original_name"),
        mimeType: apiString(attachment, "mime_type"), sizeBytes: Number(attachment.size_bytes ?? 0),
        authorUserId: Number(attachment.author_user_id), author: apiString(attachment, "author_name"),
        createdAt: formatUserDateTime(apiString(attachment, "created_at")),
      })));
    } catch (error) {
      notify(apiMessage(error), "warning");
    }
  }

  async function restoreSession() {
    try {
      const response = await apiRequest<{ data: { user: ApiRecord; csrf_token: string } }>("/auth/me");
      setCsrfToken(response.data.csrf_token);
      if (apiBoolean(response.data.user, "must_change_password")) {
        setIdentity(mapIdentity(response.data.user));
        setPasswordChangeRequired(true);
        return;
      }
      await loadWorkspace();
    } catch {
      recordsEpochRef.current += 1;
      recordsLoadedRef.current = false;
      recordsLoadingRef.current = null;
      setCompanies([]);
      setContacts([]);
      setTasks([]);
      setDashboardSummary(null);
      setRecordsError("");
      setIdentity(null);
    }
  }

  const restoreSessionInEffect = useEffectEvent(restoreSession);
  useEffect(() => {
    void Promise.resolve().then(() => restoreSessionInEffect()).finally(() => setSessionLoading(false));
  }, []);

  useEffect(() => {
    if (!identity || passwordChangeRequired || recordsLoadedRef.current || recordsLoadingRef.current || recordsError) return;
    if (!["companies", "contacts", "activity", "lookups"].includes(view) && !notificationsOpen && !globalSearch.trim() && !modal) return;
    void loadRecordsInEffect(identity.role === "Admin").catch((error) => notify(apiMessage(error), "warning"));
  }, [identity, view, notificationsOpen, globalSearch, modal, passwordChangeRequired, recordsError]);

  const forbiddenAdminView = Boolean(identity && (
    (view === "lookups" && !hasPermission(identity.role, "lookup.manage"))
      || (view === "users" && !hasPermission(identity.role, "user.manage"))
      || (view === "audit" && !hasPermission(identity.role, "audit.view"))
  ));

  function updateReadNotificationIds(update: string[] | ((current: string[]) => string[])) {
    if (!notificationReadAccountKey) return;
    setReadNotificationIdsByAccount((current) => {
      const previous = current[notificationReadAccountKey] ?? [];
      const next = typeof update === "function" ? update(previous) : update;
      return updateReadNotificationAccount(current, notificationReadAccountKey, next);
    });
  }
  const toastTimer = useRef<number | null>(null);
  const topbarActionsRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarCloseButtonRef = useRef<HTMLButtonElement>(null);
  const isMobileNavigation = useMediaQuery("(max-width: 900px)");
  const overlayOpen = Boolean(modal || selectedCompany || selectedContact || selectedTask || selectedUser || (sidebarOpen && isMobileNavigation));

  const archivedCompanyIdSet = useMemo(() => new Set(archivedCompanyIds), [archivedCompanyIds]);
  const archivedContactIdSet = useMemo(() => new Set(archivedContactIds), [archivedContactIds]);
  const archivedTaskIdSet = useMemo(() => new Set(archivedTaskIds), [archivedTaskIds]);
  const liveCompanies = useMemo(() => companies.filter((company) => !archivedCompanyIdSet.has(company.id)), [companies, archivedCompanyIdSet]);
  const liveContacts = useMemo(() => contacts.filter((contact) => !archivedContactIdSet.has(contact.id) && !archivedCompanyIdSet.has(contact.companyId)), [contacts, archivedContactIdSet, archivedCompanyIdSet]);
  const liveTasks = useMemo(() => tasks.filter((task) => !archivedTaskIdSet.has(task.id) && !archivedCompanyIdSet.has(task.companyId)), [tasks, archivedTaskIdSet, archivedCompanyIdSet]);
  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const liveCompanyById = useMemo(() => new Map(liveCompanies.map((company) => [company.id, company])), [liveCompanies]);
  const contactCountsByCompany = useMemo(() => {
    const counts = new Map<string, number>();
    for (const contact of liveContacts) counts.set(contact.companyId, (counts.get(contact.companyId) ?? 0) + 1);
    return counts;
  }, [liveContacts]);
  const currentRole = identity?.role ?? "Read-only";
  const canViewAudit = hasPermission(currentRole, "audit.view");
  const lookupValues = (type: string, activeOnly = true) => lookups.find((group) => group.type === type)?.items.filter((item) => !activeOnly || item.active).map((item) => item.value) ?? [];
  const activeClientStatuses = lookupValues("client-status");
  const clientStatusOrder = activeClientStatuses;
  const taskStatusOptions = lookupValues("task-status");
  const administrationLookups = lookups.filter((group) => group.type !== "outcome-status");
  const contactSourceOptions = lookupValues("contact-source");
  const reminderLeadOptions = lookupValues("reminder-lead");
  const companyTypeOptions = lookupValues("company-type");
  const managerOptions = lookupValues("cjn-manager");
  const allManagerOptions = lookupValues("cjn-manager", false);
  const activeManagerLookups = lookups.find((group) => group.type === "cjn-manager")?.items.filter((item) => item.active) ?? [];
  const defaultManager = activeManagerLookups.find((manager) => Number(manager.id) === currentManagerId)?.value
    ?? managerOptions[0]
    ?? "";
  const userEmailForName = (name: string) => users.find((user) => user.name === name)?.email.toLowerCase();
  const lookupId = (type: string, value?: string) => Number(lookups.find((group) => group.type === type)?.items.find((item) => item.value === value)?.id || 0) || null;
  const companyPayload = (company: Company) => ({ name: company.name, type_id: lookupId("company-type", company.kind), country: company.country, city: company.city || null, status_id: lookupId("client-status", company.status), manager_id: lookupId("cjn-manager", company.owner), website: company.website || null, linkedin: company.linkedin || null, nda_status: company.ndaStatus ?? NDA_STATUSES[0], ...(company.logoDataUrl?.startsWith("/api/") ? {} : { logo_data_url: company.logoDataUrl || null }), description: company.description || null, updated_at: company.updatedAt });
  const contactPayload = (contact: Contact) => {
    // Edits only change `name`; trust the stored first/last parts only while they still compose that name.
    const fullName = contact.name.trim().replace(/\s+/g, " ");
    const storedName = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim().replace(/\s+/g, " ");
    const names = contact.firstName && storedName === fullName
      ? [contact.firstName, contact.lastName ?? ""]
      : [fullName.split(" ")[0] ?? "", fullName.split(" ").slice(1).join(" ")];
    const initiatedById = lookupId("cjn-manager", contact.initiatedBy);
    return { company_id: Number(contact.companyId), first_name: names[0] ?? "", last_name: names[1] || null, position: contact.position || null, phone: contact.phone && contact.phone !== "—" ? contact.phone : null, email: contact.email || null, linkedin: contact.linkedin || null, source_id: lookupId("contact-source", contact.source), source_detail: contact.sourceDetail || null, referred_by: contact.referredBy || null, initiated_by_id: initiatedById, initiated_by_text: initiatedById ? null : contact.initiatedBy || identity?.name || null, status: contact.contactStatus ?? "active", manager_id: lookupId("cjn-manager", contact.owner) ?? initiatedById ?? lookupId("cjn-manager", identity?.name) ?? Number(lookups.find((group) => group.type === "cjn-manager")?.items.find((item) => item.active)?.id || 0), ...(contact.photoDataUrl?.startsWith("/api/") ? {} : { photo_data_url: contact.photoDataUrl || null }), business_card_data_url: contact.businessCardDataUrl || null, business_card_file_name: contact.businessCardFileName || null, business_card_back_data_url: contact.businessCardBackDataUrl || null, business_card_back_file_name: contact.businessCardBackFileName || null, updated_at: contact.updatedAt };
  };
  const taskPayload = (task: Task) => ({ company_id: Number(task.companyId), parent_task_id: null, name: task.title, contact_date: task.contactDate, manager_id: lookupId("cjn-manager", task.owner), contact_person_id: task.contactPersonId ? Number(task.contactPersonId) : null, description: task.note || null, status_id: lookupId("task-status", task.status), priority: task.priority, outcome_status_id: task.outcomeStatusId ?? (task.outcomeStatus ? lookupId("outcome-status", task.outcomeStatus) : null), outcome_notes: task.outcomeNotes || null, deadline: localDateTimeToUtc(task.deadline), reminder_lead_ids: (task.reminderLeads ?? []).map((lead) => lookupId("reminder-lead", lead)).filter(Boolean), ...(task.participantContactIds ? { participant_contact_ids: task.participantContactIds.map(Number), participant_manager_ids: (task.participantManagers ?? []).map((manager) => lookupId("cjn-manager", manager)).filter(Boolean) } : {}), updated_at: task.updatedAt });
  const reportServerError = (error: unknown) => { notify(apiMessage(error), "warning"); void loadWorkspace().catch(() => undefined); };

  const notifications = useMemo<AppNotification[]>(() => {
    const relatedTasks = liveTasks.filter((task) => task.ownerUserEmail === notificationAccountKey || task.createdByUserEmail === notificationAccountKey);
    const relatedTaskIds = new Set(relatedTasks.map((task) => task.id));
    const relatedOpenTasks = relatedTasks.filter(isOpenTask);
    const relatedContacts = liveContacts.filter((contact) => contact.ownerUserEmail === notificationAccountKey || contact.initiatedByUserEmail === notificationAccountKey);
    const relatedContactIds = new Set(relatedContacts.map((contact) => contact.id));
    const relatedCompanyIds = new Set([
      ...relatedTasks.map((task) => task.companyId),
      ...relatedContacts.map((contact) => contact.companyId),
      ...liveCompanies.filter((company) => company.ownerUserEmail === notificationAccountKey || company.createdByUserEmail === notificationAccountKey).map((company) => company.id),
    ]);
    const relatedCompanies = liveCompanies.filter((company) => relatedCompanyIds.has(company.id));
    const overdueItems: AppNotification[] = preferences.overdueNotifications
      ? relatedOpenTasks.filter(isOverdue).map((task) => ({
          id: `overdue:${task.id}:${task.deadline}`,
          kind: "overdue",
          title: "Overdue task",
          detail: `${task.title} · ${formatDateTime(task.deadline)}`,
          target: "task",
          targetId: task.id,
        }))
      : [];
    const deadlineItems: AppNotification[] = preferences.deadlineReminders
      ? relatedOpenTasks.filter((task) => Boolean(task.deadline) && !isOverdue(task)).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 2).map((task) => ({
          id: `deadline:${task.id}:${task.deadline}`,
          kind: "update",
          title: "Upcoming deadline",
          detail: `${task.title} · ${formatDateTime(task.deadline)}`,
          target: "task",
          targetId: task.id,
        }))
      : [];
    const auditItems: AppNotification[] = audit.filter((event) => {
      const [entityType = "", targetId = ""] = event.entity.split(" · ");
      return (entityType === "Task" && relatedTaskIds.has(targetId))
        || (entityType === "Company" && relatedCompanyIds.has(targetId))
        || (entityType === "Contact" && relatedContactIds.has(targetId));
    }).slice(0, 4).map((event) => {
      const [entityType = "", targetId] = event.entity.split(" · ");
      const target = entityType === "Task" ? "task" : entityType === "Company" ? "company" : entityType === "Contact" ? "contact" : "audit";
      const title = event.action === "CREATE" ? "New record created" : event.action === "STATUS CHANGE" ? "Status updated" : event.action === "REMINDER SENT" ? "Reminder sent" : "Record updated";
      return {
        id: `audit:${event.id}`,
        kind: event.action === "STATUS CHANGE" ? "update" : "audit",
        title,
        detail: `${event.entity} · ${event.detail}`,
        target,
        targetId,
      };
    });
    const summaryItems: AppNotification[] = preferences.workspaceSummary && (relatedCompanies.length > 0 || relatedContacts.length > 0 || relatedOpenTasks.length > 0) ? [{
      id: `summary:${notificationAccountKey}:${relatedCompanies.length}:${relatedContacts.length}:${relatedOpenTasks.length}`,
      kind: "audit",
      title: "My activity summary",
      detail: `${relatedCompanies.length} related companies · ${relatedContacts.length} related contacts · ${relatedOpenTasks.length} open tasks`,
      target: "activity",
    }] : [];
    return [...overdueItems, ...deadlineItems, ...auditItems, ...summaryItems].slice(0, 10);
  }, [audit, liveCompanies, liveContacts, liveTasks, notificationAccountKey, preferences]);

  const unreadNotifications = notifications.filter((item) => !readNotificationIds.includes(item.id));

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    saveReadNotificationIds(readNotificationIdsByAccount);
  }, [readNotificationIdsByAccount]);

  useEffect(() => {
    if (!notificationsOpen && !profileOpen && !globalSearch && !sidebarOpen) return;
    const closeTransientUi = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const focusTarget = sidebarOpen
        ? mobileMenuButtonRef.current
        : notificationsOpen
          ? notificationButtonRef.current
          : profileOpen
            ? profileButtonRef.current
            : null;
      setNotificationsOpen(false);
      setProfileOpen(false);
      setGlobalSearch("");
      setSidebarOpen(false);
      if (focusTarget) window.requestAnimationFrame(() => focusTarget.focus());
    };
    window.addEventListener("keydown", closeTransientUi);
    return () => window.removeEventListener("keydown", closeTransientUi);
  }, [globalSearch, notificationsOpen, profileOpen, sidebarOpen]);

  useEffect(() => {
    if (!notificationsOpen && !profileOpen && !(sidebarOpen && isMobileNavigation)) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if ((notificationsOpen || profileOpen) && !topbarActionsRef.current?.contains(target)) {
        setNotificationsOpen(false);
        setProfileOpen(false);
      }
      if (sidebarOpen && isMobileNavigation && !sidebarRef.current?.contains(target) && !mobileMenuButtonRef.current?.contains(target)) {
        setSidebarOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isMobileNavigation, notificationsOpen, profileOpen, sidebarOpen]);

  useEffect(() => {
    if (sidebarOpen && isMobileNavigation) sidebarCloseButtonRef.current?.focus();
  }, [isMobileNavigation, sidebarOpen]);

  useEffect(() => {
    if (!overlayOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [overlayOpen]);

  const filteredCompanies = useMemo(() => {
    return liveCompanies.filter((company) => {
      const matchesQuery = searchTextMatches(company.name, debouncedCompanyQuery);
      const matchesStatus = companyStatus === "All statuses" || company.status === companyStatus;
      return matchesQuery && matchesStatus;
    });
  }, [liveCompanies, debouncedCompanyQuery, companyStatus]);

  const filteredContacts = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    return liveContacts.filter((contact) =>
      !query || [contact.name, contact.email, contact.phone, contact.position, contact.source, contact.initiatedBy ?? "", contact.linkedin ?? "", liveCompanyById.get(contact.companyId)?.name ?? "Unknown company"].some((value) => value.toLowerCase().includes(query)),
    );
  }, [liveContacts, contactQuery, liveCompanyById]);

  useEffect(() => {
    const query = globalSearch.trim();
    if (companySearchSyllables(query).length < 1) return;
    const timer = window.setTimeout(() => {
      const companyResults = companies
        .filter((company) => !archivedCompanyIdSet.has(company.id) && searchTextMatches(company.name, query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((company): GlobalSearchResult => ({ type: "Company", id: company.id, label: company.name, meta: companyLocation(company) }));
      const contactResults = contacts
        .filter((contact) => !archivedContactIdSet.has(contact.id) && searchTextMatches(contact.name, query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((contact): GlobalSearchResult => ({ type: "Contact", id: contact.id, label: contact.name, meta: [companyById.get(contact.companyId)?.name ?? "Unknown company", contact.position, contact.email].filter(Boolean).join(" · ") }));
      const taskResults = tasks
        .filter((task) => !archivedTaskIdSet.has(task.id) && searchTextMatches(task.title, query))
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((task): GlobalSearchResult => ({ type: "Task", id: task.id, label: task.title, meta: [companyById.get(task.companyId)?.name ?? "Unknown company", task.contactPerson].filter(Boolean).join(" · ") }));
      setGlobalResults([...companyResults, ...contactResults, ...taskResults]);
      setGlobalSearchIndex(-1);
      setGlobalSearchPage(1);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [archivedCompanyIdSet, archivedContactIdSet, archivedTaskIdSet, companies, contacts, companyById, globalSearch, tasks]);
  const globalSearchOpen = companySearchSyllables(globalSearch).length >= 1;
  const globalSearchPageCount = Math.max(1, Math.ceil(globalResults.length / GLOBAL_SEARCH_PAGE_SIZE));
  const currentGlobalSearchPage = Math.min(globalSearchPage, globalSearchPageCount);
  const globalSearchPageStart = (currentGlobalSearchPage - 1) * GLOBAL_SEARCH_PAGE_SIZE;
  const visibleGlobalResults = globalResults.slice(globalSearchPageStart, globalSearchPageStart + GLOBAL_SEARCH_PAGE_SIZE);
  const activeGlobalSearchIndex = globalSearchIndex >= globalSearchPageStart && globalSearchIndex < globalSearchPageStart + visibleGlobalResults.length ? globalSearchIndex : -1;

  function notify(message: string, tone: ToastState["tone"] = "success") {
    setToast({ message, tone });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }

  async function authenticate(email: string, password: string) {
    try {
      const response = await apiRequest<{ data: { user: ApiRecord; csrf_token: string } }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setCsrfToken(response.data.csrf_token);
      if (apiBoolean(response.data.user, "must_change_password")) {
        setIdentity(mapIdentity(response.data.user));
        setPasswordChangeRequired(true);
        return null;
      }
      await loadWorkspace();
      notify("Signed in successfully");
      return null;
    } catch (error) {
      return apiMessage(error);
    }
  }

  async function registerAccount(name: string, email: string, password: string) {
    try {
      await apiRequest("/auth/register", { method: "POST", body: JSON.stringify({ full_name: name, email, password, password_confirmation: password }) });
      return null;
    } catch (error) {
      return apiMessage(error);
    }
  }

  async function recoverAccount(email: string) {
    try {
      await apiRequest("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      return null;
    } catch (error) {
      return apiMessage(error);
    }
  }

  function requirePermission(permission: Permission, action: string) {
    if (hasPermission(currentRole, permission)) return true;
    notify(`${currentRole} access cannot ${action}.`, "warning");
    return false;
  }

  async function signOut() {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch (error) {
      notify(`${apiMessage(error)} Local session data was cleared.`, "warning");
    } finally {
      clearAccountDrafts(draftScope);
      clearAllVoiceDrafts();
      clearAllSecureVoiceDrafts();
      setCsrfToken("");
      setPasswordChangeRequired(false);
      setIdentity(null);
      setCurrentManagerId(null);
      recordsEpochRef.current += 1;
      recordsLoadedRef.current = false;
      recordsLoadingRef.current = null;
      setRecordsLoading(false);
      setCompanies([]);
      setContacts([]);
      setTasks([]);
      setArchivedCompanyIds([]);
      setArchivedContactIds([]);
      setArchivedTaskIds([]);
      setDashboardSummary(null);
      setRecordsError("");
      setProfileOpen(false);
      signingOutRef.current = false;
      setSigningOut(false);
    }
    setNotificationsOpen(false);
    setSelectedCompany(null);
    setSelectedContact(null);
    setSelectedTask(null);
    setSelectedUser(null);
    setModal(null);
  }

  function navigate(nextView: View) {
    if (nextView === "lookups" && !requirePermission("lookup.manage", "manage Lookups")) return;
    if (nextView === "users" && !requirePermission("user.manage", "manage users and roles")) return;
    if (nextView === "audit" && !requirePermission("audit.view", "open the Audit Log")) return;
    if (nextView !== view) {
      const nextUrl = urlWithFilter(window.location.href, "view", nextView, "dashboard");
      window.history.pushState(window.history.state, "", nextUrl);
      setView(nextView);
    }
    setSidebarOpen(false);
    setNotificationsOpen(false);
    setProfileOpen(false);
  }

  function resetUrlFilters(names: string[]) {
    const url = new URL(window.location.href);
    names.forEach((name) => url.searchParams.delete(name));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }

  function openCompanyInCompanies(company: Company) {
    setCompanyQuery("");
    setCompanyStatus("All statuses");
    resetUrlFilters(["company_q", "company_status", "company_owner", "company_country", "company_type", "company_priority"]);
    navigate("companies");
    setSelectedCompany(company);
  }

  async function openRecordById(type: string, id: string) {
    try {
      if (!recordsLoadedRef.current) await loadRecords(currentRole === "Admin");
      if (type === "Company") {
        const response = await apiRequest<{ data: ApiRecord }>(`/companies/${id}`);
        setSelectedCompany(mapCompany(response.data));
      } else if (type === "Contact") {
        const response = await apiRequest<{ data: ApiRecord }>(`/contacts/${id}`);
        setSelectedContact(mapContact(response.data));
      } else if (type === "Task") {
        const response = await apiRequest<{ data: ApiRecord }>(`/tasks/${id}`);
        await openTaskDetail(mapTask(response.data), response.data);
      }
    } catch (error) {
      notify(apiMessage(error), "warning");
    }
  }

  function openGlobalResult(result: { type: string; id: string }) {
    void openRecordById(result.type, result.id);
    setGlobalSearch("");
  }

  function handleGlobalSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!globalSearchOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (visibleGlobalResults.length > 0) setGlobalSearchIndex((current) => current < globalSearchPageStart ? globalSearchPageStart : globalSearchPageStart + ((current - globalSearchPageStart + 1) % visibleGlobalResults.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (visibleGlobalResults.length > 0) setGlobalSearchIndex((current) => current < globalSearchPageStart ? globalSearchPageStart + visibleGlobalResults.length - 1 : globalSearchPageStart + ((current - globalSearchPageStart - 1 + visibleGlobalResults.length) % visibleGlobalResults.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setGlobalSearch("");
    }
  }

  function openAuditEntity(event: AuditEvent) {
    const [entityType, id] = event.entity.split(" · ");
    if (["Company", "Contact", "Task"].includes(entityType)) void openRecordById(entityType, id);
    else if (hasPermission(currentRole, "audit.view")) navigate("audit");
  }

  function openNotification(item: AppNotification) {
    updateReadNotificationIds((current) => current.includes(item.id) ? current : [...current, item.id]);
    setNotificationsOpen(false);
    if (item.target === "task") void openRecordById("Task", item.targetId ?? "");
    else if (item.target === "company") void openRecordById("Company", item.targetId ?? "");
    else if (item.target === "contact") void openRecordById("Contact", item.targetId ?? "");
    else if (item.target === "activity") navigate("activity");
    else if (hasPermission(currentRole, "audit.view")) navigate("audit");
  }

  async function addCompany(event: FormEvent<HTMLFormElement>, logoDataUrl = "", onCreated?: (company: Company) => void): Promise<boolean> {
    event.preventDefault();
    if (!requirePermission("company.create", "create companies")) return false;
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const country = String(data.get("country") ?? "").trim();
    const city = String(data.get("city") ?? "").trim();
    const websiteInput = String(data.get("website") ?? "").trim();
    const linkedinInput = String(data.get("linkedin") ?? "").trim();
    const website = normalizeUrl(websiteInput);
    const linkedin = normalizeUrl(linkedinInput);
    const owner = String(data.get("owner") ?? "Andrey Zherebetsky");
    const status = String(data.get("status") ?? RELATIONSHIP_STATUSES[0]);
    const ndaStatus = String(data.get("ndaStatus") ?? NDA_STATUSES[0]) as NdaStatus;
    if (name.length < 2) return setFieldError(form, "name", "Enter at least 2 characters.");
    if (!country) return setFieldError(form, "country", "Country is required.");
    if (websiteInput && !website) return setFieldError(form, "website", "Enter a valid website address.");
    if (linkedinInput && !linkedin) return setFieldError(form, "linkedin", "Enter a valid LinkedIn URL.");
    if (!companyTypeOptions.includes(String(data.get("kind") ?? ""))) return setFieldError(form, "kind", "Select a valid company type.");
    if (!activeClientStatuses.includes(status)) return setFieldError(form, "status", "Select a valid client status.");
    if (!managerOptions.includes(owner)) return setFieldError(form, "owner", "Select an active CJN Manager.");
    if (!NDA_STATUSES.includes(ndaStatus)) return setFieldError(form, "ndaStatus", "Select a valid NDA status.");
    const company: Company = {
      id: "",
      name,
      kind: String(data.get("kind") ?? "Other"),
      country,
      city,
      status,
      contacts: 0,
      lastContact: "—",
      owner,
      createdBy: identity?.name ?? "Unknown user",
      ownerUserEmail: userEmailForName(owner),
      createdByUserEmail: identity?.accountEmail.toLowerCase(),
      website,
      linkedin,
      ndaStatus,
      logoDataUrl: logoDataUrl || undefined,
      description: String(data.get("description") ?? "").trim(),
    };
    try {
      let payload: Record<string, unknown> = companyPayload(company);
      let response: { data: ApiRecord };
      try {
        response = await apiRequest("/companies", { method: "POST", body: JSON.stringify(payload) });
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "possible_duplicate" || !window.confirm(`${error.message}\n\nSave this company anyway?`)) throw error;
        payload = { ...payload, allow_duplicate: true };
        response = await apiRequest("/companies", { method: "POST", body: JSON.stringify(payload) });
      }
      const mapped = mapCompany(response.data);
      setCompanies((current) => [mapped, ...current]);
      // Created from the contact form: hand the company back instead of closing it.
      if (onCreated) onCreated(mapped);
      else setModal(null);
      notify("Company saved");
      return true;
    } catch (error) {
      // An identical company is refused outright: retrying the same form cannot succeed.
      if (error instanceof ApiError && error.code === "company_exists") { notify(error.message, "warning"); return setFieldError(form, "name", error.message); }
      notify(`${apiMessage(error)} Use Try again to resubmit without losing the form.`, "warning");
      return false;
    }
  }

  async function createContact(draft: ContactDraft): Promise<ContactCreationResult> {
    if (!requirePermission("contact.create", "create contacts")) return { error: "Your role cannot create contacts." };
    const firstName = draft.firstName.trim();
    const lastName = draft.lastName?.trim() ?? "";
    const name = [firstName, lastName].filter(Boolean).join(" ");
    const companyId = draft.companyId;
    const email = draft.email?.trim().toLowerCase() ?? "";
    const phone = draft.phone?.trim() ?? "";
    const linkedinInput = draft.linkedin?.trim() ?? "";
    const linkedin = normalizeUrl(linkedinInput);
    const source = draft.source?.trim() ?? "";
    const requestedInitiatorEmail = draft.initiatedByUserEmail?.trim().toLowerCase() ?? "";
    const manualInitiator = draft.initiatedBy?.trim() ?? "";
    const initiatorUser = requestedInitiatorEmail
      ? users.find((user) => user.state === "Active" && user.email.toLowerCase() === requestedInitiatorEmail)
      : undefined;
    const usesSignedInInitiator = !requestedInitiatorEmail && !manualInitiator;
    const initiatedBy = initiatorUser?.name ?? (manualInitiator || (usesSignedInInitiator ? identity?.name ?? "" : ""));
    const initiatedByUserEmail = initiatorUser?.email.toLowerCase() ?? (usesSignedInInitiator ? identity?.accountEmail.toLowerCase() : undefined);
    if (firstName.length < 2) return { field: "firstName", error: "Enter at least 2 characters for the first name." };
    if (!liveCompanies.some((company) => company.id === companyId)) return { field: "companyId", error: "Select an existing company." };
    if (source && !contactSourceOptions.includes(source)) return { field: "source", error: "Select a valid contact source." };
    if (requestedInitiatorEmail && manualInitiator) return { field: "initiatedBy", error: "Choose a CRM user or enter a manual name, not both." };
    if (requestedInitiatorEmail && !initiatorUser) return { field: "initiatedByUserEmail", error: "Select an active CRM user or enter the initiator manually." };
    if (initiatedBy.length < 2) return { field: "initiatedBy", error: "Enter at least 2 characters for the initiator name." };
    if (initiatedBy.length > 120) return { field: "initiatedBy", error: "Keep the initiator name within 120 characters." };
    if (email && !EMAIL_PATTERN.test(email)) return { field: "email", error: "Enter a valid email address." };
    if (linkedinInput && !linkedin) return { field: "linkedin", error: "Enter a valid LinkedIn URL." };
    if (phone && phone !== "—" && !validContactPhones(phone)) return { field: "phone", error: CONTACT_PHONE_ERROR };
    const contact: Contact = {
      id: "",
      companyId,
      name,
      // Keep both parts: re-splitting `name` would turn "Vinjevoll Thrane" into "Vinjevoll".
      firstName,
      lastName,
      position: draft.position?.trim() ?? "",
      email,
      phone,
      contactStatus: draft.contactStatus === "inactive" ? "inactive" : "active",
      linkedin,
      source,
      sourceDetail: draft.sourceDetail?.trim() ?? "",
      referredBy: draft.referredBy?.trim() ?? "",
      owner: identity?.name ?? "Unassigned",
      initiatedBy,
      ownerUserEmail: identity?.accountEmail.toLowerCase(),
      initiatedByUserEmail,
      photoDataUrl: draft.photoDataUrl?.startsWith("data:image/") ? draft.photoDataUrl : undefined,
      businessCardDataUrl: draft.businessCardDataUrl?.startsWith("data:image/") ? draft.businessCardDataUrl : undefined,
      businessCardFileName: draft.businessCardFileName,
      businessCardBackDataUrl: draft.businessCardBackDataUrl?.startsWith("data:image/") ? draft.businessCardBackDataUrl : undefined,
      businessCardBackFileName: draft.businessCardBackFileName,
    };
    if (!["Exhibition / Conference", "Other"].includes(contact.source)) contact.sourceDetail = "";
    if (contact.source !== "Referral (word of mouth)") contact.referredBy = "";
    try {
      let payload: Record<string, unknown> = contactPayload(contact);
      let response: { data: ApiRecord };
      try {
        response = await apiRequest("/contacts", { method: "POST", body: JSON.stringify(payload) });
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "possible_duplicate" || !window.confirm(`${error.message}\n\nSave this contact anyway?`)) throw error;
        payload = { ...payload, allow_duplicate: true };
        response = await apiRequest("/contacts", { method: "POST", body: JSON.stringify(payload) });
      }
      const mapped = mapContact(response.data);
      setContacts((current) => [mapped, ...current]);
      setCompanies((current) => current.map((company) => company.id === mapped.companyId ? { ...company, contacts: company.contacts + 1 } : company));
      notify("Contact saved");
      return { contact: mapped };
    } catch (error) {
      // Identical name in any company: refused outright, so point at the name instead of offering a retry.
      if (error instanceof ApiError && error.code === "contact_exists") return { field: "firstName", error: error.message };
      return { error: apiMessage(error) };
    }
  }

  async function addContact(event: FormEvent<HTMLFormElement>, photoDataUrl = ""): Promise<boolean> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const initiatorChoice = String(data.get("initiatedByUserEmail") ?? "").trim().toLowerCase();
    const result = await createContact({
      companyId: String(data.get("companyId") ?? liveCompanies[0]?.id ?? ""),
      firstName: String(data.get("firstName") ?? ""),
      lastName: String(data.get("lastName") ?? ""),
      position: String(data.get("position") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      contactStatus: String(data.get("contactStatus") ?? "active") === "inactive" ? "inactive" : "active",
      linkedin: String(data.get("linkedin") ?? ""),
      source: String(data.get("source") ?? ""),
      sourceDetail: String(data.get("sourceDetail") ?? ""),
      referredBy: String(data.get("referredBy") ?? ""),
      initiatedBy: initiatorChoice === "manual" ? String(data.get("initiatedBy") ?? "") : undefined,
      initiatedByUserEmail: initiatorChoice === "manual" ? undefined : initiatorChoice,
      photoDataUrl,
      businessCardDataUrl: String(data.get("businessCardDataUrl") ?? ""),
      businessCardFileName: String(data.get("businessCardFileName") ?? ""),
      businessCardBackDataUrl: String(data.get("businessCardBackDataUrl") ?? ""),
      businessCardBackFileName: String(data.get("businessCardBackFileName") ?? ""),
    });
    if (result.error) {
      const field = result.field === "companyId" ? "companyName" : result.field;
      if (!field || !setFieldError(form, field, result.error)) notify(result.error, "warning");
      return false;
    }
    setModal(null);
    setModalCompanyId(undefined);
    return true;
  }

  function recalculateLastContact(companyId: string, nextTasks: Task[], nextArchivedTaskIds = archivedTaskIds) {
    const dates = nextTasks
      .filter((task) => task.companyId === companyId && !nextArchivedTaskIds.includes(task.id))
      .map((task) => task.contactDate ?? "")
      .filter(Boolean)
      .sort();
    const lastContact = dates.at(-1) ?? "—";
    setCompanies((current) => current.map((company) => company.id === companyId ? { ...company, lastContact } : company));
  }

  async function addTask(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    if (!requirePermission("task.create", "create tasks")) return false;
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const task: Task = {
      id: "",
      companyId: String(data.get("companyId") ?? companies[0]?.id),
      parentTaskId: undefined,
      title: String(data.get("title") ?? "").trim(),
      contactDate: String(data.get("contactDate") ?? todayUser()),
      deadline: String(data.get("deadline") ?? ""),
      owner: String(data.get("owner") ?? "Andrey Zherebetsky"),
      createdBy: identity?.name ?? "Unknown user",
      ownerUserEmail: userEmailForName(String(data.get("owner") ?? "Andrey Zherebetsky")),
      createdByUserEmail: identity?.accountEmail.toLowerCase(),
      contactPersonId: String(data.get("contactPersonId") ?? ""),
      status: String(data.get("status") ?? taskStatusOptions[0] ?? "") as Task["status"],
      priority: String(data.get("priority") ?? "Low") as Task["priority"],
      note: String(data.get("note") ?? "").trim(),
      reminderLeads: data.getAll("reminderLeads").map(String),
      participantContactIds: data.getAll("participantContactIds").map(String),
      participantManagers: data.getAll("participantManagers").map(String),
    };
    if (task.title.length < 3) return setFieldError(form, "title", "Enter at least 3 characters.");
    if (!companies.some((company) => company.id === task.companyId)) return setFieldError(form, "companyId", "Select an existing company.");
    if (!managerOptions.includes(task.owner)) return setFieldError(form, "owner", "Select an active CJN Manager.");
    if (!taskStatusOptions.includes(task.status)) return setFieldError(form, "status", "Select a valid task status.");
    if (!TASK_PRIORITIES.includes(task.priority)) return setFieldError(form, "priority", "Select a valid priority.");
    if ((task.reminderLeads ?? []).some((lead) => !reminderLeadOptions.includes(lead))) return setFieldError(form, "reminderLeads", "Select valid reminder notice times.");
    if (!task.contactDate) return setFieldError(form, "contactDate", "Choose the contact date.");
    if (task.contactPersonId && !contacts.some((contact) => contact.id === task.contactPersonId && contact.companyId === task.companyId)) return setFieldError(form, "contactPersonId", "Select a contact from this company.");
    const previousTask = latestCompanyTask(liveTasks, task.companyId);
    if (previousTask && !isCompletedTask(previousTask)) return setFieldError(form, "companyName", `Complete “${previousTask.title}” before creating the next task for this company.`);
    try {
      const response = await apiRequest<{ data: ApiRecord }>("/tasks", { method: "POST", body: JSON.stringify(taskPayload(task)) });
      const mapped = mapTask(response.data);
      const nextTasks = [mapped, ...tasks];
      setTasks(nextTasks);
      recalculateLastContact(mapped.companyId, nextTasks);
      setModal(null);
      setModalCompanyId(undefined);
      setModalParentTaskId(undefined);
      const past = isLocalDateTimePast(mapped.deadline);
      notify(past ? "Task saved. Its past deadline will not generate reminders." : mapped.deadline ? "Task saved. Calendar download is available." : "Task saved.", past ? "warning" : "success");
      return true;
    } catch (error) {
      notify(`${apiMessage(error)} Use Try again to resubmit without losing the form.`, "warning");
      return false;
    }
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    if (!requirePermission("user.manage", "manage users")) return false;
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const user: CRMUser = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim().toLowerCase(),
      role: String(data.get("role") ?? "Editor") as CRMUser["role"],
      state: "Active",
      lastLogin: "Not signed in yet",
    };
    const temporaryPassword = String(data.get("temporaryPassword") ?? "");
    const delivery = String(data.get("delivery") ?? "temporary_password");
    if (user.name.length < 2) return setFieldError(form, "name", "Enter at least 2 characters.");
    if (!EMAIL_PATTERN.test(user.email)) return setFieldError(form, "email", "Enter a valid work email address.");
    if (users.some((item) => item.email.toLowerCase() === user.email)) return setFieldError(form, "email", "A user with this email already exists.");
    if (users.some((item) => item.name.toLowerCase() === user.name.toLowerCase())) return setFieldError(form, "name", "A user with this name already exists.");
    if (!ROLE_ORDER.includes(user.role)) return setFieldError(form, "role", "Select a valid role.");
    if (delivery === "temporary_password" && !isStrongPassword(temporaryPassword)) return setFieldError(form, "temporaryPassword", "Use at least 8 characters with letters and numbers.");
    try {
      const response = await apiRequest<{ data: ApiRecord; warnings?: { mail?: string } }>("/users", { method: "POST", body: JSON.stringify({ full_name: user.name, email: user.email, role: roleToApi(user.role), is_active: true, delivery, temporary_password: delivery === "temporary_password" ? temporaryPassword : undefined }) });
      setUsers((current) => [mapUser(response.data), ...current]);
      setModal(null);
      notify(response.warnings?.mail ?? (delivery === "invite" ? "User created and invitation sent" : "User created with a temporary password"), response.warnings?.mail ? "warning" : "success");
      return true;
    } catch (error) {
      notify(`${apiMessage(error)} Use Try again to resubmit without losing the form.`, "warning");
      return false;
    }
  }

  async function updateCompany(updated: Company): Promise<boolean> {
    if (!requirePermission("company.edit", "edit companies")) return false;
    const existing = companies.find((company) => company.id === updated.id);
    if (existing && existing.status !== updated.status && !requirePermission("pipeline.move", "change relationship status")) return false;
    if (!clientStatusOrder.includes(updated.status)) {
      notify("Select a valid client status.", "warning");
      return false;
    }
    if (updated.name.trim().length < 2) {
      notify("Company name must contain at least 2 characters.", "warning");
      return false;
    }
    if (!lookupValues("company-type", false).includes(updated.kind)) {
      notify("Select a valid company type.", "warning");
      return false;
    }
    if (existing?.owner !== updated.owner && !managerOptions.includes(updated.owner)) {
      notify("Select an active CJN Manager.", "warning");
      return false;
    }
    const normalized = { ...updated, ownerUserEmail: existing?.owner === updated.owner ? existing.ownerUserEmail : userEmailForName(updated.owner) };
    try {
      const payload = companyPayload(normalized);
      let response: { data: ApiRecord };
      try { response = await apiRequest(`/companies/${updated.id}`, { method: "PUT", body: JSON.stringify(payload) }); }
      catch (error) {
        if (!(error instanceof ApiError) || error.code !== "possible_duplicate" || !window.confirm(`${error.message}\n\nSave these changes anyway?`)) throw error;
        response = await apiRequest(`/companies/${updated.id}`, { method: "PUT", body: JSON.stringify({ ...payload, allow_duplicate: true }) });
      }
      const mapped = mapCompany(response.data); setCompanies((current) => current.map((item) => item.id === mapped.id ? mapped : item)); setSelectedCompany((current) => current?.id === mapped.id ? mapped : current); notify("Company profile updated"); return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === "company_exists") { notify(error.message, "warning"); return false; }
      notify(`${apiMessage(error)} Your edits are preserved; try again.`, "warning"); return false;
    }
  }

  async function updateContact(updated: Contact): Promise<boolean> {
    if (!requirePermission("contact.edit", "edit contacts")) return false;
    const existing = contacts.find((contact) => contact.id === updated.id);
    if (updated.name.trim().length < 2 || (updated.email && !EMAIL_PATTERN.test(updated.email))) {
      notify("Enter a valid contact name and email.", "warning");
      return false;
    }
    if (updated.source && !lookupValues("contact-source", false).includes(updated.source)) {
      notify("Select a valid contact source.", "warning");
      return false;
    }
    if (updated.contactStatus !== "active" && updated.contactStatus !== "inactive") {
      notify("Select a valid contact status.", "warning");
      return false;
    }
    if (existing?.owner !== updated.owner && !managerOptions.includes(updated.owner)) {
      notify("Select an active CJN Manager.", "warning");
      return false;
    }
    const normalized = { ...updated, ownerUserEmail: existing?.owner === updated.owner ? existing.ownerUserEmail : userEmailForName(updated.owner) };
    try {
      const payload = contactPayload(normalized);
      let response: { data: ApiRecord };
      try { response = await apiRequest(`/contacts/${updated.id}`, { method: "PUT", body: JSON.stringify(payload) }); }
      catch (error) {
        if (!(error instanceof ApiError) || error.code !== "possible_duplicate" || !window.confirm(`${error.message}\n\nSave these changes anyway?`)) throw error;
        response = await apiRequest(`/contacts/${updated.id}`, { method: "PUT", body: JSON.stringify({ ...payload, allow_duplicate: true }) });
      }
      const mapped = mapContact(response.data); setContacts((current) => current.map((item) => item.id === mapped.id ? mapped : item)); setSelectedContact((current) => current?.id === mapped.id ? mapped : current); notify("Contact updated"); return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === "contact_exists") { notify(error.message, "warning"); return false; }
      notify(`${apiMessage(error)} Your edits are preserved; try again.`, "warning"); return false;
    }
  }

  async function updateTask(updated: Task): Promise<boolean> {
    if (!requirePermission("task.edit", "edit tasks")) return false;
    const existing = tasks.find((task) => task.id === updated.id);
    if (!existing) return false;
    const existingCompany = companies.find((company) => company.id === existing.companyId);
    const destinationCompany = companies.find((company) => company.id === updated.companyId);
    if (existingCompany?.status === "Black List" || destinationCompany?.status === "Black List") {
      notify("Tasks for Black List companies are read-only.", "warning");
      return false;
    }
    if (updated.title.trim().length < 3 || !updated.contactDate) {
      notify("Complete the task title and contact date.", "warning");
      return false;
    }
    if (!taskStatusOptions.includes(updated.status)) {
      notify("Select a valid task status.", "warning");
      return false;
    }
    if (!TASK_PRIORITIES.includes(updated.priority)) {
      notify("Select a valid priority.", "warning");
      return false;
    }
    if (!companies.some((company) => company.id === updated.companyId)) {
      notify("Select an existing company.", "warning");
      return false;
    }
    if (!allManagerOptions.includes(updated.owner) || (existing.owner !== updated.owner && !managerOptions.includes(updated.owner))) {
      notify("Select an active CJN Manager.", "warning");
      return false;
    }
    if ((updated.reminderLeads ?? []).some((lead) => !reminderLeadOptions.includes(lead))) {
      notify("Select valid reminder notice times.", "warning");
      return false;
    }
    if (updated.contactPersonId && !contacts.some((contact) => contact.id === updated.contactPersonId && contact.companyId === updated.companyId)) {
      notify("The contact person must belong to the selected company.", "warning");
      return false;
    }
    const normalized = { ...updated, ownerUserEmail: existing.owner === updated.owner ? existing.ownerUserEmail : userEmailForName(updated.owner) };
    try {
      const { data: saved } = await apiRequest<{ data: ApiRecord }>(`/tasks/${updated.id}`, { method: "PUT", body: JSON.stringify(taskPayload(normalized)) });
      const mapped = mapTask(saved); const nextTasks = tasks.map((item) => item.id === mapped.id ? mapped : item); setTasks(nextTasks); setSelectedTask((current) => current?.id === mapped.id ? mapped : current); recalculateLastContact(existing.companyId, nextTasks); if (mapped.companyId !== existing.companyId) recalculateLastContact(mapped.companyId, nextTasks); notify("Task updated"); return true;
    } catch (error) { notify(`${apiMessage(error)} Your edits are preserved; try again.`, "warning"); return false; }
  }

  async function addTaskComment(taskId: string, text: string): Promise<boolean> {
    if (!requirePermission("task.comment", "comment on tasks")) return false;
    const body = text.trim();
    if (!body || body.length > 2000) {
      notify("Write a comment between 1 and 2,000 characters.", "warning");
      return false;
    }
    try {
      const { data: saved } = await apiRequest<{ data: ApiRecord }>(`/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ text: body }) });
      const mapped: TaskComment = { id: apiString(saved, "id"), taskId: apiString(saved, "task_id"), author: apiString(saved, "author_name"), authorUserId: apiNumber(saved, "author_user_id"), createdAt: formatUserDateTime(apiString(saved, "created_at")), updatedAt: formatUserDateTime(apiString(saved, "updated_at")), text: apiString(saved, "text"), isHidden: apiBoolean(saved, "is_hidden") };
      setTaskComments((current) => [...current, mapped]);
      setTasks((current) => current.map((task) => task.id === taskId ? { ...task, commentCount: (task.commentCount ?? current.filter((item) => item.id === taskId).length) + 1 } : task));
      notify("Comment posted");
      return true;
    } catch (error) {
      notify(`${apiMessage(error)} The comment text is preserved; try again.`, "warning");
      return false;
    }
  }

  async function setCommentHidden(taskId: string, commentId: string, hidden: boolean) {
    try {
      await apiRequest(`/tasks/${taskId}/comments/${commentId}`, { method: "PATCH", body: JSON.stringify({ hidden }) });
      setTaskComments((current) => current.map((comment) => comment.id === commentId ? { ...comment, isHidden: hidden } : comment));
      notify(hidden ? "Comment hidden" : "Comment restored");
    } catch (error) { notify(apiMessage(error), "warning"); }
  }

  async function updateTaskComment(taskId: string, commentId: string, text: string): Promise<boolean> {
    const body = text.trim();
    if (!body || body.length > 2000) return false;
    try {
      const { data: saved } = await apiRequest<{ data: ApiRecord }>(`/tasks/${taskId}/comments/${commentId}`, { method: "PUT", body: JSON.stringify({ text: body }) });
      setTaskComments((current) => current.map((comment) => comment.id === commentId ? { ...comment, text: apiString(saved, "text"), updatedAt: formatUserDateTime(apiString(saved, "updated_at")) } : comment));
      notify("Comment updated");
      return true;
    } catch (error) {
      notify(apiMessage(error), "warning");
      return false;
    }
  }

  async function uploadTaskAttachment(taskId: string, file: File): Promise<boolean> {
    const body = new FormData();
    body.set("file", file);
    try {
      const { data } = await apiRequest<{ data: ApiRecord }>(`/tasks/${taskId}/attachments`, { method: "POST", body }, "", 120_000);
      setTaskAttachments((current) => [...current, { id: Number(data.id), taskId: apiString(data, "task_id"), name: apiString(data, "original_name"), mimeType: apiString(data, "mime_type"), sizeBytes: Number(data.size_bytes ?? 0), authorUserId: Number(data.author_user_id), author: apiString(data, "author_name"), createdAt: formatUserDateTime(apiString(data, "created_at")) }]);
      notify("Attachment uploaded");
      return true;
    } catch (error) { notify(apiMessage(error), "warning"); return false; }
  }

  async function downloadTaskAttachment(attachment: TaskAttachment) {
    try {
      const { blob } = await apiDownload(`/tasks/${attachment.taskId}/attachments/${attachment.id}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = attachment.name; link.click(); URL.revokeObjectURL(url);
    } catch (error) { notify(apiMessage(error), "warning"); }
  }

  async function downloadTaskIcs(task: Task) {
    if (task.id.startsWith("tmp-")) return;
    try {
      const { blob } = await apiDownload(`/tasks/${task.id}/reminder.ics`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `task-${task.id}.ics`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(apiMessage(error), "warning");
    }
  }

  async function deleteTaskAttachment(attachment: TaskAttachment) {
    if (!window.confirm(`Delete ${attachment.name}?`)) return;
    try {
      await apiRequest(`/tasks/${attachment.taskId}/attachments/${attachment.id}`, { method: "DELETE" });
      setTaskAttachments((current) => current.filter((item) => item.id !== attachment.id));
      notify("Attachment deleted");
    } catch (error) { notify(apiMessage(error), "warning"); }
  }

  function archiveCompany(company: Company) {
    if (!requirePermission("record.archive", "archive records")) return;
    if (liveTasks.some((task) => task.companyId === company.id && isOpenTask(task))) {
      notify("Close all open tasks before archiving this company.", "warning");
      return;
    }
    setArchivedCompanyIds((current) => [...current, company.id]);
    setSelectedCompany(null);
    notify("Company archived");
    void apiRequest(`/companies/${company.id}/archive`, { method: "POST", body: JSON.stringify({ archived: true, updated_at: company.updatedAt }) }).then(() => loadWorkspace()).catch(reportServerError);
  }

  function archiveContact(contact: Contact) {
    if (!requirePermission("record.archive", "archive records")) return;
    setArchivedContactIds((current) => [...current, contact.id]);
    setSelectedContact(null);
    notify("Contact archived");
    void apiRequest(`/contacts/${contact.id}/archive`, { method: "POST", body: JSON.stringify({ archived: true, updated_at: contact.updatedAt }) }).then(() => loadWorkspace()).catch(reportServerError);
  }

  function archiveTask(task: Task) {
    if (!requirePermission("record.archive", "archive records")) return;
    const nextArchived = [...archivedTaskIds, task.id];
    setArchivedTaskIds(nextArchived);
    setSelectedTask(null);
    recalculateLastContact(task.companyId, tasks, nextArchived);
    notify("Task archived");
    void apiRequest(`/tasks/${task.id}/archive`, { method: "POST", body: JSON.stringify({ archived: true, updated_at: task.updatedAt }) }).then(() => loadWorkspace()).catch(reportServerError);
  }

  function restoreRecord(entity: "Company" | "Contact" | "Task", id: string) {
    if (!requirePermission("record.archive", "restore records")) return;
    if (entity === "Company") setArchivedCompanyIds((current) => current.filter((item) => item !== id));
    if (entity === "Contact") setArchivedContactIds((current) => current.filter((item) => item !== id));
    if (entity === "Task") {
      const nextArchived = archivedTaskIds.filter((item) => item !== id);
      setArchivedTaskIds(nextArchived);
      const task = tasks.find((item) => item.id === id);
      if (task) recalculateLastContact(task.companyId, tasks, nextArchived);
    }
    notify(`${entity} restored`);
    const record = entity === "Company" ? companies.find((item) => item.id === id) : entity === "Contact" ? contacts.find((item) => item.id === id) : tasks.find((item) => item.id === id);
    const resource = entity === "Company" ? "companies" : entity === "Contact" ? "contacts" : "tasks";
    void apiRequest(`/${resource}/${id}/archive`, { method: "POST", body: JSON.stringify({ archived: false, updated_at: record?.updatedAt }) }).then(() => loadWorkspace()).catch(reportServerError);
  }

  function addLookupValue(type: string, value: string) {
    if (!requirePermission("lookup.manage", "manage Lookups")) return false;
    const clean = value.trim();
    const group = lookups.find((item) => item.type === type);
    if (!group || !clean || group.items.some((item) => item.value.toLowerCase() === clean.toLowerCase())) {
      notify("Enter a unique lookup option.", "warning");
      return false;
    }
    setLookups((current) => current.map((item) => item.type === type ? { ...item, items: [...item.items, { id: `${type}-${Date.now()}`, value: clean, active: true }] } : item));
    notify("Lookup option is being saved");
    void apiRequest(`/lookups/${lookupTypeToApi(type)}`, { method: "POST", body: JSON.stringify({ value: clean }) }).then(() => loadWorkspace()).then(() => notify("Lookup option added")).catch(reportServerError);
    return true;
  }

  function renameLookupValue(type: string, id: string, value: string) {
    if (!requirePermission("lookup.manage", "manage Lookups")) return false;
    const clean = value.trim();
    const group = lookups.find((item) => item.type === type);
    const existing = group?.items.find((item) => item.id === id);
    if (!group || !existing || !clean || group.items.some((item) => item.id !== id && item.value.toLowerCase() === clean.toLowerCase())) {
      notify("Enter a unique lookup option.", "warning");
      return false;
    }
    setLookups((current) => current.map((item) => item.type === type ? { ...item, items: item.items.map((lookup) => lookup.id === id ? { ...lookup, value: clean } : lookup) } : item));
    if (type === "client-status") {
      setCompanies((current) => current.map((company) => company.status === existing.value ? { ...company, status: clean } : company));
      setCompanyStatus((current) => current === existing.value ? clean : current);
    }
    if (type === "company-type") setCompanies((current) => current.map((company) => company.kind === existing.value ? { ...company, kind: clean } : company));
    if (type === "contact-source") setContacts((current) => current.map((contact) => contact.source === existing.value ? { ...contact, source: clean } : contact));
    if (type === "task-status") setTasks((current) => current.map((task) => task.status === existing.value ? { ...task, status: clean } : task));
    if (type === "outcome-status") setTasks((current) => current.map((task) => task.outcomeStatus === existing.value ? { ...task, outcomeStatus: clean } : task));
    if (type === "cjn-manager") {
      setCompanies((current) => current.map((company) => company.owner === existing.value ? { ...company, owner: clean } : company));
      setContacts((current) => current.map((contact) => contact.owner === existing.value ? { ...contact, owner: clean } : contact));
      setTasks((current) => current.map((task) => task.owner === existing.value ? { ...task, owner: clean } : task));
    }
    notify("Lookup option is being saved");
    void apiRequest(`/lookups/${lookupTypeToApi(type)}/${id}`, { method: "PUT", body: JSON.stringify({ value: clean, updated_at: existing.updatedAt }) }).then(() => loadWorkspace()).then(() => notify("Lookup option renamed")).catch(reportServerError);
    return true;
  }

  function toggleLookupValue(type: string, id: string) {
    if (!requirePermission("lookup.manage", "manage Lookups")) return;
    const group = lookups.find((item) => item.type === type);
    const item = group?.items.find((lookup) => lookup.id === id);
    if (!group || !item) return;
    if (item.active && group.items.filter((lookup) => lookup.active).length <= 1) return notify("Keep at least one active option in each lookup.", "warning");
    setLookups((current) => current.map((lookupGroup) => lookupGroup.type === type ? { ...lookupGroup, items: lookupGroup.items.map((lookup) => lookup.id === id ? { ...lookup, active: !lookup.active } : lookup) } : lookupGroup));
    notify(item.active ? "Lookup option deactivated" : "Lookup option activated");
    void apiRequest(`/lookups/${lookupTypeToApi(type)}/${id}`, { method: "PUT", body: JSON.stringify({ is_active: !item.active, updated_at: item.updatedAt }) }).then(() => loadWorkspace()).catch(reportServerError);
  }

  function moveLookupValue(type: string, id: string, direction: -1 | 1) {
    if (!requirePermission("lookup.manage", "manage Lookups")) return;
    setLookups((current) => current.map((group) => {
      if (group.type !== type) return group;
      const index = group.items.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= group.items.length) return group;
      const items = [...group.items];
      [items[index], items[target]] = [items[target], items[index]];
      return { ...group, items };
    }));
    const group = lookups.find((item) => item.type === type);
    const index = group?.items.findIndex((item) => item.id === id) ?? -1;
    const target = index + direction;
    if (!group || index < 0 || target < 0 || target >= group.items.length) return;
    const reordered = [...group.items];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    void Promise.all(reordered.map((item, sortOrder) => apiRequest(`/lookups/${lookupTypeToApi(type)}/${item.id}`, { method: "PUT", body: JSON.stringify({ sort_order: sortOrder + 1, updated_at: item.updatedAt }) }))).then(() => loadWorkspace()).catch(reportServerError);
  }

  async function updateUser(updated: CRMUser, temporaryPassword = "", resetDelivery: "temporary_password" | "invite" = "temporary_password"): Promise<boolean> {
    if (!requirePermission("user.manage", "change user access")) return false;
    if (!ROLE_ORDER.includes(updated.role) || !["Active", "Inactive", "Pending"].includes(updated.state)) {
      notify("Invalid role or account status.", "warning");
      return false;
    }
    if (temporaryPassword && !isStrongPassword(temporaryPassword)) {
      notify("Temporary password must contain at least 8 characters with letters and numbers.", "warning");
      return false;
    }
    const currentUser = users.find((user) => user.email === updated.email);
    const activeAdmins = users.filter((user) => user.role === "Admin" && user.state === "Active").length;
    if (currentUser?.role === "Admin" && currentUser.state === "Active" && (updated.role !== "Admin" || updated.state !== "Active") && activeAdmins <= 1) {
      notify("Keep at least one active administrator in the workspace.", "warning");
      return false;
    }
    if (updated.email.toLowerCase() === identity?.accountEmail.toLowerCase() && updated.state === "Inactive") {
      notify("You cannot deactivate your own account.", "warning");
      return false;
    }
    try {
      if (!updated.id) throw new Error("User id is missing.");
      if (currentUser?.state === "Pending" && updated.state === "Active") {
        await apiRequest(`/users/${updated.id}/approve`, { method: "POST", body: JSON.stringify({ role: roleToApi(updated.role) }) });
      } else {
        await apiRequest(`/users/${updated.id}`, { method: "PUT", body: JSON.stringify({ full_name: updated.name, role: roleToApi(updated.role), is_active: updated.state === "Active", updated_at: updated.updatedAt }) });
      }
      if (temporaryPassword || resetDelivery === "invite") await apiRequest(`/users/${updated.id}/reset-password`, { method: "POST", body: JSON.stringify({ delivery: resetDelivery, temporary_password: resetDelivery === "temporary_password" ? temporaryPassword : undefined }) });
      await loadWorkspace();
      notify("User permissions updated");
      return true;
    } catch (error) {
      notify(`${apiMessage(error)} Use Try again to resubmit without losing the form.`, "warning");
      return false;
    }
  }

  async function rejectUser(user: CRMUser): Promise<boolean> {
    if (!user.id || user.state !== "Pending" || !window.confirm(`Reject the registration for ${user.email}?`)) return false;
    try {
      await apiRequest(`/users/${user.id}`, { method: "DELETE" });
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setSelectedUser(null);
      notify("Pending registration rejected");
      return true;
    } catch (error) {
      notify(apiMessage(error), "warning");
      return false;
    }
  }

  function openContactForm(companyId?: string) {
    if (!requirePermission("contact.create", "create contacts")) return;
    setModalCompanyId(companyId);
    setModal("contact");
  }

  function openTaskForm(companyId?: string) {
    if (!requirePermission("task.create", "create tasks")) return;
    const previousTask = companyId ? latestCompanyTask(liveTasks, companyId) : undefined;
    if (previousTask && !isCompletedTask(previousTask)) {
      notify(`Complete “${previousTask.title}” before creating the next task for this company.`, "warning");
      return;
    }
    setModalCompanyId(companyId);
    setModalParentTaskId(undefined);
    setModal("task");
  }

  function updateTaskStatus(task: Task, nextStatus: Task["status"]) {
    if (!requirePermission("task.edit", "update task status")) return;
    if (companies.find((company) => company.id === task.companyId)?.status === "Black List") {
      notify("Tasks for Black List companies are read-only.", "warning");
      return;
    }
    if (!taskStatusOptions.includes(nextStatus)) return notify("Select a valid task status.", "warning");
    if (task.status === nextStatus) return;
    const updated = { ...task, status: nextStatus };
    setTasks((items) => items.map((item) => item.id === task.id ? updated : item));
    setSelectedTask(updated);
    notify(`Task status changed to ${nextStatus}`);
    void apiRequest(`/tasks/${task.id}`, { method: "PUT", body: JSON.stringify(taskPayload(updated)) }).then(() => loadWorkspace()).catch(reportServerError);
  }

  function updateProfile(nextIdentity: AuthIdentity, currentPassword: string, newPassword: string) {
    if (!identity) return "Sign in again before changing the profile.";
    const emailChanged = identity.accountEmail.toLowerCase() !== nextIdentity.email.toLowerCase();
    if ((emailChanged || newPassword) && !currentPassword) return "Enter your current password to change email or password.";
    setIdentity({ ...nextIdentity, email: nextIdentity.email.toLowerCase(), accountEmail: nextIdentity.email.toLowerCase(), role: identity.role, method: "Email" });
    setModal(null);
    notify("Profile is being saved");
    void (async () => {
      await apiRequest("/profile", { method: "PUT", body: JSON.stringify({ full_name: nextIdentity.name, email: nextIdentity.email, phone: nextIdentity.phone || null, ...(nextIdentity.photoDataUrl?.startsWith("/api/") ? {} : { photo_data_url: nextIdentity.photoDataUrl || null }), current_password: currentPassword || undefined }) });
      if (newPassword) await apiRequest("/profile/password", { method: "PUT", body: JSON.stringify({ current_password: currentPassword, password: newPassword, password_confirmation: newPassword }) });
      await loadWorkspace();
      notify(newPassword ? "Profile and password updated" : "Profile updated");
    })().catch(reportServerError);
    return null;
  }

  async function updatePreferences(nextPreferences: Preferences, nextSystemSettings?: SystemSettings): Promise<boolean> {
    if (notificationAccountKey) setPreferencesByAccount((current) => ({ ...current, [notificationAccountKey]: nextPreferences }));
    try {
      if (currentRole === "Admin" && nextSystemSettings) {
        const response = await apiRequest<{ data: ApiRecord }>("/settings", { method: "PUT", body: JSON.stringify({ system_notification_email: nextSystemSettings.systemNotificationEmail || null, notify_new_registrations: nextSystemSettings.notifyNewRegistrations, registration_allowed_domains: nextSystemSettings.registrationAllowedDomains }) });
        setSystemSettings({ systemNotificationEmail: apiString(response.data, "system_notification_email"), notifyNewRegistrations: apiBoolean(response.data, "notify_new_registrations"), registrationAllowedDomains: Array.isArray(response.data.registration_allowed_domains) ? response.data.registration_allowed_domains.map(String) : [] });
      }
      setModal(null);
      notify("Settings saved");
      return true;
    } catch (error) {
      notify(`${apiMessage(error)} Your entries are preserved; try again.`, "warning");
      return false;
    }
  }

  async function openSettings() {
    if (currentRole === "Admin") {
      try {
        const response = await apiRequest<{ data: ApiRecord }>("/settings");
        setSystemSettings({ systemNotificationEmail: apiString(response.data, "system_notification_email"), notifyNewRegistrations: apiBoolean(response.data, "notify_new_registrations"), registrationAllowedDomains: Array.isArray(response.data.registration_allowed_domains) ? response.data.registration_allowed_domains.map(String) : [] });
      } catch (error) {
        notify(apiMessage(error), "warning");
        return;
      }
    }
    setModal("settings");
  }

  async function changeRequiredPassword(currentPassword: string, newPassword: string) {
    try {
      await apiRequest("/profile/password", { method: "PUT", body: JSON.stringify({ current_password: currentPassword, password: newPassword, password_confirmation: newPassword }) });
      await loadWorkspace();
      notify("Password changed successfully");
      return null;
    } catch (error) {
      return apiMessage(error);
    }
  }

  if (passwordResetToken && typeof window !== "undefined" && window.location.pathname === "/reset-password") return <PasswordResetScreen token={passwordResetToken} />;
  if (sessionLoading) return <main className="auth-page"><div className="auth-message" role="status">Connecting to CRM…</div></main>;
  if (identity && passwordChangeRequired) return <PasswordChangeScreen identity={identity} onChange={changeRequiredPassword} onSignOut={signOut} signingOut={signingOut} />;
  if (!identity) return <AuthScreen onLogin={authenticate} onRegister={registerAccount} onRecover={recoverAccount} />;

  const navPrimary: View[] = ["dashboard", "companies", "contacts", "activity"];
  const navAdmin: View[] = [
    ...(hasPermission(currentRole, "lookup.manage") ? ["lookups" as View] : []),
    ...(hasPermission(currentRole, "user.manage") ? ["users" as View] : []),
    ...(hasPermission(currentRole, "audit.view") ? ["audit" as View] : []),
  ];
  const retryRecords = () => { void loadRecords(currentRole === "Admin").catch((error) => notify(apiMessage(error), "warning")); };
  const recordLoadState = (label: string) => <div className="auth-message" role="status">{recordsError ? <>Could not load {label}: {recordsError} <button type="button" onClick={retryRecords}>Retry</button></> : `Loading ${label}…`}</div>;

  return (
    <DraftScopeContext.Provider value={draftScope}>
    <div className="crm-app">
      <header className="topbar">
        <button ref={mobileMenuButtonRef} className="topbar-icon mobile-menu-button" type="button" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? "Close menu" : "Open menu"} aria-expanded={sidebarOpen} aria-controls="main-navigation">☰</button>
        <button className="brand" type="button" onClick={() => navigate("dashboard")} aria-label="Client Data CRM — Dashboard">
          <span className="brand-mark">C</span>
          <span className="brand-copy"><b>Client Data</b><small>CRM workspace</small></span>
        </button>
        <div className="global-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={globalSearch}
            onChange={(event) => { const value = event.target.value; setGlobalSearch(value); setGlobalResults([]); setGlobalSearchIndex(-1); setGlobalSearchPage(1); }}
            onKeyDown={handleGlobalSearchKeyDown}
            placeholder="Search companies, contacts, activities…"
            aria-label="Global search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={globalSearchOpen}
            aria-controls="global-search-results"
            aria-activedescendant={activeGlobalSearchIndex >= 0 ? `global-search-option-${activeGlobalSearchIndex}` : undefined}
          />
          {globalSearchOpen && (
            <div className="search-results">
              <p id="global-search-label">Search results · {globalResults.length}</p>
              <div id="global-search-results" role="listbox" aria-labelledby="global-search-label">
              {(["Company", "Contact", "Task"] as const).map((type) => {
                const matches = visibleGlobalResults.filter((result) => result.type === type);
                if (matches.length === 0) return null;
                const totalMatches = globalResults.filter((result) => result.type === type).length;
                return <section className="search-result-group" key={type} aria-label={`${type} results`}><h3>{type === "Company" ? "Companies" : `${type}s`} <span>{totalMatches}</span></h3>{matches.map((result) => {
                  const index = globalResults.indexOf(result);
                  return <button id={`global-search-option-${index}`} key={`${result.type}-${result.id}`} type="button" role="option" tabIndex={-1} aria-selected={activeGlobalSearchIndex === index} onMouseEnter={() => setGlobalSearchIndex(index)} onClick={() => openGlobalResult(result)}>
                    <span className="result-type">{result.type.slice(0, 1)}</span>
                    <span><b>{result.label}</b><small>{result.meta}</small></span>
                  </button>;
                })}</section>;
              })}
              {globalResults.length === 0 && <button type="button" role="option" aria-selected="false" disabled>{recordsError ? "Search unavailable" : recordsLoading || !recordsLoadedRef.current ? "Loading search index…" : "No matches found"}</button>}
              </div>
              {recordsError && <button type="button" onClick={retryRecords}>Retry search</button>}
              {globalResults.length > GLOBAL_SEARCH_PAGE_SIZE && <nav className="search-pagination" aria-label="Search result pages"><button type="button" aria-label="Previous search page" disabled={currentGlobalSearchPage === 1} onClick={() => { setGlobalSearchPage((page) => Math.max(1, page - 1)); setGlobalSearchIndex(-1); }}>‹</button>{Array.from({ length: globalSearchPageCount }, (_, index) => index + 1).map((page) => <button className={page === currentGlobalSearchPage ? "active" : ""} type="button" key={page} aria-current={page === currentGlobalSearchPage ? "page" : undefined} onClick={() => { setGlobalSearchPage(page); setGlobalSearchIndex(-1); }}>{page}</button>)}<button type="button" aria-label="Next search page" disabled={currentGlobalSearchPage === globalSearchPageCount} onClick={() => { setGlobalSearchPage((page) => Math.min(globalSearchPageCount, page + 1)); setGlobalSearchIndex(-1); }}>›</button></nav>}
            </div>
          )}
        </div>
        <div className="topbar-actions" ref={topbarActionsRef}>
          <div className="date-chip"><span>●</span> {userWeekQuarter()} · {todayUser()} · {CLIENT_TIME_ZONE_LABEL}</div>
          <button
            ref={notificationButtonRef}
            className={`topbar-icon notification-button${notificationsOpen ? " active" : ""}`}
            type="button"
            aria-label={recordsLoadedRef.current ? `Notifications, ${unreadNotifications.length} unread` : "Notifications, load to view"}
            aria-expanded={notificationsOpen}
            aria-controls="notifications-popover"
            onClick={() => { setNotificationsOpen((open) => !open); setProfileOpen(false); }}
          >♢{recordsLoadedRef.current && unreadNotifications.length > 0 && <span>{unreadNotifications.length}</span>}</button>
          <button
            ref={profileButtonRef}
            className={`profile-button${profileOpen ? " active" : ""}`}
            type="button"
            aria-label="User profile"
            aria-expanded={profileOpen}
            aria-controls="profile-popover"
            onClick={() => { setProfileOpen((open) => !open); setNotificationsOpen(false); }}
          >
            <Avatar name={identity.name} src={identity.photoDataUrl} />
            <span className="profile-copy"><b>{identity.name}</b><small>{identity.role} · email</small></span>
          </button>
          {notificationsOpen && (
            <div className="topbar-popover notifications-popover" id="notifications-popover" role="dialog" aria-label="Notifications">
              <div className="popover-heading"><div><b>Notifications</b><small>{recordsError ? "Notifications unavailable" : !recordsLoadedRef.current ? "Loading notifications…" : unreadNotifications.length === 0 ? "You're all caught up" : `${unreadNotifications.length} ${unreadNotifications.length === 1 ? "item needs" : "items need"} attention`}</small></div><button type="button" disabled={!recordsLoadedRef.current || unreadNotifications.length === 0} onClick={() => { updateReadNotificationIds((current) => Array.from(new Set([...current, ...notifications.map((item) => item.id)]))); notify("All notifications marked as read"); }}>Mark all as read</button></div>
              <div className="notification-logic"><b>Only activity connected to you</b><small>Unread items from tasks you own or created, records you manage, their changes, and your activity summary. The list is capped at 10.</small></div>
              <div className="notification-list">
                {notifications.map((item) => {
                  const isRead = readNotificationIds.includes(item.id);
                  return <button type="button" className={`notification-item${isRead ? " read" : ""}`} key={item.id} onClick={() => openNotification(item)}><span className={`notification-icon ${item.kind}`}>{item.kind === "overdue" ? "!" : item.kind === "update" ? "↻" : "✓"}</span><span><b>{item.title}</b><small>{item.detail}</small></span>{!isRead && <i className="unread-dot" aria-label="Unread" />}</button>;
                })}
                {notifications.length === 0 && <div className="notification-empty" role="status"><b>{recordsError ? "Could not load notifications" : recordsLoadedRef.current ? "No notifications" : "Loading notifications…"}</b><small>{recordsError ? recordsError : recordsLoadedRef.current ? "New tasks and record changes will appear here." : "Fetching your CRM activity."}</small>{recordsError && <button type="button" onClick={retryRecords}>Retry</button>}</div>}
              </div>
              <button type="button" className="popover-footer-button" onClick={() => navigate("activity")}>Open Activity →</button>
            </div>
          )}
          {profileOpen && (
            <div className="topbar-popover profile-popover" id="profile-popover" role="dialog" aria-label="Profile menu">
              <div className="profile-popover-user"><Avatar name={identity.name} src={identity.photoDataUrl} /><span><b>{identity.name}</b><a href={`mailto:${identity.email}`}>{identity.email}</a><small>{identity.role} · signed in by email</small></span></div>
              <button type="button" onClick={() => { setProfileOpen(false); setModal("profile"); }}><span>◎</span><span><b>My profile</b><small>Contact details and role</small></span></button>
              <button type="button" onClick={() => { setProfileOpen(false); void openSettings(); }}><span>⚙</span><span><b>Settings</b><small>Notifications{currentRole === "Admin" ? ", registration, and email" : ""}</small></span></button>
              {canViewAudit && <button type="button" onClick={() => { setProfileOpen(false); navigate("audit"); }}><span>↻</span><span><b>My activity</b><small>Recent changes in the Audit Log</small></span></button>}
              <button className="profile-signout" type="button" onClick={() => { void signOut(); }} disabled={signingOut}><span>↪</span><span><b>{signingOut ? "Signing out…" : "Sign out"}</b><small>{signingOut ? "Closing the server session" : "Return to the sign-in screen"}</small></span></button>
            </div>
          )}
        </div>
      </header>

      <div className="app-shell">
        <aside ref={sidebarRef} id="main-navigation" className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Main navigation" aria-hidden={isMobileNavigation && !sidebarOpen ? true : undefined} inert={isMobileNavigation && !sidebarOpen}>
          <div className="sidebar-mobile-head">
            <span>Navigation</span>
            <button ref={sidebarCloseButtonRef} className="icon-button dark" type="button" onClick={() => { setSidebarOpen(false); window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus()); }} aria-label="Close menu">×</button>
          </div>
          <nav>
            <p className="nav-section">Main</p>
            {navPrimary.map((item) => (
              <button key={item} className={view === item ? "active" : ""} type="button" onClick={() => navigate(item)}>
                <span className="nav-icon">{VIEW_META[item].icon}</span>
                <span>{VIEW_META[item].label}</span>
              </button>
            ))}
            {navAdmin.length > 0 && <p className="nav-section nav-admin">Administration</p>}
            {navAdmin.map((item) => (
              <button key={item} className={view === item ? "active" : ""} type="button" onClick={() => navigate(item)}>
                <span className="nav-icon">{VIEW_META[item].icon}</span>
                <span>{VIEW_META[item].label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <span className="sync-dot" />
            <div><b>Workspace ready</b><small>{CLIENT_TIME_ZONE_LABEL}</small></div>
          </div>
        </aside>
        {sidebarOpen && <button className="sidebar-scrim" type="button" tabIndex={-1} onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}

        <main className="main-content">
          <div className="page-topline">
            <div>
              <p className="eyebrow">{VIEW_META[view].eyebrow}</p>
              <h1>{VIEW_META[view].label}</h1>
            </div>
          </div>

          {forbiddenAdminView ? <section className="empty-state forbidden-state" role="alert"><b>403 · Access forbidden</b><span>This administration section is available only to Admin users.</span><button className="primary-button" type="button" onClick={() => navigate("dashboard")}>Return to Dashboard</button></section> : <>
          {view === "dashboard" && (
            <Dashboard
              summary={dashboardSummary}
              audit={audit}
              canViewAudit={canViewAudit}
              identity={identity}
              openAuditEntity={openAuditEntity}
              openCompanies={() => { setCompanyQuery(""); setCompanyStatus("All statuses"); resetUrlFilters(["company_q", "company_status", "company_owner", "company_country", "company_type", "company_priority"]); navigate("companies"); }}
              openContacts={() => { setContactQuery(""); resetUrlFilters(["contact_q", "contact_source", "contact_initiator", "contact_company", "contact_linkedin"]); navigate("contacts"); }}
              openTaskList={(filter) => { setTaskManagerFilter("All managers"); setTaskFilter(filter); navigate("activity"); }}
              openCompaniesForStatus={(status) => { setCompanyQuery(""); resetUrlFilters(["company_q", "company_status", "company_owner", "company_country", "company_type", "company_priority"]); setCompanyStatus(status); navigate("companies"); }}
              openTasksForManager={(manager) => { setTaskManagerFilter(manager); setTaskFilter("All"); navigate("activity"); }}
            />
          )}
          {view === "companies" && !recordsLoadedRef.current && recordLoadState("companies")}
          {view === "companies" && recordsLoadedRef.current && (
            <Companies
              companies={filteredCompanies}
              tasks={liveTasks}
              query={companyQuery}
              setQuery={setCompanyQuery}
              status={companyStatus}
              setStatus={setCompanyStatus}
              contactCounts={contactCountsByCompany}
              statusOptions={clientStatusOrder}
              showInternalIds={currentRole === "Admin"}
              canCreate={hasPermission(currentRole, "company.create")}
              canEdit={hasPermission(currentRole, "company.edit")}
              managerOptions={managerOptions}
              updateCompany={updateCompany}
              updateTask={updateTask}
              openCompanyContacts={(companyId) => {
                setContactQuery("");
                resetUrlFilters(["contact_q", "contact_source", "contact_initiator", "contact_company", "contact_linkedin"]);
                const nextUrl = urlWithFilter(window.location.href, "contact_company", companyId, "All companies");
                window.history.replaceState(window.history.state, "", nextUrl);
                navigate("contacts");
                window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
              }}
              openCompany={setSelectedCompany}
              add={() => { if (requirePermission("company.create", "create companies")) setModal("company"); }}
            />
          )}
          {view === "contacts" && !recordsLoadedRef.current && recordLoadState("contacts")}
          {view === "contacts" && recordsLoadedRef.current && (
            <Contacts
              contacts={filteredContacts}
              companies={liveCompanies}
              query={contactQuery}
              setQuery={setContactQuery}
              canCreate={hasPermission(currentRole, "contact.create")}
              add={() => openContactForm()}
              openCompany={setSelectedCompany}
              openContact={setSelectedContact}
            />
          )}
          {view === "activity" && !recordsLoadedRef.current && recordLoadState("tasks")}
          {view === "activity" && recordsLoadedRef.current && (
            <Activity
              tasks={liveTasks}
              companies={liveCompanies}
              filter={taskFilter}
              setFilter={setTaskFilter}
              managerFilter={taskManagerFilter}
              setManagerFilter={setTaskManagerFilter}
              showTaskIds={currentRole === "Admin"}
              comments={taskComments}
              taskStatusOptions={taskStatusOptions}
              canCreate={hasPermission(currentRole, "task.create")}
              canCreateContact={hasPermission(currentRole, "contact.create")}
              add={() => openTaskForm()}
              addContact={() => openContactForm()}
              openTask={openTaskDetail}
              openCompany={openCompanyInCompanies}
            />
          )}
          {view === "lookups" && hasPermission(currentRole, "lookup.manage") && !recordsLoadedRef.current && recordLoadState("archived records")}
          {view === "lookups" && hasPermission(currentRole, "lookup.manage") && recordsLoadedRef.current && <Lookups groups={administrationLookups} archivedRecords={[
            ...companies.filter((company) => archivedCompanyIds.includes(company.id)).map((company) => ({ entity: "Company" as const, id: company.id, label: company.name })),
            ...contacts.filter((contact) => archivedContactIds.includes(contact.id)).map((contact) => ({ entity: "Contact" as const, id: contact.id, label: contact.name })),
            ...tasks.filter((task) => archivedTaskIds.includes(task.id)).map((task) => ({ entity: "Task" as const, id: task.id, label: task.title })),
          ]} restoreRecord={restoreRecord} addValue={addLookupValue} renameValue={renameLookupValue} toggleValue={toggleLookupValue} moveValue={moveLookupValue} />}
          {view === "users" && hasPermission(currentRole, "user.manage") && <Users users={users} invite={() => { if (requirePermission("user.manage", "manage users")) setModal("user"); }} openUser={setSelectedUser} />}
          {view === "audit" && hasPermission(currentRole, "audit.view") && <Audit events={audit} users={users} canExport={hasPermission(currentRole, "audit.export")} />}
          </>}
        </main>
      </div>

      {selectedCompany && (
        <CompanyDetail
          key={`${selectedCompany.id}-${currentRole}`}
          company={companies.find((company) => company.id === selectedCompany.id) ?? selectedCompany}
          contacts={liveContacts.filter((contact) => contact.companyId === selectedCompany.id)}
          tasks={liveTasks.filter((task) => task.companyId === selectedCompany.id)}
          countries={countries}
          showInternalIds={currentRole === "Admin"}
          onClose={() => setSelectedCompany(null)}
          openTask={(task) => { setSelectedCompany(null); void openTaskDetail(task); }}
          openContact={(contact) => { setSelectedCompany(null); setSelectedContact(contact); }}
          updateCompany={updateCompany}
          canEdit={hasPermission(currentRole, "company.edit")}
          canMovePipeline={hasPermission(currentRole, "pipeline.move")}
          canAddContact={hasPermission(currentRole, "contact.create")}
          canAddTask={hasPermission(currentRole, "task.create")}
          canArchive={hasPermission(currentRole, "record.archive")}
          archive={() => archiveCompany(selectedCompany)}
          statusOptions={activeClientStatuses}
          companyTypeOptions={companyTypeOptions}
          addContact={() => { const id = selectedCompany.id; setSelectedCompany(null); openContactForm(id); }}
          addTask={() => { const id = selectedCompany.id; setSelectedCompany(null); openTaskForm(id); }}
        />
      )}

      {selectedContact && (
        <ContactDetail
          key={`${selectedContact.id}-${currentRole}`}
          contact={contacts.find((contact) => contact.id === selectedContact.id) ?? selectedContact}
          company={companyName(companies, selectedContact.companyId)}
          companies={liveCompanies}
          canTransfer={currentRole === "Admin"}
          onClose={() => setSelectedContact(null)}
          updateContact={updateContact}
          canEdit={hasPermission(currentRole, "contact.edit")}
          canArchive={hasPermission(currentRole, "record.archive")}
          archive={() => archiveContact(selectedContact)}
          sourceOptions={contactSourceOptions}
          managerOptions={managerOptions}
        />
      )}

      {selectedTask && (
        <TaskDetail
          key={`${selectedTask.id}-${currentRole}`}
          task={tasks.find((task) => task.id === selectedTask.id) ?? selectedTask}
          company={companyName(companies, selectedTask.companyId)}
          companies={liveCompanies}
          contacts={liveContacts}
          comments={taskComments.filter((comment) => comment.taskId === selectedTask.id)}
          attachments={taskAttachments.filter((attachment) => attachment.taskId === selectedTask.id)}
          events={audit.filter((event) => event.entity === `Task · ${selectedTask.id}`)}
          onClose={() => setSelectedTask(null)}
          openContact={(contact) => { setContactQuery(""); resetUrlFilters(["contact_q", "contact_source", "contact_initiator", "contact_company", "contact_linkedin"]); navigate("contacts"); setSelectedTask(null); setSelectedContact(contact); }}
          openCompany={() => { const company = companies.find((item) => item.id === selectedTask.companyId); if (company) { setSelectedTask(null); openCompanyInCompanies(company); } }}
          updateStatus={updateTaskStatus}
          updateTask={updateTask}
          addComment={addTaskComment}
          updateComment={updateTaskComment}
          setCommentHidden={setCommentHidden}
          uploadAttachment={uploadTaskAttachment}
          downloadAttachment={downloadTaskAttachment}
          downloadIcs={downloadTaskIcs}
          deleteAttachment={deleteTaskAttachment}
          currentUserId={identity.id}
          isAdmin={currentRole === "Admin"}
          canEdit={hasPermission(currentRole, "task.edit")}
          canComment={hasPermission(currentRole, "task.comment")}
          canArchive={hasPermission(currentRole, "record.archive")}
          archive={() => archiveTask(selectedTask)}
          taskStatusOptions={taskStatusOptions}
          reminderLeadOptions={reminderLeadOptions}
          managerOptions={managerOptions}
        />
      )}

      {selectedUser && (
        <UserDetail
          user={users.find((user) => user.email === selectedUser.email) ?? selectedUser}
          onClose={() => setSelectedUser(null)}
          updateUser={updateUser}
          rejectUser={rejectUser}
          lastActiveAdmin={selectedUser.role === "Admin" && selectedUser.state === "Active" && users.filter((user) => user.role === "Admin" && user.state === "Active").length <= 1}
        />
      )}

      {modal && ["company", "contact", "task"].includes(modal) && !recordsLoadedRef.current && <Modal title="Loading form data" onClose={() => setModal(null)}>{recordLoadState("form data")}</Modal>}
      {modal === "company" && recordsLoadedRef.current && <CompanyForm companies={liveCompanies} countries={countries} statusOptions={activeClientStatuses} companyTypeOptions={companyTypeOptions} defaultOwner={defaultManager} openExistingCompany={(company) => { setModal(null); setSelectedCompany(company); }} onClose={() => setModal(null)} onSubmit={addCompany} />}
      {modal === "contact" && recordsLoadedRef.current && <ContactForm companies={liveCompanies} sourceOptions={contactSourceOptions} initiatorOptions={users.filter((user) => user.state === "Active")} initialCompanyId={modalCompanyId} currentUserEmail={identity.accountEmail} onClose={() => { setCardCompany(null); setModal(null); }} onSubmit={addContact} onCreateCompany={hasPermission(currentRole, "company.create") ? (name, card, cardImages, onCreated) => setCardCompany({ prefill: companyPrefillFromCard(name, card, countries, companyTypeOptions, cardImages), onCreated }) : undefined} />}
      {modal === "contact" && cardCompany && <CompanyForm companies={liveCompanies} countries={countries} statusOptions={activeClientStatuses} companyTypeOptions={companyTypeOptions} defaultOwner={defaultManager} prefill={cardCompany.prefill} openExistingCompany={(company) => { cardCompany.onCreated(company); setCardCompany(null); }} onClose={() => setCardCompany(null)} onSubmit={(event, logoDataUrl) => addCompany(event, logoDataUrl, (company) => { cardCompany.onCreated(company); setCardCompany(null); })} />}
      {modal === "task" && recordsLoadedRef.current && <TaskForm companies={liveCompanies} contacts={liveContacts} taskStatusOptions={taskStatusOptions} reminderLeadOptions={reminderLeadOptions} managerOptions={managerOptions} defaultOwner={defaultManager} initiatorOptions={users.filter((user) => user.state === "Active")} currentUserEmail={identity.accountEmail} initialCompanyId={modalCompanyId} canAddContact={hasPermission(currentRole, "contact.create")} onAddContact={createContact} onClose={() => setModal(null)} onSubmit={addTask} />}
      {modal === "user" && <UserForm onClose={() => setModal(null)} onSubmit={inviteUser} />}
      {modal === "profile" && <ProfileModal identity={identity} onClose={() => setModal(null)} onSave={updateProfile} />}
      {modal === "settings" && <SettingsModal preferences={preferences} systemSettings={currentRole === "Admin" ? systemSettings : null} onClose={() => setModal(null)} onSave={updatePreferences} />}

      <PageScrollControls hidden={overlayOpen} />

      {toast && <div className={`toast toast-${toast.tone}`} role="status"><span>{toast.tone === "success" ? "✓" : "!"}</span>{toast.message}</div>}
    </div>
    </DraftScopeContext.Provider>
  );
}

function Dashboard({ summary, audit, canViewAudit, identity, openCompanies, openContacts, openTaskList, openAuditEntity, openCompaniesForStatus, openTasksForManager }: {
  summary: DashboardSummary | null;
  audit: AuditEvent[];
  canViewAudit: boolean;
  identity: AuthIdentity;
  openCompanies: () => void;
  openContacts: () => void;
  openTaskList: (filter: "All" | "Open" | "Overdue") => void;
  openAuditEntity: (event: AuditEvent) => void;
  openCompaniesForStatus: (status: string) => void;
  openTasksForManager: (manager: string) => void;
}) {
  const kpi = summary?.kpi;
  const stageCounts = summary?.funnel ?? [];
  const max = Math.max(...stageCounts.map((item) => item.count), 1);
  const managerActivity = summary?.manager_activity ?? [];

  return (
    <>
      <section className="welcome-card">
        <div>
          <p>{userGreeting()}, {identity.name.split(" ")[0]}{CLIENT_TIME_ZONE_IS_DEFAULT ? "" : ` · ${CLIENT_TIME_ZONE_LABEL}`}</p>
          <h2>Here is what needs the team&apos;s attention today.</h2>
        </div>
        <button className="primary-button" type="button" onClick={() => openTaskList("All")}>View tasks <span>→</span></button>
      </section>

      <section className="kpi-grid" aria-label="Key metrics">
        <button className="kpi-card" type="button" onClick={openCompanies}>
          <span className="kpi-icon blue">▦</span>
          <span><small>Companies</small><b>{kpi?.companies ?? 0}</b><em>All active CRM records</em></span>
        </button>
        <button className="kpi-card" type="button" onClick={openContacts}>
          <span className="kpi-icon cyan">◎</span>
          <span><small>Contacts</small><b>{kpi?.contacts ?? 0}</b><em>Across {kpi?.companies_with_contacts ?? 0} companies</em></span>
        </button>
        <button className="kpi-card" type="button" onClick={() => openTaskList("All")}>
          <span className="kpi-icon green">≡</span>
          <span><small>Tasks total</small><b>{kpi?.tasks_total ?? 0}</b><em>{kpi?.completed_tasks ?? 0} completed</em></span>
        </button>
        <button className="kpi-card kpi-open" type="button" onClick={() => openTaskList("Open")}>
          <span className="kpi-icon amber">✓</span>
          <span><small>Open tasks</small><b>{kpi?.open_tasks ?? 0}</b><em>Current work queue</em></span>
        </button>
        <button className="kpi-card kpi-overdue" type="button" onClick={() => openTaskList("Overdue")}>
          <span className="kpi-icon red">!</span>
          <span><small>Overdue</small><b>{kpi?.overdue ?? 0}</b><em>{kpi?.overdue ? "Needs attention" : "No overdue tasks"}</em></span>
        </button>
      </section>

      {canViewAudit && <section className="panel recent-panel dashboard-recent-panel">
          <div className="panel-heading"><div><p className="eyebrow">Live</p><h2>Recent changes</h2></div><CountBadge count={audit.length} label="events" detail={`${audit.length} events are currently recorded in the Audit Log.`} /></div>
          <div className="timeline">
            {audit.slice(0, 4).map((event, index) => <button className="timeline-event" type="button" key={event.id} onClick={() => openAuditEntity(event)}><span className={`timeline-avatar ${["green", "blue", "violet", "navy"][index % 4]}`}>{event.actor.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span><b>{event.actor}</b><small>{event.action.toLowerCase()} · {event.entity}</small><em>{event.at} · {CLIENT_TIME_ZONE_LABEL}</em></span><span className="row-arrow">›</span></button>)}
            {audit.length === 0 && <div className="empty-state compact"><b>No recent changes</b><span>New CRM activity will appear here.</span></div>}
          </div>
        </section>}

      <section className="panel funnel-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Client workflow</p><h2>Relationship overview</h2></div>
        </div>
        <div className="funnel-list">
          {stageCounts.map((item) => (
            <button key={item.status} type="button" onClick={() => openCompaniesForStatus(item.status)}>
              <span className="funnel-label">{item.status}</span>
              <span className="funnel-track"><i style={{ width: `${Math.max((item.count / max) * 100, item.count ? 18 : 4)}%` }} /></span>
              <b>{item.count}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="panel manager-activity-panel">
        <div className="panel-heading"><div><p className="eyebrow">Team load</p><h2>Activity by manager</h2></div><CountBadge count={kpi?.tasks_total ?? 0} label="tasks" detail={`${kpi?.tasks_total ?? 0} active task records are included in this view.`} /></div>
        <div className="manager-activity-list">
          {managerActivity.map((item) => <button type="button" key={item.manager} onClick={() => openTasksForManager(item.manager)}><span className="mini-avatar">{item.manager.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><b>{item.manager}</b><small>{item.open_count} open</small></span><strong>{item.task_count}</strong><span className="row-arrow">›</span></button>)}
          {managerActivity.length === 0 && <div className="empty-state compact"><b>No manager activity</b><span>Tasks will appear here after creation.</span></div>}
        </div>
      </section>
    </>
  );
}

function Companies({ companies, contactCounts, tasks, statusOptions, query, setQuery, status, setStatus, showInternalIds, canCreate, canEdit, managerOptions, updateCompany, updateTask, openCompanyContacts, openCompany, add }: {
  companies: Company[];
  contactCounts: Map<string, number>;
  tasks: Task[];
  statusOptions: string[];
  query: string;
  setQuery: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  showInternalIds: boolean;
  canCreate: boolean;
  canEdit: boolean;
  managerOptions: string[];
  updateCompany: (company: Company) => Promise<boolean>;
  updateTask: (task: Task) => Promise<boolean>;
  openCompanyContacts: (companyId: string) => void;
  openCompany: (company: Company) => void;
  add: () => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ownerFilter, setOwnerFilter] = useUrlStringState("company_owner", "All owners");
  const [countryFilter, setCountryFilter] = useUrlStringState("company_country", "All countries");
  const [typeFilter, setTypeFilter] = useUrlStringState("company_type", "All types");
  const [priorityFilter, setPriorityFilter] = useUrlStringState("company_priority", "All priorities", ["All priorities", ...TASK_PRIORITIES]);
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<"name" | "kind" | "country" | "status" | "lastContact">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const latestTaskByCompany = useMemo(() => {
    const result = new Map<string, Task>();
    tasks.forEach((task) => {
      const current = result.get(task.companyId);
      const taskDate = task.contactDate ?? "";
      const currentDate = current?.contactDate ?? "";
      if (!current || taskDate > currentDate || (taskDate === currentDate && task.id > current.id)) result.set(task.companyId, task);
    });
    return result;
  }, [tasks]);
  const filtered = companies.filter((company) =>
    (ownerFilter === "All owners" || company.owner === ownerFilter) &&
    (countryFilter === "All countries" || company.country === countryFilter) &&
    (typeFilter === "All types" || company.kind === typeFilter) &&
    (priorityFilter === "All priorities" || latestTaskByCompany.get(company.id)?.priority === priorityFilter),
  ).sort((a, b) => String(a[sortField]).localeCompare(String(b[sortField])) * (sortDirection === "asc" ? 1 : -1));
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleCompanies = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const owners = Array.from(new Set(companies.map((company) => company.owner))).sort();
  const countries = Array.from(new Set(companies.map((company) => company.country))).sort();
  const types = Array.from(new Set(companies.map((company) => company.kind))).sort();
  const sortBy = (field: typeof sortField) => { setPage(1); if (sortField === field) setSortDirection((direction) => direction === "asc" ? "desc" : "asc"); else { setSortField(field); setSortDirection("asc"); } };

  return (
    <section className="panel data-panel">
      <div className="data-toolbar companies-toolbar">
        <div className="company-search-combobox">
          <div className="toolbar-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search names by syllables" aria-label="Search companies by name syllables" autoComplete="off" spellCheck={false} />{query && <button className="search-clear-button" type="button" aria-label="Clear company search" onClick={() => { setQuery(""); setPage(1); }}>×</button>}</div>
        </div>
        <div className="companies-toolbar-controls">
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Filter by status">
            <option>All statuses</option>
            {statusOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
          <button className={`secondary-button${filtersOpen ? " control-active" : ""}`} type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>≡ Filters</button>
          <span className="toolbar-spacer" />
          {canCreate && <button className="primary-button companies-add-button" type="button" onClick={add}><span className="button-label-full">＋ Add company</span><span className="button-label-short">＋ Add</span></button>}
        </div>
      </div>
      {filtersOpen && (
        <div className="filter-drawer">
          <label><span>Owner</span><select value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setPage(1); }}><option>All owners</option>{owners.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
          <label><span>Country</span><select value={countryFilter} onChange={(event) => { setCountryFilter(event.target.value); setPage(1); }}><option>All countries</option>{countries.map((country) => <option key={country}>{country}</option>)}</select></label>
          <label><span>Company type</span><select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}><option>All types</option>{types.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label><span>Priority</span><select value={priorityFilter} onChange={(event) => { setPriorityFilter(event.target.value); setPage(1); }}><option>All priorities</option>{TASK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
          <button className="secondary-button" type="button" onClick={() => { setOwnerFilter("All owners"); setCountryFilter("All countries"); setTypeFilter("All types"); setPriorityFilter("All priorities"); setPage(1); }}>Reset</button>
          <button className="primary-button" type="button" onClick={() => setFiltersOpen(false)}>Done</button>
        </div>
      )}
      <div className="table-scroll responsive-card-scroll" role="region" aria-label="Companies table" tabIndex={0}>
        <table className="data-table companies-table responsive-card-table">
          <thead><tr><th><button className="sort-button" type="button" onClick={() => sortBy("name")}>Company {sortField === "name" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th><th><button className="sort-button" type="button" onClick={() => sortBy("kind")}>Type {sortField === "kind" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th><th><button className="sort-button" type="button" onClick={() => sortBy("country")}>Location {sortField === "country" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th><th><button className="sort-button" type="button" onClick={() => sortBy("status")}>Client status {sortField === "status" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th><th>Priority</th><th>Contacts</th><th><button className="sort-button" type="button" onClick={() => sortBy("lastContact")}>Last contact {sortField === "lastContact" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th><th>Owner</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {visibleCompanies.map((company) => (
              <tr key={company.id} className={company.status === "Black List" ? "blacklisted-company" : ""} tabIndex={0} onClick={() => openCompany(company)} onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) openCompany(company); }}>
                <td data-label="Company"><span className="company-cell"><EntityLogo name={company.name} src={company.logoDataUrl} lazy /><span><b>{company.name}</b>{(showInternalIds || company.website) && <small className="company-meta">{showInternalIds && <span className="company-internal-id">{company.id}</span>}{company.website && <a className="inline-data-link compact company-website-link" href={websiteHref(company.website)} target="_blank" rel="noreferrer" title={company.website} aria-label={`Open ${company.name} website: ${company.website}`} onClick={(event) => event.stopPropagation()}>{companyWebsiteLabel(company.website)}</a>}</small>}</span></span></td>
                <td data-label="Type"><span className="company-card-value">{company.kind}</span></td>
                <td data-label="Location"><span className="company-card-value"><b className="normal-weight">{company.city}</b><small className="cell-sub">{company.country}</small></span></td>
                <td data-label="Client status"><span className="company-card-value">{canEdit ? <select className="table-inline-select" aria-label={`Relationship status for ${company.name}`} value={company.status} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); void updateCompany({ ...company, status: event.target.value }); }}>{Array.from(new Set([...statusOptions, company.status])).map((value) => <option key={value}>{value}</option>)}</select> : <StatusBadge value={company.status} />}</span></td>
                <td data-label="Priority"><span className="company-card-value">{company.status === "Black List" ? <span className="priority-unavailable" title="Priority is unavailable for Black List companies">—</span> : latestTaskByCompany.has(company.id) ? (canEdit ? <select className={`table-inline-select priority-select ${priorityToneClass(latestTaskByCompany.get(company.id)!.priority)}`} aria-label={`Latest task priority for ${company.name}`} value={latestTaskByCompany.get(company.id)!.priority} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); void updateTask({ ...latestTaskByCompany.get(company.id)!, priority: event.target.value as Task["priority"] }); }}>{TASK_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}</select> : <StatusBadge value={`${latestTaskByCompany.get(company.id)!.priority} priority`} />) : "—"}</span></td>
                <td data-label="Contacts"><span className="company-card-value"><button className="count-badge company-contact-filter" type="button" title={`Show contacts for ${company.name}`} onClick={(event) => { event.stopPropagation(); openCompanyContacts(company.id); }}>{contactCounts.get(company.id) ?? 0}</button></span></td>
                <td data-label="Last contact"><span className="company-card-value">{company.lastContact}</span></td>
                <td data-label="Owner"><span className="company-card-value">{canEdit ? <select className="table-inline-select owner-select" aria-label={`Owner for ${company.name}`} value={company.owner} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); void updateCompany({ ...company, owner: event.target.value }); }}>{Array.from(new Set([...managerOptions, company.owner])).map((value) => <option key={value}>{value}</option>)}</select> : <span className="owner-cell"><span className="mini-avatar">{company.owner.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>{company.owner}</span>}</span></td>
                <td data-label="Actions"><button className="row-menu" type="button" aria-label={`Open details for ${company.name}`} onClick={(event) => { event.stopPropagation(); openCompany(company); }}>•••</button></td>
              </tr>
            ))}
            {visibleCompanies.length === 0 && <tr className="table-empty-row"><td colSpan={9}>No companies match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="table-footer"><span>Showing {visibleCompanies.length} of {filtered.length} records</span><div><button type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button><b>{currentPage}/{pageCount}</b><button type="button" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button></div></footer>
    </section>
  );
}

function Contacts({ contacts, companies, query, setQuery, canCreate, add, openCompany, openContact }: {
  contacts: Contact[];
  companies: Company[];
  query: string;
  setQuery: (value: string) => void;
  canCreate: boolean;
  add: () => void;
  openCompany: (company: Company) => void;
  openContact: (contact: Contact) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useUrlStringState("contact_source", "All sources");
  const [initiatorFilter, setInitiatorFilter] = useUrlStringState("contact_initiator", "All initiators");
  const [companyFilter, setCompanyFilter] = useUrlStringState("contact_company", "All companies");
  const [linkedinFilter, setLinkedinFilter] = useUrlStringState("contact_linkedin", "Any LinkedIn", CONTACT_LINKEDIN_VALUES);
  const [page, setPage] = useState(1);
  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const filtered = contacts.filter((contact) =>
    (sourceFilter === "All sources" || contact.source === sourceFilter) &&
    (initiatorFilter === "All initiators" || contact.initiatedBy === initiatorFilter) &&
    (companyFilter === "All companies" || contact.companyId === companyFilter) &&
    (linkedinFilter === "Any LinkedIn" || (linkedinFilter === "Has LinkedIn" ? Boolean(contact.linkedin) : !contact.linkedin)),
  );
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleContacts = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const sources = Array.from(new Set(contacts.map((contact) => contact.source))).sort();
  const initiators = Array.from(new Set(contacts.map((contact) => contact.initiatedBy).filter(Boolean) as string[])).sort();
  const hasActiveFilters = Boolean(query) || sourceFilter !== "All sources" || initiatorFilter !== "All initiators" || companyFilter !== "All companies" || linkedinFilter !== "Any LinkedIn";

  return (
    <section className="panel data-panel">
      <div className="data-toolbar contacts-toolbar">
        <div className="contact-search-combobox">
          <div className="toolbar-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Name, email, or company" aria-label="Search contacts" autoComplete="off" spellCheck={false} /></div>
        </div>
        <div className="contacts-toolbar-controls">
          <button className={`secondary-button${filtersOpen ? " control-active" : ""}`} type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>≡ Filters</button>
          {hasActiveFilters && <button className="text-button toolbar-clear" type="button" onClick={() => { setQuery(""); setSourceFilter("All sources"); setInitiatorFilter("All initiators"); setCompanyFilter("All companies"); setLinkedinFilter("Any LinkedIn"); setPage(1); }}>Clear</button>}
          <span className="toolbar-spacer" />
          {canCreate && <button className="primary-button contacts-add-button" type="button" onClick={add}><span className="button-label-full">＋ Add contact manually</span><span className="button-label-short">＋ Add</span></button>}
        </div>
      </div>
      {filtersOpen && (
        <div className="filter-drawer">
          <label><span>Source</span><select value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value); setPage(1); }}><option>All sources</option>{sources.map((source) => <option key={source}>{source}</option>)}</select></label>
          <label><span>Company</span><select value={companyFilter} onChange={(event) => { setCompanyFilter(event.target.value); setPage(1); }}><option>All companies</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
          <label><span>LinkedIn</span><select value={linkedinFilter} onChange={(event) => { setLinkedinFilter(event.target.value); setPage(1); }}><option>Any LinkedIn</option><option>Has LinkedIn</option><option>No LinkedIn</option></select></label>
          <label><span>Initiated by</span><select value={initiatorFilter} onChange={(event) => { setInitiatorFilter(event.target.value); setPage(1); }}><option>All initiators</option>{initiators.map((initiator) => <option key={initiator}>{initiator}</option>)}</select></label>
          <button className="secondary-button" type="button" onClick={() => { setSourceFilter("All sources"); setInitiatorFilter("All initiators"); setCompanyFilter("All companies"); setLinkedinFilter("Any LinkedIn"); setPage(1); }}>Reset</button>
          <button className="primary-button" type="button" onClick={() => setFiltersOpen(false)}>Done</button>
        </div>
      )}
      <div className="table-scroll responsive-card-scroll" role="region" aria-label="Contacts table" tabIndex={0}>
        <table className="data-table contacts-table responsive-card-table">
          <thead><tr><th>Contact</th><th>Company</th><th>Position</th><th>Phone</th><th>Source</th><th>Initiated by</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {visibleContacts.map((contact) => {
              const company = companyById.get(contact.companyId);
              return (
                <tr key={contact.id} className={contact.contactStatus === "inactive" ? "inactive-contact" : ""} tabIndex={0} onClick={() => openContact(contact)} onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) openContact(contact); }}>
                  <td data-label="Contact"><span className="contact-person"><Avatar name={contact.name} src={contact.photoDataUrl} className="person-avatar" lazy /><span><b>{contact.name}</b>{contact.email ? <a className="inline-data-link compact" href={`mailto:${contact.email}`} onClick={(event) => event.stopPropagation()}>{contact.email}</a> : <small>No email</small>}<StatusBadge value={contact.contactStatus === "inactive" ? "Inactive" : "Active"} /></span></span></td>
                  <td data-label="Company"><button className="table-link" type="button" onClick={(event) => { event.stopPropagation(); if (company) openCompany(company); }}>{company?.name}</button></td>
                  <td data-label="Position">{contact.position || "—"}</td><td data-label="Phone">{contactPhones(contact.phone).length > 0 ? <PhoneLinks value={contact.phone} className="inline-data-link" stopPropagation /> : "—"}</td><td data-label="Source"><StatusBadge value={contact.source} /></td>
                  <td data-label="Initiated by"><span className="owner-cell"><span className="mini-avatar">{(contact.initiatedBy || "?").split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>{contact.initiatedBy || "—"}</span></td>
                  <td data-label="Actions"><button className="row-menu" type="button" aria-label={`Open details for ${contact.name}`} onClick={(event) => { event.stopPropagation(); openContact(contact); }}>•••</button></td>
                </tr>
              );
            })}
            {visibleContacts.length === 0 && <tr className="table-empty-row"><td colSpan={7}>No contacts match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="table-footer"><span>Showing {visibleContacts.length} of {filtered.length} contacts</span><div><button type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button><b>{currentPage}/{pageCount}</b><button type="button" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button></div></footer>
    </section>
  );
}

function TaskCardButton({ task, comments, showTaskIds, openTask, branch = false }: { task: Task; companies: Company[]; comments: TaskComment[]; showTaskIds: boolean; openTask: (task: Task) => void; branch?: boolean }) {
  const locked = isTaskEditLocked(task);
  return (
    <button className={`task-card${branch ? " task-branch-card" : ""}${isOverdue(task) ? " task-overdue" : ""}${locked ? " task-inactive" : ""}`} type="button" onClick={() => openTask(task)}>
      <span className={`task-status-line ${task.status.toLowerCase().replace(" ", "-")}`} />
      <span className="task-card-main">
        <span className="task-title-row"><b>{task.title}</b><StaticStatusBadge value={task.status} /></span>
        {(branch || showTaskIds) && <span className="task-company">{branch ? "Branch" : "Task"}{showTaskIds ? ` · ${task.id}` : ""}</span>}
        <span className="task-facts"><span>Contact: {task.contactDate || "—"}</span><span>Person: {task.contactPerson || "—"}</span></span>
        <span className="task-note">{task.note}</span>
        <span className={`task-reminder-row${task.reminderPossible === false ? " reminder-impossible" : ""}`}>{task.reminderPossible === false ? "⚠ Reminder impossible: manager has no active User or email" : (task.reminderLeads?.length ? `Reminder: ${task.reminderLeads.join(", ")}` : "No reminder scheduled")}</span>
        <span className="task-counters">💬 {task.commentCount ?? comments.filter((comment) => comment.taskId === task.id).length} comments · ↻ {task.changeCount ?? 0} changes</span>
      </span>
      <span className="task-card-side"><StaticStatusBadge value={`${task.priority} priority`} /><b className={isOverdue(task) ? "overdue-text" : ""}>{formatDateTime(task.deadline)}</b><small>{locked ? "Editing locked" : task.owner}</small></span>
      <span className="row-arrow">›</span>
    </button>
  );
}

function Activity({ tasks, companies, comments, taskStatusOptions, filter, setFilter, managerFilter, setManagerFilter, showTaskIds, canCreate, canCreateContact, add, addContact, openTask, openCompany }: {
  tasks: Task[];
  companies: Company[];
  comments: TaskComment[];
  taskStatusOptions: string[];
  filter: string;
  setFilter: (value: string) => void;
  managerFilter: string;
  setManagerFilter: (value: string) => void;
  showTaskIds: boolean;
  canCreate: boolean;
  canCreateContact: boolean;
  add: () => void;
  addContact: () => void;
  openTask: (task: Task) => void;
  openCompany: (company: Company) => void;
}) {
  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const filters = [...taskStatusOptions.filter((item) => item !== "Open"), "Open", "Overdue", "All"];
  const [visibleTaskCounts, setVisibleTaskCounts] = useState<Record<string, number>>({});
  const managers = Array.from(new Set(tasks.map((task) => task.owner))).sort();
  const managerTasks = managerFilter === "All managers" ? tasks : tasks.filter((task) => task.owner === managerFilter);
  const counts = Object.fromEntries(filters.map((item) => [
    item,
    item === "All"
      ? managerTasks.length
      : item === "Open"
        ? managerTasks.filter(isOpenTask).length
      : item === "Overdue"
        ? managerTasks.filter(isOverdue).length
        : managerTasks.filter((task) => task.status === item).length,
  ])) as Record<string, number>;
  const activeFilter = filters.includes(filter) ? filter : "All";
  const filterSignature = filters.join("\u001f");
  useEffect(() => {
    if (!filterSignature.split("\u001f").includes(filter)) setFilter("All");
  }, [filter, filterSignature, setFilter]);
  const matchesFilter = (task: Task) => activeFilter === "All" || (activeFilter === "Open" ? isOpenTask(task) : activeFilter === "Overdue" ? isOverdue(task) : task.status === activeFilter);
  const visibleTasks = managerTasks.filter(matchesFilter);
  const tasksByCompany = new Map<string, Task[]>();
  visibleTasks.forEach((task) => {
    const companyTasks = tasksByCompany.get(task.companyId) ?? [];
    companyTasks.push(task);
    tasksByCompany.set(task.companyId, companyTasks);
  });
  const visibleCompanySequences = Array.from(tasksByCompany.entries())
    .map(([companyId, companyTasks]) => ({ companyId, tasks: companyTaskSequence(companyTasks) }))
    .sort((a, b) => Number(b.tasks[0]?.id ?? 0) - Number(a.tasks[0]?.id ?? 0));
  return (
    <>
      <div className="activity-toolbar">
        <div className="activity-filter-group"><label><span>Manager</span><select value={managerFilter} onChange={(event) => setManagerFilter(event.target.value)}><option>All managers</option>{managers.map((manager) => <option key={manager}>{manager}</option>)}</select></label><div className="segmented-control">{filters.map((item) => <button key={item} className={activeFilter === item ? "active" : ""} type="button" onClick={() => setFilter(item)}>{item}<span>{counts[item]}</span></button>)}</div></div>
        <div className="activity-toolbar-actions">
          {canCreateContact && <button className="secondary-button" type="button" onClick={addContact}>＋ Add contact</button>}
          {canCreate && <button className="primary-button" type="button" onClick={add}>＋ New task</button>}
        </div>
      </div>
      <section className="task-board">
        {visibleCompanySequences.map(({ companyId, tasks: sequence }) => {
          const company = companyById.get(companyId);
          const blacklisted = company?.status === "Black List";
          const visibleTaskCount = sequence.length > 5 ? Math.min(visibleTaskCounts[companyId] ?? 2, sequence.length) : sequence.length;
          const visibleSequence = sequence.slice(0, visibleTaskCount);
          const hiddenTaskCount = sequence.length - visibleSequence.length;
          return <article className={`activity-thread company-task-group${blacklisted ? " blacklisted-activity-company" : ""}`} key={companyId}>
            {company && <div className="company-task-group-head"><button className="table-link activity-company-link" type="button" onClick={() => openCompany(company)}>{company.name}</button><button className="text-button" type="button" onClick={() => openCompany(company)}>Open company</button></div>}
            {hiddenTaskCount > 0 && <div className="thread-unhide-actions"><small>{hiddenTaskCount} earlier {hiddenTaskCount === 1 ? "task" : "tasks"} hidden</small><button className="text-button" type="button" onClick={() => setVisibleTaskCounts((counts) => ({ ...counts, [companyId]: Math.min(sequence.length, visibleTaskCount + 1) }))}>Unhide previous</button><button className="text-button" type="button" onClick={() => setVisibleTaskCounts((counts) => ({ ...counts, [companyId]: sequence.length }))}>Unhide all</button></div>}
            <div className="company-task-sequence">{visibleSequence.map((task) => <TaskCardButton key={task.id} task={task} companies={companies} comments={comments} showTaskIds={showTaskIds} openTask={openTask} />)}</div>
          </article>;
        })}
        {visibleCompanySequences.length === 0 && <div className="empty-state"><b>No tasks match this filter</b><span>Change the filter{canCreate ? " or create a new task" : ""}.</span></div>}
      </section>
    </>
  );
}

function Lookups({ groups, archivedRecords, restoreRecord, addValue, renameValue, toggleValue, moveValue }: {
  groups: LookupGroup[];
  archivedRecords: Array<{ entity: "Company" | "Contact" | "Task"; id: string; label: string }>;
  restoreRecord: (entity: "Company" | "Contact" | "Task", id: string) => void;
  addValue: (type: string, value: string) => boolean;
  renameValue: (type: string, id: string, value: string) => boolean;
  toggleValue: (type: string, id: string) => void;
  moveValue: (type: string, id: string, direction: -1 | 1) => void;
}) {
  const lookupRenameDraft = useFormDraft("lookup-rename");
  const [activeType, setActiveType] = useState(() => lookupRenameDraft.initialValue("activeType", groups[0]?.type ?? ""));
  const [editingId, setEditingId] = useState<string | null>(() => lookupRenameDraft.initialValue("editingId") || null);
  const [editingValue, setEditingValue] = useState(() => lookupRenameDraft.initialValue("editingValue"));
  const group = groups.find((item) => item.type === activeType) ?? groups[0];
  const lookupAddDraft = useFormDraft(`lookup-add:${group?.type ?? activeType}`);
  const saveLookupRenameDraft = lookupRenameDraft.save;

  useEffect(() => {
    if (editingId) saveLookupRenameDraft({ activeType, editingId, editingValue });
  }, [activeType, editingId, editingValue, saveLookupRenameDraft]);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = String(new FormData(form).get("lookupValue") ?? "");
    if (addValue(group.type, value)) { lookupAddDraft.clear(); form.reset(); }
  }

  function saveRename(id: string) {
    if (renameValue(group.type, id, editingValue)) {
      setEditingId(null);
      setEditingValue("");
      lookupRenameDraft.clear();
    }
  }

  return (
    <section className="panel lookups-panel">
      <div className="panel-heading"><div><p className="eyebrow">Controlled options</p><h2>Lookup lists</h2></div><CountBadge count={groups.reduce((sum, item) => sum + item.items.filter((value) => value.active).length, 0)} label="active options" detail="Active options are available in create and edit forms." /></div>
      <div className="lookup-layout">
        <div className="lookup-tabs" role="tablist" aria-label="Lookup groups">
          {groups.map((item) => <button type="button" role="tab" aria-selected={group.type === item.type} className={group.type === item.type ? "active" : ""} key={item.type} onClick={() => { lookupRenameDraft.clear(); setActiveType(item.type); setEditingId(null); }}><span>{item.label}</span><b>{item.items.filter((value) => value.active).length}</b></button>)}
        </div>
        <div className="lookup-editor">
          <header><div><p className="eyebrow">Selected list</p><h3>{group.label}</h3></div><small>Rename, reorder, add, or deactivate options. Existing records keep their history.</small></header>
          <ol className="lookup-values">
            {group.items.map((item, index) => <li key={item.id} className={item.active ? "" : "inactive"}>
              <span className="lookup-order">{index + 1}</span>
              {editingId === item.id ? <input value={editingValue} onChange={(event) => setEditingValue(event.target.value)} maxLength={120} autoFocus onKeyDown={(event) => { if (event.key === "Enter") saveRename(item.id); if (event.key === "Escape") setEditingId(null); }} aria-label={`Rename ${item.value}`} /> : <span className="lookup-value-copy"><b>{item.value}</b><small>{item.active ? "Active" : "Inactive · retained for existing records"}</small></span>}
              <span className="lookup-actions">
                <button type="button" disabled={index === 0} onClick={() => moveValue(group.type, item.id, -1)} aria-label={`Move ${item.value} up`}>↑</button>
                <button type="button" disabled={index === group.items.length - 1} onClick={() => moveValue(group.type, item.id, 1)} aria-label={`Move ${item.value} down`}>↓</button>
                {editingId === item.id ? <><button type="button" onClick={() => saveRename(item.id)}>Save</button><button type="button" onClick={() => { lookupRenameDraft.clear(); setEditingId(null); }}>Cancel</button></> : <button type="button" onClick={() => { setEditingId(item.id); setEditingValue(item.value); }}>Rename</button>}
                <button type="button" className={item.active ? "danger-text" : ""} onClick={() => toggleValue(group.type, item.id)}>{item.active ? "Deactivate" : "Activate"}</button>
              </span>
            </li>)}
          </ol>
        </div>
        <form {...lookupAddDraft.formProps} className="lookup-add-form" onSubmit={add}><label><span>New option</span><input name="lookupValue" required maxLength={120} placeholder={`Add to ${group.label}`} /></label><button className="primary-button" type="submit">＋ Add option</button></form>
      </div>
      <div className="archived-records">
        <div className="panel-heading archived-records-heading"><div><p className="eyebrow">Recovery</p><span className="archived-records-title"><h3>Archived records</h3><StaticStatusBadge value={`${archivedRecords.length} ${archivedRecords.length === 1 ? "record" : "records"}`} /></span></div></div>
        {archivedRecords.length > 0 ? <div className="archived-record-list">{archivedRecords.map((record) => <div key={`${record.entity}-${record.id}`}><span><StaticStatusBadge value={record.entity} /><b>{record.label}</b><small>{record.id}</small></span><button className="secondary-button" type="button" onClick={() => restoreRecord(record.entity, record.id)}>Restore</button></div>)}</div> : <div className="empty-state compact"><b>No archived records</b><span>Archived companies, contacts, and tasks will appear here.</span></div>}
      </div>
    </section>
  );
}

function Users({ users, invite, openUser }: { users: CRMUser[]; invite: () => void; openUser: (user: CRMUser) => void }) {
  const [roleFilter, setRoleFilter] = useState<Role | "All">("All");
  const visibleUsers = (roleFilter === "All" ? users : users.filter((user) => user.role === roleFilter)).slice().sort((a, b) => Number(b.state === "Pending") - Number(a.state === "Pending"));
  return (
    <section className="panel data-panel">
      <div className="data-toolbar"><p className="page-description">Manager and Editor have identical record permissions. Select a role card to filter the team.</p><span className="toolbar-spacer" /><button className="primary-button" type="button" onClick={invite}>＋ Add user</button></div>
      <div className="role-grid" aria-label="Role permissions">{ROLE_ORDER.map((role) => <button type="button" key={role} className={roleFilter === role ? "active" : ""} aria-pressed={roleFilter === role} onClick={() => setRoleFilter((current) => current === role ? "All" : role)}><span><StaticStatusBadge value={role} /><b>{users.filter((user) => user.role === role).length}</b></span><strong>{ROLE_DETAILS[role].summary}</strong><small>{ROLE_DETAILS[role].permissions.join(" · ")}</small></button>)}</div>
      <div className="table-scroll responsive-card-scroll" role="region" aria-label="Users and roles table" tabIndex={0}>
        <table className="data-table users-table responsive-card-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login · {CLIENT_TIME_ZONE_LABEL}</th><th>Access note</th><th aria-label="Actions" /></tr></thead>
          <tbody>{visibleUsers.map((user) => <tr key={user.email} tabIndex={0} onClick={() => openUser(user)} onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) openUser(user); }}><td data-label="User"><span className="contact-person"><Avatar name={user.name} src={user.photoDataUrl} className="person-avatar" lazy /><span><b>{user.name}</b><a className="inline-data-link compact" href={`mailto:${user.email}`} onClick={(event) => event.stopPropagation()}>{user.email}</a></span></span></td><td data-label="Role"><StatusBadge value={user.role} /></td><td data-label="Status"><StatusBadge value={user.state} /></td><td data-label="Last login">{user.lastLogin}</td><td data-label="Access note">{ROLE_DETAILS[user.role].summary}</td><td data-label="Actions"><button className="row-menu" type="button" aria-label={`Edit access for ${user.name}`} onClick={(event) => { event.stopPropagation(); openUser(user); }}>•••</button></td></tr>)}{visibleUsers.length === 0 && <tr className="table-empty-row"><td colSpan={6}>No users are assigned to this role.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
}

function Audit({ events, users, canExport }: { events: AuditEvent[]; users: CRMUser[]; canExport: boolean }) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useUrlStringState("audit_action", "All actions");
  const [actor, setActor] = useUrlStringState("audit_user", "All users");
  const [entityType, setEntityType] = useUrlStringState("audit_entity", "All entities");
  const [from, setFrom] = useUrlStringState("audit_from", "");
  const [to, setTo] = useUrlStringState("audit_to", "");
  const [page, setPage] = useState(1);
  const [pageEvents, setPageEvents] = useState(events);
  const [meta, setMeta] = useState<ApiMeta>({ page: 1, per_page: 50, total: events.length, pages: Math.max(1, Math.ceil(events.length / 50)) });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const actionOptions = Array.from(new Set([...(action === "All actions" ? [] : [action]), ...events, ...pageEvents].map((event) => typeof event === "string" ? event : event.action).filter(Boolean))).sort();
  const entityOptions = Array.from(new Set([...(entityType === "All entities" ? [] : [entityType]), ...events, ...pageEvents].map((event) => typeof event === "string" ? event : event.entityType).filter(Boolean) as string[])).sort();

  const loadAuditPage = useCallback(async (active: () => boolean) => {
    const params = new URLSearchParams({ page: String(page), per_page: "50" });
    if (actor !== "All users") params.set("user", actor);
    if (action !== "All actions") params.set("action", action);
    if (entityType !== "All entities") params.set("entity_type", entityType);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest<{ data: ApiRecord[]; meta: ApiMeta }>(`/audit?${params}`);
      if (!active()) return;
      setPageEvents(response.data.map(mapAuditEvent));
      setMeta(response.meta);
      if (response.meta.page > response.meta.pages) setPage(response.meta.pages);
    } catch (requestError) {
      if (!active()) return;
      setError(apiMessage(requestError));
    } finally {
      if (active()) setLoading(false);
    }
  }, [action, actor, entityType, from, page, to]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => { void loadAuditPage(() => active); }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [loadAuditPage]);

  const visibleEvents = pageEvents.filter((event) => {
    const needle = query.trim().toLowerCase();
    return !needle || [event.actor, event.action, event.entity, event.detail, event.id].some((value) => value.toLowerCase().includes(needle));
  });

  function exportCsv() {
    const link = document.createElement("a");
    const params = new URLSearchParams({ format: "csv" });
    if (actor !== "All users") params.set("user", actor);
    if (action !== "All actions") params.set("action", action);
    if (entityType !== "All entities") params.set("entity_type", entityType);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    link.href = `/api/audit?${params}`;
    link.download = "";
    link.click();
  }

  function updateAuditFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <section className="panel data-panel">
      <div className="audit-banner"><span>↻</span><p><b>Read-only event view</b><small>This frontend exposes no edit or delete action for activity events.</small></p></div>
      <div className="data-toolbar audit-toolbar"><div className="toolbar-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the current page" aria-label="Search the current audit page" /></div><label><span>From</span><input type="date" value={from} onChange={(event) => updateAuditFilter(setFrom, event.target.value)} /></label><label><span>To</span><input type="date" value={to} onChange={(event) => updateAuditFilter(setTo, event.target.value)} /></label><select value={actor} onChange={(event) => updateAuditFilter(setActor, event.target.value)} aria-label="User"><option>All users</option>{users.filter((user) => user.id).map((user) => <option key={user.id} value={String(user.id)}>{user.name}</option>)}</select><select value={action} onChange={(event) => updateAuditFilter(setAction, event.target.value)} aria-label="Event type"><option>All actions</option>{actionOptions.map((value) => <option key={value}>{value}</option>)}</select><select value={entityType} onChange={(event) => updateAuditFilter(setEntityType, event.target.value)} aria-label="Entity"><option>All entities</option>{entityOptions.map((value) => <option key={value}>{value}</option>)}</select><button className="text-button" type="button" onClick={() => { setQuery(""); setActor("All users"); setAction("All actions"); setEntityType("All entities"); setFrom(""); setTo(""); setPage(1); }}>Clear</button><span className="toolbar-spacer" />{canExport && <button className="secondary-button" type="button" onClick={exportCsv}>Export CSV</button>}</div>
      <div className="table-scroll responsive-card-scroll" role="region" aria-label="Audit Log table" tabIndex={0}><table className="data-table audit-table responsive-card-table"><thead><tr><th>Time · {CLIENT_TIME_ZONE_LABEL}</th><th>Actor</th><th>Action</th><th>Entity</th><th>Change detail</th><th>Event ID</th></tr></thead><tbody>{visibleEvents.map((event) => <tr key={event.id}><td data-label="Time">{event.at}</td><td data-label="Actor"><b className="normal-weight">{event.actor}</b></td><td data-label="Action"><StatusBadge value={event.action} /></td><td data-label="Entity">{event.entity}</td><td className="audit-detail" data-label="Change detail">{event.detail}</td><td data-label="Event ID"><code>{event.id}</code></td></tr>)}{loading && <tr className="table-empty-row"><td colSpan={6}>Loading audit events…</td></tr>}{error && !loading && <tr className="table-empty-row"><td colSpan={6}>{error}</td></tr>}{visibleEvents.length === 0 && !loading && !error && <tr className="table-empty-row"><td colSpan={6}>No audit events match the current filters.</td></tr>}</tbody></table></div>
      <footer className="table-footer"><span>Showing {visibleEvents.length} of {meta.total} events</span><div><button type="button" aria-label="Previous audit page" disabled={loading || meta.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button><b>{meta.page}/{meta.pages}</b><button type="button" aria-label="Next audit page" disabled={loading || meta.page >= meta.pages} onClick={() => setPage((value) => Math.min(meta.pages, value + 1))}>›</button></div></footer>
    </section>
  );
}

function CompanyDetail({ company, contacts, tasks, countries, showInternalIds, onClose, openTask, openContact, updateCompany, canEdit, canMovePipeline, canAddContact, canAddTask, canArchive, archive, statusOptions, companyTypeOptions, addContact, addTask }: {
  company: Company;
  contacts: Contact[];
  tasks: Task[];
  countries: string[];
  showInternalIds: boolean;
  onClose: () => void;
  openTask: (task: Task) => void;
  openContact: (contact: Contact) => void;
  updateCompany: (company: Company) => Promise<boolean>;
  canEdit: boolean;
  canMovePipeline: boolean;
  canAddContact: boolean;
  canAddTask: boolean;
  canArchive: boolean;
  archive: () => void;
  statusOptions: string[];
  companyTypeOptions: string[];
  addContact: () => void;
  addTask: () => void;
}) {
  const companyFormDraft = useFormDraft(`company-edit:${company.id}`);
  const [editing, setEditing] = useState(companyFormDraft.restored);
  const [logoDataUrl, setLogoDataUrl] = useState(company.logoDataUrl ?? "");
  const [imageProcessing, setImageProcessing] = useState(false);
  const [descriptionDraft, setDescriptionDraft, clearDescriptionDraft] = useCookieDraft(`company-${company.id}-description`, company.description);
  const [nameDraft, setNameDraft] = useState(() => companyFormDraft.initialValue("name", company.name));
  const editFormRef = useRef<HTMLFormElement>(null);
  const [websiteLookup, lookupWebsite] = useWebsiteLookup({ formRef: editFormRef, countries, maxDescription: 2000, getName: () => nameDraft, setName: setNameDraft, setDescription: setDescriptionDraft, setLogo: setLogoDataUrl });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (imageProcessing) return;
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? company.name).trim();
    const country = String(data.get("country") ?? company.country).trim();
    const city = String(data.get("city") ?? company.city).trim();
    const websiteInput = String(data.get("website") ?? company.website).trim();
    const linkedinInput = String(data.get("linkedin") ?? company.linkedin ?? "").trim();
    const website = normalizeUrl(websiteInput);
    const linkedin = normalizeUrl(linkedinInput);
    const ndaStatus = String(data.get("ndaStatus") ?? company.ndaStatus ?? NDA_STATUSES[0]) as NdaStatus;
    const status = canMovePipeline ? String(data.get("status") ?? company.status) : company.status;
    if (name.length < 2) return void setFieldError(form, "name", "Enter at least 2 characters.");
    if (!country) return void setFieldError(form, "country", "Country is required.");
    if (websiteInput && !website) return void setFieldError(form, "website", "Enter a valid website address.");
    if (linkedinInput && !linkedin) return void setFieldError(form, "linkedin", "Enter a valid LinkedIn URL.");
    if (!NDA_STATUSES.includes(ndaStatus)) return void setFieldError(form, "ndaStatus", "Select a valid NDA status.");
    if (!await updateCompany({
      ...company,
      name,
      kind: String(data.get("kind") ?? company.kind),
      country,
      city,
      status,
      owner: String(data.get("owner") ?? company.owner),
      website,
      linkedin,
      ndaStatus,
      logoDataUrl: logoDataUrl || undefined,
      description: String(data.get("description") ?? company.description).trim(),
    })) return;
    clearDescriptionDraft();
    companyFormDraft.clear();
    setEditing(false);
  }

  const taskSequence = companyTaskSequence(tasks);
  const [visibleTaskCount, setVisibleTaskCount] = useState(tasks.length > 5 ? 2 : tasks.length);
  const visibleTaskSequence = taskSequence.slice(0, visibleTaskCount);
  const hiddenTaskCount = Math.max(0, taskSequence.length - visibleTaskSequence.length);
  const priorityTask = taskSequence.find((task) => !isCompletedTask(task)) ?? taskSequence[0];

  return (
    <Modal title={company.name} eyebrow={showInternalIds ? `${company.id} · ${company.kind}` : company.kind} onClose={onClose} wide>
      {editing ? (
        <form ref={editFormRef} {...companyFormDraft.formProps} className="entity-form detail-edit-form" onSubmit={save}>
          <ImageField label="Company logo" name="companyLogo" value={logoDataUrl} onChange={setLogoDataUrl} onProcessingChange={setImageProcessing} kind="company" />
          <label className="field field-full"><span>Company name</span><input name="name" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} required minLength={2} maxLength={120} autoFocus /></label>
          <label className="field"><span>Company type</span><select name="kind" defaultValue={company.kind}>{Array.from(new Set([...companyTypeOptions, company.kind])).map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <label className="field"><span>Relationship status</span>{canMovePipeline ? <select name="status" defaultValue={company.status}>{Array.from(new Set([...statusOptions, company.status])).map((status) => <option key={status}>{status}</option>)}</select> : <input value={company.status} readOnly aria-label="Relationship status" />}</label>
          <label className="field"><span>Country</span><input name="country" defaultValue={company.country} required maxLength={80} /></label>
          <label className="field"><span>City</span><input name="city" defaultValue={company.city} maxLength={80} /></label>
          <div className="field website-lookup-field"><label><span>Website</span><input name="website" inputMode="url" defaultValue={company.website} maxLength={300} /></label><WebsiteLookupStatus lookup={websiteLookup} onLookup={lookupWebsite} /></div>
          <label className="field"><span>LinkedIn</span><input name="linkedin" inputMode="url" defaultValue={company.linkedin ?? ""} maxLength={300} /></label>
          <label className="field"><span>NDA</span><select name="ndaStatus" defaultValue={company.ndaStatus ?? NDA_STATUSES[0]}>{NDA_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="field field-full"><span>Description</span><textarea name="description" value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} rows={4} maxLength={2000} spellCheck autoCorrect="on" autoCapitalize="sentences" /><VoiceInputButton disabled={imageProcessing} onText={(text) => setDescriptionDraft((current) => appendVoiceText(current, text, 2000))} /></label>
          <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => { companyFormDraft.clear(); clearDescriptionDraft(); setLogoDataUrl(company.logoDataUrl ?? ""); setDescriptionDraft(company.description); setNameDraft(company.name); setEditing(false); }}>Cancel</button><button className="primary-button" type="submit" disabled={imageProcessing}>{imageProcessing ? "Processing image…" : "Save changes"}</button></div>
        </form>
      ) : (
        <>
          <div className="company-detail-head"><EntityLogo name={company.name} src={company.logoDataUrl} className="detail-logo" /><div><StatusBadge value={company.status} /><p>{companyLocation(company)}{company.website && <> · <a className="inline-data-link compact" href={websiteHref(company.website)} target="_blank" rel="noreferrer">Website</a></>}{company.linkedin && <> · <a className="inline-data-link compact" href={websiteHref(company.linkedin)} target="_blank" rel="noreferrer">LinkedIn</a></>}</p></div>{canEdit && <button className="secondary-button" type="button" onClick={() => setEditing(true)}>Edit</button>}</div>
          <div className="detail-grid company-summary-grid"><div><small>Owner</small><b>{company.owner}</b></div><div><small>Open tasks</small><b>{tasks.filter(isOpenTask).length}</b></div><div><small>Last contact</small><b>{company.lastContact}</b></div><div><small>Next activity</small><b>{nextActivityLabel(tasks)}</b></div><div><small>NDA</small><b>{company.ndaStatus ?? NDA_STATUSES[0]}</b></div></div>
          <div className="detail-description"><small>About company</small><p>{company.description}</p></div>
          <div className="detail-columns">
            <section><div className="detail-section-head"><h3>Contacts <CountBadge count={contacts.length} label="contacts" detail={`Contact people at ${company.name}.`} /></h3>{canAddContact && <button type="button" aria-label="Add contact" onClick={addContact}>＋</button>}</div>{contacts.map((contact) => <button className={`detail-contact${contact.contactStatus === "inactive" ? " inactive-contact" : ""}`} type="button" key={contact.id} onClick={() => openContact(contact)}><Avatar name={contact.name} src={contact.photoDataUrl} className="person-avatar" lazy /><span><b>{contact.name}</b><small>{contact.position} · {contact.email} · {contact.contactStatus === "inactive" ? "Inactive" : "Active"}</small></span><span className="row-arrow">›</span></button>)}{contacts.length === 0 && <p className="muted-copy">No contacts yet.</p>}</section>
            <section className="company-thread-preview"><div className="detail-section-head"><h3>Activity <CountBadge count={taskSequence.length} label="tasks" detail={`Sequential tasks linked to ${company.name}.`} /></h3>{canAddTask && <button type="button" aria-label="Add task" onClick={addTask}>＋</button>}</div>
              {hiddenTaskCount > 0 && <div className="thread-unhide-actions"><small>{hiddenTaskCount} earlier {hiddenTaskCount === 1 ? "task" : "tasks"} hidden</small><button className="text-button" type="button" onClick={() => setVisibleTaskCount((count) => Math.min(taskSequence.length, count + 1))}>Unhide previous</button><button className="text-button" type="button" onClick={() => setVisibleTaskCount(taskSequence.length)}>Unhide all</button></div>}
              <div className="company-task-history">{visibleTaskSequence.map((task) => <button className={`detail-task company-sequence-task${task.id === priorityTask?.id ? " current" : ""}`} type="button" key={task.id} onClick={() => openTask(task)}><span className={`priority-mark${task.status === "Completed" ? " completed" : isOverdue(task) ? " overdue" : ""}`}>{task.status === "Completed" ? "✓" : "!"}</span><span><b>{task.title}</b><small>{task.id === priorityTask?.id && !isCompletedTask(task) ? "Current priority · " : "Task · "}{task.contactDate || "—"} · {formatDateTime(task.deadline)}</small>{task.id === priorityTask?.id && <p className="company-latest-branch-description">{task.note || "No description."}</p>}</span><span>›</span></button>)}</div>
              {taskSequence.length === 0 && <p className="muted-copy">No tasks yet.</p>}
            </section>
          </div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Close</button>{canArchive && <button className="danger-button" type="button" onClick={archive}>Archive company</button>}</div>
        </>
      )}
    </Modal>
  );
}

function ContactDetail({ contact, company, companies, canTransfer, onClose, updateContact, canEdit, canArchive, archive, sourceOptions, managerOptions }: {
  contact: Contact;
  company: string;
  companies: Company[];
  canTransfer: boolean;
  onClose: () => void;
  updateContact: (contact: Contact) => Promise<boolean>;
  canEdit: boolean;
  canArchive: boolean;
  archive: () => void;
  sourceOptions: string[];
  managerOptions: string[];
}) {
  const contactFormDraft = useFormDraft(`contact-edit:${contact.id}`);
  const [editing, setEditing] = useState(contactFormDraft.restored);
  const [sourceValue, setSourceValue] = useState(contact.source);
  const [photoDataUrl, setPhotoDataUrl] = useState(contact.photoDataUrl ?? "");
  const [imageProcessing, setImageProcessing] = useState(false);
  const [editCompanyId, setEditCompanyId] = useState(contact.companyId);
  const [editCompanyName, setEditCompanyName] = useState(company);

  function selectCompany(value: string) {
    const match = companyByName(companies, value);
    setEditCompanyName(value);
    setEditCompanyId(match?.id ?? "");
  }

  function openEditor() {
    setEditCompanyId(contact.companyId);
    setEditCompanyName(company);
    setSourceValue(contact.source);
    setPhotoDataUrl(contact.photoDataUrl ?? "");
    setEditing(true);
  }

  function closeEditor() {
    contactFormDraft.clear();
    setPhotoDataUrl(contact.photoDataUrl ?? "");
    setEditing(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (imageProcessing) return;
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? contact.name).trim();
    const email = String(data.get("email") ?? contact.email).trim().toLowerCase();
    const phone = String(data.get("phone") ?? contact.phone).trim();
    const linkedinInput = String(data.get("linkedin") ?? contact.linkedin ?? "").trim();
    const linkedin = normalizeUrl(linkedinInput);
    if (canTransfer && !companies.some((item) => item.id === editCompanyId)) return void setFieldError(form, "companyName", "Select an existing company from the list.");
    if (name.length < 2) return void setFieldError(form, "name", "Enter at least 2 characters.");
    if (email && !EMAIL_PATTERN.test(email)) return void setFieldError(form, "email", "Enter a valid email address.");
    if (phone && phone !== "—" && !validContactPhones(phone)) return void setFieldError(form, "phone", CONTACT_PHONE_ERROR);
    if (linkedinInput && !linkedin) return void setFieldError(form, "linkedin", "Enter a valid LinkedIn URL.");
    if (!await updateContact({
      ...contact,
      companyId: canTransfer ? editCompanyId : contact.companyId,
      name,
      position: String(data.get("position") ?? contact.position).trim(),
      email,
      phone,
      contactStatus: String(data.get("contactStatus") ?? contact.contactStatus ?? "active") === "inactive" ? "inactive" : "active",
      linkedin,
      source: sourceValue,
      sourceDetail: ["Exhibition / Conference", "Other"].includes(sourceValue) ? String(data.get("sourceDetail") ?? "").trim() : "",
      referredBy: sourceValue === "Referral (word of mouth)" ? String(data.get("referredBy") ?? "").trim() : "",
      owner: String(data.get("owner") ?? contact.owner),
      photoDataUrl: photoDataUrl || undefined,
    })) return;
    contactFormDraft.clear();
    setEditing(false);
  }

  return (
    <Modal title={contact.name} eyebrow={company} onClose={onClose}>
      {editing ? (
        <form {...contactFormDraft.formProps} className="entity-form detail-edit-form" onSubmit={save}>
          <ImageField label="Contact photo" name="contactPhoto" value={photoDataUrl} onChange={setPhotoDataUrl} onProcessingChange={setImageProcessing} />
          {canTransfer ? <CompanyCombobox inputId="contact-edit-company" label="Company (Admin only to change)" companies={companies} value={editCompanyName} onChange={selectCompany} required /> : <label className="field field-full"><span>Company (Admin only to change)</span><input value={company} readOnly /></label>}
          <label className="field field-full"><span>Full name</span><input name="name" defaultValue={contact.name} required minLength={2} maxLength={120} autoFocus /></label>
          <label className="field"><span>Position</span><input name="position" defaultValue={contact.position} maxLength={120} /></label>
          <label className="field"><span>Phone</span><input name="phone" type="tel" defaultValue={contact.phone} maxLength={100} placeholder="+380…; +380…" /></label>
          <label className="field"><span>Email</span><input name="email" type="email" defaultValue={contact.email} maxLength={254} /></label>
          <label className="field"><span>LinkedIn</span><input name="linkedin" inputMode="url" defaultValue={contact.linkedin ?? ""} maxLength={300} /></label>
          <label className="field"><span>Contact status</span><select name="contactStatus" defaultValue={contact.contactStatus ?? "active"}><option value="active">Active — contactable</option><option value="inactive">Inactive — do not contact</option></select></label>
          <label className="field"><span>Source</span><select name="source" value={sourceValue} onChange={(event) => setSourceValue(event.target.value)}><option value="">Not specified</option>{Array.from(new Set([...sourceOptions, contact.source].filter(Boolean))).map((source) => <option key={source}>{source}</option>)}</select></label>
          <label className="field"><span>CJN Manager</span><select name="owner" defaultValue={contact.owner}>{Array.from(new Set([...managerOptions, contact.owner])).map((owner) => <option key={owner}>{owner}</option>)}</select></label>
          {["Exhibition / Conference", "Other"].includes(sourceValue) && <label className="field field-full"><span>{sourceValue === "Other" ? "Source detail" : "Exhibition / event name"}</span><input name="sourceDetail" defaultValue={contact.sourceDetail ?? ""} maxLength={255} /></label>}
          {sourceValue === "Referral (word of mouth)" && <label className="field field-full"><span>Referred by</span><input name="referredBy" defaultValue={contact.referredBy ?? ""} maxLength={255} /></label>}
          <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={closeEditor}>Cancel</button><button className="primary-button" type="submit" disabled={imageProcessing}>{imageProcessing ? "Processing image…" : "Save changes"}</button></div>
        </form>
      ) : (
        <>
          <div className="person-detail-head"><Avatar name={contact.name} src={contact.photoDataUrl} className="person-detail-avatar" /><div><h3>{contact.position || "Position not specified"}</h3><p>{company}</p><StatusBadge value={contact.contactStatus === "inactive" ? "Inactive — do not contact" : "Active — contactable"} /></div>{canEdit && <button className="secondary-button" type="button" onClick={openEditor}>Edit</button>}</div>
          <div className="detail-grid contact-info-grid">
            <div><small>Email</small>{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : <b>—</b>}</div>
            <div><small>Phone</small>{contactPhones(contact.phone).length > 0 ? <PhoneLinks value={contact.phone} /> : <b>—</b>}</div>
            <div><small>LinkedIn</small>{contact.linkedin ? <a href={websiteHref(contact.linkedin)} target="_blank" rel="noreferrer">Open profile</a> : <b>—</b>}</div>
            <div className="contact-source-value"><small>Source / detail</small><b>{contact.source || "—"}</b>{(contact.sourceDetail || contact.referredBy) && <span>{contact.sourceDetail || contact.referredBy}</span>}</div>
            <div><small>CJN Manager</small><b>{contact.owner}</b></div>
            <div><small>Initiated by</small><b>{contact.initiatedBy || "Not recorded"}</b></div>
          </div>
          <div className="modal-actions contact-detail-actions"><button className="secondary-button" type="button" onClick={onClose}>Close</button>{contact.email && <a className="primary-button action-link" href={contactMailto(contact, company)} title="Open a prefilled email in your default mail app">Send mail</a>}<button className="primary-button" type="button" onClick={() => exportContactToOutlook(contact, company)} title="Download an Outlook-compatible contact card">Export to Outlook</button>{canArchive && <button className="danger-button" type="button" onClick={archive}>Archive contact</button>}</div>
        </>
      )}
    </Modal>
  );
}

function UserDetail({ user, onClose, updateUser, rejectUser, lastActiveAdmin }: { user: CRMUser; onClose: () => void; updateUser: (user: CRMUser, temporaryPassword?: string, resetDelivery?: "temporary_password" | "invite") => Promise<boolean>; rejectUser: (user: CRMUser) => Promise<boolean>; lastActiveAdmin: boolean }) {
  const userEditDraft = useFormDraft(`user-edit:${user.id ?? user.email.toLowerCase()}`);
  const [role, setRole] = useState<Role>(user.role);
  const [state, setState] = useState<CRMUser["state"]>(user.state);
  const [resetDelivery, setResetDelivery] = useState<"none" | "temporary_password" | "invite">("none");
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setRetry(false);
    const saved = await updateUser({ ...user, role, state }, String(data.get("temporaryPassword") ?? ""), resetDelivery === "invite" ? "invite" : "temporary_password");
    setSubmitting(false);
    if (saved) { userEditDraft.clear(); onClose(); } else setRetry(true);
  }

  return (
    <Modal title={user.name} eyebrow="Team member" onClose={onClose}>
      <div className="person-detail-head"><Avatar name={user.name} src={user.photoDataUrl} className="person-detail-avatar" /><div><h3><a className="inline-data-link" href={`mailto:${user.email}`}>{user.email}</a></h3><p>Last sign-in: {user.lastLogin}</p></div></div>
      <form {...userEditDraft.formProps} className="entity-form compact-form" onSubmit={save}>
        <label className="field"><span>Role</span><select name="role" value={role} disabled={lastActiveAdmin} title={lastActiveAdmin ? "Cannot change role: this is the last active Admin" : undefined} onChange={(event) => setRole(event.target.value as Role)}><option>Admin</option><option>Manager</option><option>Editor</option><option>Read-only</option></select></label>
        <label className="field"><span>Status</span><select name="state" value={state} disabled={lastActiveAdmin} title={lastActiveAdmin ? "Cannot deactivate: this is the last active Admin" : undefined} onChange={(event) => setState(event.target.value as CRMUser["state"])}><option>Active</option><option>Inactive</option><option>Pending</option></select></label>
        {lastActiveAdmin && <div className="reminder-note field-full"><span>!</span><p><b>Last active Admin</b><small>Role change and deactivation are disabled until another active Admin exists.</small></p></div>}
        <label className="field field-full"><span>Password action</span><select name="resetDelivery" value={resetDelivery} onChange={(event) => setResetDelivery(event.target.value as typeof resetDelivery)}><option value="none">No password reset</option><option value="invite">Send password setup link by email</option><option value="temporary_password">Set a temporary password</option></select></label>
        {resetDelivery === "temporary_password" && <label className="field field-full"><span>Temporary password</span><input name="temporaryPassword" type="password" required minLength={8} maxLength={128} placeholder="New temporary password" autoComplete="new-password" /></label>}
        <div className="reminder-note field-full"><span>i</span><p><b>{ROLE_DETAILS[role].summary}</b><small>{ROLE_DETAILS[role].permissions.join(" · ")}</small></p></div>
        {retry && <div className="form-error field-full" role="alert">Changes were not saved. Your selections are preserved; try again.</div>}
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => { userEditDraft.clear(); onClose(); }}>Cancel</button>{user.state === "Pending" && <button className="danger-button" type="button" onClick={() => void rejectUser(user)}>Reject registration</button>}<button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Saving…" : retry ? "Try again" : user.state === "Pending" ? "Approve and save" : "Save access"}</button></div>
      </form>
    </Modal>
  );
}

function TaskDetail({ task, company, companies, contacts, comments, attachments, events, onClose, openContact, openCompany, canEdit, canComment, canArchive, archive, updateTask, updateStatus, addComment, updateComment, setCommentHidden, uploadAttachment, downloadAttachment, downloadIcs, deleteAttachment, currentUserId, isAdmin, taskStatusOptions, reminderLeadOptions, managerOptions }: {
  task: Task;
  company: string;
  companies: Company[];
  contacts: Contact[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
  events: AuditEvent[];
  onClose: () => void;
  openContact: (contact: Contact) => void;
  openCompany: () => void;
  canEdit: boolean;
  canComment: boolean;
  canArchive: boolean;
  archive: () => void;
  updateTask: (task: Task) => Promise<boolean>;
  updateStatus: (task: Task, status: Task["status"]) => void;
  addComment: (taskId: string, text: string) => Promise<boolean>;
  updateComment: (taskId: string, commentId: string, text: string) => Promise<boolean>;
  setCommentHidden: (taskId: string, commentId: string, hidden: boolean) => Promise<void>;
  uploadAttachment: (taskId: string, file: File) => Promise<boolean>;
  downloadAttachment: (attachment: TaskAttachment) => Promise<void>;
  downloadIcs: (task: Task) => Promise<void>;
  deleteAttachment: (attachment: TaskAttachment) => Promise<void>;
  currentUserId?: number;
  isAdmin: boolean;
  taskStatusOptions: string[];
  reminderLeadOptions: string[];
  managerOptions: string[];
}) {
  const taskEditFormDraft = useFormDraft(`task-edit:${task.id}`);
  const taskCompanyBlacklisted = companies.find((item) => item.id === task.companyId)?.status === "Black List";
  const taskEditLocked = isTaskEditLocked(task);
  const taskReadOnly = taskEditLocked || taskCompanyBlacklisted;
  const [editing, setEditing] = useState(taskEditFormDraft.restored && !taskReadOnly);
  const [commentDraft, setCommentDraft, clearCommentDraft] = useCookieDraft(`task-${task.id}-comment`, "");
  const [editNote, setEditNote, clearEditNoteDraft] = useCookieDraft(`task-${task.id}-description`, task.note);
  const [editCompanyId, setEditCompanyId] = useState(task.companyId);
  const [editCompanyName, setEditCompanyName] = useState(company);
  const [editContactPersonId, setEditContactPersonId] = useState(task.contactPersonId ?? "");
  const [editDeadline, setEditDeadline] = useState(() => taskDeadlineDraftValue(taskEditFormDraft.initialValue, task.deadline));
  const [editPriority, setEditPriority] = useState<Task["priority"]>(task.priority);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentRetry, setCommentRetry] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [commentEditSubmitting, setCommentEditSubmitting] = useState(false);
  const editCompanyContacts = contacts.filter((contact) => contact.companyId === editCompanyId);
  const displayedTask = task;
  const taskCanEdit = canEdit && !taskReadOnly;
  const taskContact = contacts.find((contact) => contact.id === task.contactPersonId);
  const editCompanyBlacklisted = companies.find((item) => item.id === editCompanyId)?.status === "Black List";

  function selectCompany(value: string) {
    const match = companyByName(companies, value);
    setEditCompanyName(value);
    setEditCompanyId(match?.id ?? "");
    setEditContactPersonId("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (taskReadOnly) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const contactDate = String(data.get("contactDate") ?? "");
    const deadline = String(data.get("deadline") ?? "");
    if (title.length < 3) return void setFieldError(form, "title", "Enter at least 3 characters.");
    if (!contactDate) return void setFieldError(form, "contactDate", "Choose the contact date.");
    if (!companies.some((item) => item.id === editCompanyId)) return void setFieldError(form, "companyName", "Select an existing company from the list.");
    const updated: Task = {
      ...task,
      companyId: editCompanyId,
      title,
      contactDate,
      deadline,
      owner: String(data.get("owner") ?? task.owner),
      contactPersonId: editContactPersonId,
      status: String(data.get("status") ?? task.status),
      priority: editCompanyBlacklisted ? task.priority : String(data.get("priority") ?? task.priority) as Task["priority"],
      note: String(data.get("note") ?? "").trim(),
      reminderLeads: data.getAll("reminderLeads").map(String),
      participantContactIds: data.getAll("participantContactIds").map(String),
      participantManagers: data.getAll("participantManagers").map(String),
    };
    if (await updateTask(updated)) {
      clearEditNoteDraft();
      taskEditFormDraft.clear();
      setEditing(false);
    }
  }

  async function postComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (taskReadOnly) return;
    setCommentSubmitting(true);
    setCommentRetry(false);
    const posted = await addComment(task.id, commentDraft);
    setCommentSubmitting(false);
    if (posted) {
      clearCommentDraft();
      setCommentDraft("");
    } else setCommentRetry(true);
  }

  async function attach(event: React.ChangeEvent<HTMLInputElement>) {
    if (taskReadOnly) return;
    const file = event.target.files?.[0];
    if (!file) return;
    setAttachmentUploading(true);
    const uploaded = await uploadAttachment(task.id, file);
    setAttachmentUploading(false);
    if (uploaded) event.target.value = "";
  }

  function openEditor() {
    if (taskReadOnly) return;
    setEditCompanyId(task.companyId);
    setEditCompanyName(company);
    setEditContactPersonId(task.contactPersonId ?? "");
    setEditDeadline(task.deadline);
    setEditPriority(task.priority);
    setEditing(true);
  }

  async function saveCommentEdit(commentId: string) {
    if (taskReadOnly) return;
    const text = editingCommentText.trim();
    if (!text || commentEditSubmitting) return;
    setCommentEditSubmitting(true);
    const saved = await updateComment(task.id, commentId, text);
    setCommentEditSubmitting(false);
    if (saved) {
      setEditingCommentId(null);
      setEditingCommentText("");
    }
  }

  return (
    <Modal title={task.title} eyebrow={<>{isAdmin && <>{task.id} · </>}<button className="task-company-link" type="button" onClick={openCompany} aria-label={`Open company ${company}`}>{company}</button></>} onClose={onClose} wide initialScroll="top">
      {editing && !taskReadOnly ? (
        <form {...taskEditFormDraft.formProps} className="entity-form detail-edit-form" onSubmit={save}>
          <label className="field field-full"><span>Task title *</span><input name="title" defaultValue={task.title} required minLength={3} maxLength={255} autoFocus /></label>
          <CompanyCombobox inputId="task-edit-company" label="Company *" companies={companies} value={editCompanyName} onChange={selectCompany} required />
          <label className="field"><span>Contact date *</span><input name="contactDate" type="date" defaultValue={task.contactDate ?? task.deadline.slice(0, 10)} required /></label>
          <div className="field field-full task-deadline-field"><TaskDeadlineInput value={editDeadline} onChange={setEditDeadline} /></div>
          <label className="field"><span>Responsible manager</span><select name="owner" defaultValue={task.owner}>{Array.from(new Set([...managerOptions, task.owner])).map((owner) => <option key={owner}>{owner}</option>)}</select></label>
          <label className="field"><span>Contact person</span><select name="contactPersonId" value={editContactPersonId} onChange={(event) => setEditContactPersonId(event.target.value)}><option value="">Not specified</option>{editCompanyContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>
          <label className="field"><span>Status</span><select name="status" defaultValue={task.status}>{Array.from(new Set([...taskStatusOptions, task.status])).map((status) => <option key={status}>{status}</option>)}</select></label>
          {editCompanyBlacklisted ? <div className="field priority-locked-field"><span>Priority</span><b>Unavailable for Black List companies</b></div> : <label className="field"><span>Priority</span><select className={priorityToneClass(editPriority)} name="priority" value={editPriority} onChange={(event) => setEditPriority(event.target.value as Task["priority"])}>{TASK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>}
          <label className="field field-full"><span>Description</span><textarea name="note" value={editNote} onChange={(event) => setEditNote(event.target.value)} rows={4} maxLength={4000} spellCheck autoCorrect="on" autoCapitalize="sentences" /><VoiceInputButton onText={(text) => setEditNote((current) => appendVoiceText(current, text, 4000))} /><TranslateToEnglishButton text={editNote} onChange={setEditNote} /></label>
          <TaskParticipantsField contacts={editCompanyContacts} contactPersonId={editContactPersonId} managers={managerOptions} selectedContactIds={task.participantContactIds} selectedManagers={task.participantManagers} />
          <fieldset className="settings-list field-full"><legend>Reminder advance notice</legend>{reminderLeadOptions.map((lead) => <label key={lead}><input name="reminderLeads" type="checkbox" value={lead} defaultChecked={(task.reminderLeads ?? []).includes(lead)} /><span>{lead}</span></label>)}</fieldset>
          <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => { taskEditFormDraft.clear(); clearEditNoteDraft(); setEditNote(task.note); setEditDeadline(task.deadline); setEditPriority(task.priority); setEditing(false); }}>Cancel</button><button className="primary-button" type="submit">Save task</button></div>
        </form>
      ) : (
        <>
          <div className={`task-detail-summary${taskReadOnly ? " task-detail-inactive" : ""}`}>
            <div className="task-detail-status">{taskCanEdit ? <><label className="inline-task-field"><span>Status</span><select value={task.status} onChange={(event) => updateStatus(task, event.target.value)}>{Array.from(new Set([...taskStatusOptions, task.status])).map((status) => <option key={status}>{status}</option>)}</select></label>{taskCompanyBlacklisted ? <span className="inline-priority-locked" title="Priority is unavailable for Black List companies">Priority unavailable</span> : <label className="inline-task-field"><span>Priority</span><select className={priorityToneClass(task.priority)} value={task.priority} onChange={(event) => void updateTask({ ...task, priority: event.target.value as Task["priority"] })}>{TASK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>}</> : <><StatusBadge value={task.status} />{!taskCompanyBlacklisted && <StatusBadge value={`${task.priority} priority`} />}</>}{isOverdue(displayedTask) && <StaticStatusBadge value="Overdue" />}<div className="task-detail-actions">{taskCanEdit && <label className="secondary-button attachment-upload attachment-tooltip" data-tooltip="PDF, Word, Excel, Outlook MSG/EML, JPG, PNG, or WebP · up to 20 MB">{attachmentUploading ? "Uploading…" : "＋ Upload"}<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.msg,.eml,image/*" disabled={attachmentUploading} onChange={(event) => void attach(event)} /></label>}{attachments.length > 0 && <StaticStatusBadge value={`${attachments.length} ${attachments.length === 1 ? "file" : "files"}`} />}{taskCanEdit && <button className="secondary-button task-edit-button" type="button" onClick={openEditor}>Edit</button>}</div></div>
            {attachments.length > 0 && <div className="task-attachment-bar" aria-label="Attachments"><div className="task-attachment-chips">{attachments.map((attachment) => <article key={attachment.id}><button type="button" onClick={() => void downloadAttachment(attachment)}><b>{attachment.name}</b><small>{(attachment.sizeBytes / 1024 / 1024).toFixed(2)} MB · {attachment.author}</small></button>{taskCanEdit && (isAdmin || attachment.authorUserId === currentUserId) && <button className="attachment-delete" type="button" aria-label={`Delete ${attachment.name}`} onClick={() => void deleteAttachment(attachment)}>×</button>}</article>)}</div></div>}
            {taskCompanyBlacklisted ? <p className="task-completion-window locked">Black List company · task editing is locked</p> : isCompletedTask(task) && <p className={`task-completion-window${taskEditLocked ? " locked" : ""}`}>{taskCompletionEditLabel(task)}</p>}
            <div className="detail-grid task-info-grid"><div><small>Contact date</small><b>{task.contactDate ?? displayedTask.deadline.slice(0, 10)}</b></div><div><small>Deadline · {CLIENT_TIME_ZONE_LABEL}</small><b className={isOverdue(displayedTask) ? "overdue-text" : ""}>{formatDateTime(displayedTask.deadline)}</b></div><div><small>Responsible manager</small><b>{task.owner}</b></div><div><small>Contact person</small>{taskContact ? <button className="table-link task-contact-link" type="button" onClick={() => openContact(taskContact)}>{taskContact.name}</button> : <b>—</b>}</div><div><small>Participants</small><b>{[...contacts.filter((contact) => task.participantContactIds?.includes(contact.id)).map((contact) => contact.name), ...(task.participantManagers ?? [])].join(", ") || "—"}</b></div><div className="task-calendar-field"><small>Calendar</small>{displayedTask.deadline ? <button className="detail-action-button" type="button" onClick={() => void downloadIcs(displayedTask)}>Add to Outlook</button> : <b>Set a deadline first</b>}</div></div>
            <div className="detail-description"><small>Description</small><p>{task.note || "No description."}</p></div>
          </div>
          <section className={`comment-stream branch-comments${taskReadOnly ? " task-inactive" : ""}`}>
              <div className="detail-section-head"><h3>Task comments <StaticStatusBadge value={String(comments.filter((comment) => !comment.isHidden).length)} /></h3></div>
              {comments.map((comment) => {
                const canEditComment = !taskReadOnly && !comment.isHidden && (isAdmin || comment.authorUserId === currentUserId);
                const commentIsEditing = editingCommentId === comment.id;
                return <article key={comment.id} className={comment.isHidden ? "comment-hidden" : ""}>
                  <span className="timeline-avatar blue">{comment.author.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
                  <div className="comment-copy">
                    <b>{comment.author}</b>
                    <small>{comment.createdAt} · {CLIENT_TIME_ZONE_LABEL}{comment.updatedAt && comment.updatedAt !== comment.createdAt ? " · Edited" : ""}</small>
                    {commentIsEditing
                      ? <div className="comment-edit-panel"><textarea value={editingCommentText} onChange={(event) => setEditingCommentText(event.target.value)} maxLength={2000} rows={3} autoFocus /><span><button className="secondary-button" type="button" onClick={() => { setEditingCommentId(null); setEditingCommentText(""); }}>Cancel</button><button className="primary-button" type="button" disabled={!editingCommentText.trim() || commentEditSubmitting} onClick={() => void saveCommentEdit(comment.id)}>{commentEditSubmitting ? "Saving…" : "Save"}</button></span></div>
                      : <div className="comment-text">{comment.isHidden ? <p>Comment hidden by Admin</p> : commentParagraphs(comment.text).map((paragraph, index) => <p key={`${comment.id}-${index}`}>{paragraph}</p>)}</div>}
                  </div>
                  <div className="comment-actions">{canEditComment && !commentIsEditing && <button className="comment-edit-button" type="button" aria-label={`Edit comment by ${comment.author}`} title="Edit comment" onClick={() => { setEditingCommentId(comment.id); setEditingCommentText(comment.text); }}>✎</button>}{isAdmin && !taskReadOnly && !commentIsEditing && <button className="text-button" type="button" onClick={() => void setCommentHidden(task.id, comment.id, !comment.isHidden)}>{comment.isHidden ? "Restore" : "Hide"}</button>}</div>
                </article>;
              })}
              {comments.length === 0 && <div className="empty-state compact"><b>No task comments yet</b><span>Updates for this task will appear here.</span></div>}
              {taskReadOnly
                ? <p className="muted-copy">{taskCompanyBlacklisted ? "Tasks for Black List companies are read-only." : "This completed task is read-only because its seven-day editing window has ended."}</p>
                : canComment && <form className="comment-form" onSubmit={postComment}><label><span>Add a comment</span><textarea value={commentDraft} onChange={(event) => { setCommentDraft(event.target.value); setCommentRetry(false); }} required maxLength={2000} rows={3} placeholder="Write an update for this task" spellCheck autoCorrect="on" autoCapitalize="sentences" /><VoiceInputButton disabled={commentSubmitting} onText={(text) => { setCommentDraft((current) => appendVoiceText(current, text, 2000)); setCommentRetry(false); }} /><TranslateToEnglishButton text={commentDraft} onChange={(value) => { setCommentDraft(value); setCommentRetry(false); }} /></label>{commentRetry && <div className="form-error" role="alert">The comment was not posted. Its text is preserved; try again.</div>}<button className="primary-button" type="submit" disabled={commentSubmitting}>{commentSubmitting ? "Posting…" : commentRetry ? "Try again" : "Post comment"}</button></form>}
            </section>
          {canArchive && <div className="task-archive-actions"><button className="danger-button" type="button" onClick={archive}>Archive task</button></div>}
          <section className="change-log"><div className="detail-section-head"><h3>Change log</h3><small>{events.length} events</small></div>{events.slice(0, 8).map((event) => <article key={event.id}><span>{event.action}</span><p><b>{event.detail}</b><small>{event.actor} · {event.at} · {CLIENT_TIME_ZONE_LABEL}</small></p></article>)}{events.length === 0 && <p className="muted-copy">No changes recorded for this task.</p>}</section>
        </>
      )}
    </Modal>
  );
}

type WebsiteLookupState = { state: "idle" | "loading" | "done" | "error"; message: string };

// Reads description, address and logo from the company's own site. Only empty fields
// are filled; site text is appended to the description, labelled, for review.
function useWebsiteLookup({ formRef, countries, maxDescription, getName, setName, setDescription, setLogo }: {
  formRef: RefObject<HTMLFormElement | null>;
  countries: string[];
  maxDescription: number;
  getName: () => string;
  setName: (name: string) => void;
  setDescription: Dispatch<SetStateAction<string>>;
  setLogo: Dispatch<SetStateAction<string>>;
}) {
  const requestRef = useRef(0);
  const [lookup, setLookup] = useState<WebsiteLookupState>({ state: "idle", message: "" });

  useEffect(() => () => { requestRef.current += 1; }, []);

  function setFormField(name: string, value: string, onlyIfEmpty: boolean) {
    const element = formRef.current?.elements.namedItem(name);
    if (!(element instanceof HTMLInputElement) || !value || (onlyIfEmpty && element.value.trim())) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  async function run() {
    const websiteInput = formRef.current?.elements.namedItem("website");
    const website = websiteInput instanceof HTMLInputElement ? websiteInput.value.trim() : "";
    if (!website) {
      setLookup({ state: "error", message: "Enter the company website first." });
      return;
    }
    const request = ++requestRef.current;
    setLookup({ state: "loading", message: `Reading ${websiteHost(website)}…` });
    try {
      const { data } = await apiRequest<{ data: CompanyWebsiteInfo }>("/company-lookup", { method: "POST", body: JSON.stringify({ website }) });
      if (request !== requestRef.current) return;
      const filled: string[] = [];
      // A misread card name ("NGINEERING AS") lacks the domain's brand ("kvernevik"); the site's own name has it.
      const brand = websiteHost(data.website).split(".")[0].split("-")[0];
      const letters = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      if (data.name && brand.length >= 4 && !letters(getName()).includes(brand) && letters(data.name).includes(brand)) {
        setName(data.name);
        filled.push("name");
      }
      if (setFormField("city", data.city ?? "", true)) filled.push("city");
      if (setFormField("country", countryFromWebsite(data.country, countries), true)) filled.push("country");
      setFormField("website", data.website, false);
      const additions = [data.description && `About (website): ${data.description}`, data.address && `Address (website): ${data.address}`].filter((line): line is string => Boolean(line));
      if (additions.length > 0) {
        setDescription((current) => [current.trim(), ...additions.filter((line) => !current.includes(line))].filter(Boolean).join("\n").slice(0, maxDescription));
        if (data.description) filled.push("description");
        if (data.address) filled.push("address");
      }
      if (data.logo_data_url) {
        try {
          const logo = await rasterizeLogo(data.logo_data_url);
          if (request !== requestRef.current) return;
          setLogo((current) => current || logo);
          filled.push("logo");
        } catch {
          // An unreadable logo does not block the rest of the lookup.
        }
      }
      setLookup({ state: "done", message: filled.length > 0 ? `Filled from ${websiteHost(data.website)}: ${filled.join(", ")}. Review before saving.` : `Nothing new found on ${websiteHost(data.website)}.` });
    } catch (caught) {
      if (request === requestRef.current) setLookup({ state: "error", message: apiMessage(caught) });
    }
  }

  return [lookup, run] as const;
}

function WebsiteLookupStatus({ lookup, onLookup }: { lookup: WebsiteLookupState; onLookup: () => Promise<void> }) {
  return <div className="website-lookup"><button className="text-button" type="button" disabled={lookup.state === "loading"} onClick={() => void onLookup()}>{lookup.state === "loading" ? "Reading website…" : "🔎 Fill from website"}</button>{lookup.message && <small className={lookup.state === "error" ? "website-lookup-error" : ""} role="status">{lookup.message}</small>}</div>;
}

function CompanyForm({ companies, countries, statusOptions, companyTypeOptions, defaultOwner, openExistingCompany, onClose, onSubmit, prefill }: { companies: Company[]; countries: string[]; statusOptions: string[]; companyTypeOptions: string[]; defaultOwner: string; openExistingCompany: (company: Company) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>, logoDataUrl: string) => Promise<boolean>; prefill?: CompanyPrefill }) {
  const companyCreateDraft = useFormDraft("company-create");
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [imageProcessing, setImageProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(false);
  const [companyNameDraft, setCompanyNameDraft] = useState(() => prefill?.name ?? companyCreateDraft.initialValue("name"));
  // A card prefill uses its own description draft and overrides anything restored from an earlier card.
  const [descriptionDraft, setDescriptionDraft, clearDescriptionDraft] = useCookieDraft(prefill ? "company-create-card-description" : "company-create-description", "");
  useEffect(() => {
    if (prefill) setDescriptionDraft(prefill.description);
  }, [prefill, setDescriptionDraft]);
  const formRef = useRef<HTMLFormElement>(null);
  const autoLookupStartedRef = useRef(false);
  const [websiteLookup, lookupWebsite] = useWebsiteLookup({ formRef, countries, maxDescription: 4000, getName: () => companyNameDraft, setName: setCompanyNameDraft, setDescription: setDescriptionDraft, setLogo: setLogoDataUrl });

  // A company created from a scanned card looks up the card's website right away.
  useEffect(() => {
    if (!prefill?.website || autoLookupStartedRef.current) return;
    autoLookupStartedRef.current = true;
    void lookupWebsite();
  });
  const duplicateCompanies = companyNameDraft.trim().length < 2 ? [] : companies.filter((company) => searchTextMatches(company.name, companyNameDraft)).slice(0, 6);
  return (
    <Modal title={prefill ? "New company from business card" : "New company"} eyebrow={prefill ? "Contacts · business card" : "Companies"} onClose={onClose} closeOnBackdrop={false}>
      <form ref={formRef} {...(prefill ? {} : companyCreateDraft.formProps)} onSubmit={(event) => { if (imageProcessing) event.preventDefault(); else { setSubmitting(true); setRetry(false); void onSubmit(event, logoDataUrl).then((saved) => { if (saved) { companyCreateDraft.clear(); clearDescriptionDraft(); } setRetry(!saved); }).finally(() => setSubmitting(false)); } }} className="entity-form">
        {prefill && <div className="reminder-note field-full"><span>i</span><p><b>Filled from the scanned card</b><small>Check the details, then save: you return to the contact with this company selected.</small></p></div>}
        <ImageField label="Company logo" name="companyLogo" value={logoDataUrl} onChange={setLogoDataUrl} onProcessingChange={setImageProcessing} kind="company" />
        {prefill && prefill.cardImages.length > 0 && <CardLogoCrop images={prefill.cardImages} onLogo={setLogoDataUrl} onProcessingChange={setImageProcessing} />}
        <div className="field field-full company-duplicate-field"><label><span>Company name *</span><input name="name" value={companyNameDraft} onChange={(event) => setCompanyNameDraft(event.target.value)} required minLength={2} maxLength={255} autoFocus placeholder="For example, Baltic Engineering" autoComplete="off" /></label>{duplicateCompanies.length > 0 && <div className="company-duplicate-suggestions" role="listbox" aria-label="Existing companies with a similar name">{duplicateCompanies.map((company) => <button key={company.id} type="button" onClick={() => openExistingCompany(company)}><EntityLogo name={company.name} src={company.logoDataUrl} /><span><b>{company.name}</b><small>{companyLocation(company)} · open existing company</small></span></button>)}</div>}</div>
        <label className="field field-align-end"><span>Company type *{prefill?.kind && <small> · suggested from the card</small>}</span><select name="kind" required defaultValue={prefill?.kind ?? ""}><option value="" disabled>Select a type…</option>{companyTypeOptions.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label className="field field-align-end"><span>Relationship status *</span><select name="status" required>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label className="field"><span>Country *</span><input name="country" list="company-country-options" required maxLength={100} placeholder="Select or type a country" defaultValue={prefill?.country} /><datalist id="company-country-options">{countries.map((country) => <option key={country} value={country} />)}</datalist></label>
        <label className="field"><span>City</span><input name="city" maxLength={100} placeholder="Kyiv" defaultValue={prefill?.city} /></label>
        <div className="field website-lookup-field"><label><span>Website</span><input name="website" inputMode="url" maxLength={255} placeholder="example.com" defaultValue={prefill?.website} /></label><WebsiteLookupStatus lookup={websiteLookup} onLookup={lookupWebsite} /></div>
        <label className="field"><span>LinkedIn</span><input name="linkedin" inputMode="url" maxLength={255} placeholder="linkedin.com/company/..." defaultValue={prefill?.linkedin} /></label>
        <label className="field"><span>NDA</span><select name="ndaStatus" defaultValue={NDA_STATUSES[0]}>{NDA_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
        <input name="owner" type="hidden" value={defaultOwner} />
        <label className="field field-full"><span>Description</span><textarea name="description" value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} rows={4} maxLength={4000} placeholder="Directions, projects, and cooperation context" spellCheck autoCorrect="on" autoCapitalize="sentences" /><VoiceInputButton disabled={imageProcessing || submitting} onText={(text) => setDescriptionDraft((current) => appendVoiceText(current, text, 4000))} /><TranslateToEnglishButton text={descriptionDraft} onChange={setDescriptionDraft} /></label>
        {retry && <div className="form-error field-full" role="alert">The company was not saved. Your entries are preserved; try again when the connection is available.</div>}
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => { companyCreateDraft.clear(); clearDescriptionDraft(); onClose(); }}>Cancel</button><button className="primary-button" type="submit" disabled={imageProcessing || submitting}>{imageProcessing ? "Processing image…" : submitting ? "Saving…" : retry ? "Try again" : "Create company"}</button></div>
      </form>
    </Modal>
  );
}

function ContactForm({ companies, sourceOptions, initiatorOptions, initialCompanyId, currentUserEmail, onClose, onSubmit, onCreateCompany }: { companies: Company[]; sourceOptions: string[]; initiatorOptions: CRMUser[]; initialCompanyId?: string; currentUserEmail: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>, photoDataUrl: string) => Promise<boolean>; onCreateCompany?: (name: string, card: OcrResult | null, cardImages: string[], onCreated: (company: Company) => void) => void }) {
  const contactCreateDraft = useFormDraft("contact-create");
  const formRef = useRef<HTMLFormElement>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);
  // Touch devices get a separate button that opens the rear camera directly; desktop browsers ignore `capture`.
  const cardCameraRef = useRef<HTMLInputElement>(null);
  const canUseCamera = useMediaQuery("(pointer: coarse)");
  const cardSideRef = useRef<0 | 1>(0);
  const initialCompany = companies.find((company) => company.id === initialCompanyId) ?? companies[0];
  const [companyId, setCompanyId] = useState(initialCompany?.id ?? "");
  const [companyQuery, setCompanyQuery] = useState(initialCompany?.name ?? "");
  const [source, setSource] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [imageProcessing, setImageProcessing] = useState(false);
  const [cardScanning, setCardScanning] = useState(false);
  // Front and (optionally) back of the card, each with its own recognition.
  const [cardSides, setCardSides] = useState<CardSide[]>([]);
  const [cardError, setCardError] = useState("");
  const [cardDropActive, setCardDropActive] = useState(false);
  const [draftRestored, setDraftRestored] = useState(contactCreateDraft.restored);
  const submitAfterCompanyRef = useRef(false);
  const normalizedCurrentUserEmail = currentUserEmail.toLowerCase();
  const defaultInitiator = initiatorOptions.some((user) => user.email.toLowerCase() === normalizedCurrentUserEmail) ? normalizedCurrentUserEmail : "manual";
  const [initiatorChoice, setInitiatorChoice] = useState(defaultInitiator);
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(false);
  const cardResult = mergeOcrResults(cardSides.map((side) => side.result));

  // "Create contact" with a new company opens the company form first; once the company exists the contact is saved.
  useEffect(() => {
    if (!submitAfterCompanyRef.current || !companies.some((company) => company.id === companyId)) return;
    submitAfterCompanyRef.current = false;
    formRef.current?.requestSubmit();
  }, [companies, companyId]);

  function selectCompany(value: string) {
    const match = companyByName(companies, value);
    setCompanyQuery(value);
    setCompanyId(match?.id ?? "");
  }

  function fillField(name: string, value: string | undefined, onlyIfEmpty: boolean) {
    if (!value || !formRef.current) return;
    const element = formRef.current.elements.namedItem(name);
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      if (onlyIfEmpty && element.value.trim()) return;
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  // Opens "New company" over this form; the contact keeps everything entered and gets the new company selected.
  function createCompany(name: string, submitAfter = false) {
    onCreateCompany?.(name.trim(), cardResult, cardSides.map((side) => side.dataUrl), (company) => {
      setCompanyId(company.id);
      setCompanyQuery(company.name);
      submitAfterCompanyRef.current = submitAfter;
    });
  }

  // The front fills the form; a back side only fills what is still empty.
  function applyOcrResult(result: OcrResult, merged: OcrResult, onlyIfEmpty: boolean) {
    const { draft } = result;
    fillField("firstName", draft.first_name, onlyIfEmpty);
    fillField("lastName", draft.last_name, onlyIfEmpty);
    fillField("position", draft.position, onlyIfEmpty);
    fillField("phone", draft.phone, onlyIfEmpty);
    fillField("email", draft.email, onlyIfEmpty);
    fillField("linkedin", draft.linkedin, onlyIfEmpty);
    if (initialCompanyId || (onlyIfEmpty && companies.some((company) => company.id === companyId))) return;
    const match = matchOcrCompany(companies, merged);
    if (match) {
      setCompanyId(match.id);
      setCompanyQuery(match.name);
    } else if (merged.draft.company) {
      // Never leave the previously selected company on a card from another firm; the panel
      // under the scan offers to create it, and "Create contact" does so too.
      setCompanyId("");
      setCompanyQuery(merged.draft.company);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (imageProcessing || cardScanning) return;
    if (!companies.some((company) => company.id === companyId)) {
      if (onCreateCompany && companyQuery.trim().length >= 2) {
        createCompany(companyQuery, true);
        return;
      }
      setFieldError(event.currentTarget, "companyName", "Select an existing company from the list.");
      return;
    }
    setSubmitting(true);
    setRetry(false);
    const saved = await onSubmit(event, photoDataUrl);
    if (saved) contactCreateDraft.clear();
    setRetry(!saved);
    setSubmitting(false);
  }

  function chooseCardFile(side: 0 | 1, camera = false) {
    cardSideRef.current = side;
    (camera ? cardCameraRef : cardInputRef).current?.click();
  }

  // Dropped or pasted images go to the front first, then to the back.
  function takeCardImage(files: FileList | File[] | null | undefined) {
    const file = Array.from(files ?? []).find((item) => item.type.startsWith("image/"));
    if (!file) return false;
    void scanCard(file, cardSides[0] ? 1 : 0);
    return true;
  }

  async function scanCard(file: File, side: 0 | 1) {
    if (cardScanning) return;
    if (!OCR_CARD_TYPES.includes(file.type)) {
      setCardError("Use a JPG, PNG, WebP, BMP, or TIFF image of the card.");
      return;
    }
    setCardScanning(true);
    setCardError("");
    let dataUrl = "";
    const name = file.name || (side === 0 ? "business-card-front" : "business-card-back");
    const store = (result: OcrResult | null) => {
      const next = [...cardSides];
      next[side] = { dataUrl, name, result };
      setCardSides(next);
      return mergeOcrResults(next.map((item) => item.result));
    };
    try {
      dataUrl = await readFileAsDataUrl(file);
      // Both sides travel in one contact request, which the server caps (post_max_size=32M).
      if (dataUrl.length + (cardSides[side === 0 ? 1 : 0]?.dataUrl.length ?? 0) > CARD_IMAGES_MAX_CHARS) {
        setCardError("The two card photos are too large together. Use smaller photos (about 10 MB each).");
        return;
      }
      const body = new FormData();
      body.append("file", file);
      // On CPU a phone photo takes up to a minute (two passes for Latin cards); the server allows OCR_TIMEOUT_SECONDS=300.
      const response = await apiRequest<{ data: OcrResult }>("/ocr/business-card", { method: "POST", body }, "", 300_000);
      const merged = store(response.data);
      if (merged) applyOcrResult(response.data, merged, side === 1);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "ocr_no_text" && dataUrl) {
        store(null);
        setCardError("No text was recognized. The card image is attached; enter the contact details manually or try a clearer photo.");
      } else {
        setCardError(apiMessage(caught));
      }
    } finally {
      setCardScanning(false);
    }
  }

  function startOver() {
    contactCreateDraft.clear();
    formRef.current?.reset();
    setDraftRestored(false);
    setCardSides([]);
    setCardError("");
    setCompanyId(initialCompany?.id ?? "");
    setCompanyQuery(initialCompany?.name ?? "");
    setSource("");
    setPhotoDataUrl("");
    setInitiatorChoice(defaultInitiator);
  }

  const cardCompanyMatch = cardResult ? matchOcrCompany(companies, cardResult) : undefined;
  const cardCompanyMissing = Boolean(cardResult?.draft.company && !cardCompanyMatch && companyQuery.trim() === cardResult.draft.company.trim() && !companyId);

  return (
    <Modal title="Add contact manually" eyebrow="Contacts" onClose={onClose} closeOnBackdrop={false}>
      <form ref={formRef} {...contactCreateDraft.formProps} onSubmit={(event) => void submit(event)} onPaste={(event) => { if (OCR_INPUT_ENABLED && takeCardImage(event.clipboardData.files)) event.preventDefault(); }} className="entity-form contact-entry-form">
        {draftRestored && <div className="draft-restored-note field-full" role="status"><span>Your unsaved entries from the last time were restored.</span><button className="text-button" type="button" onClick={startOver}>Start over</button></div>}
        {OCR_INPUT_ENABLED && <section
          className={`ai-capture-panel field-full${cardDropActive ? " card-drop-active" : ""}`}
          onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); setCardDropActive(true); } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCardDropActive(false); }}
          onDrop={(event) => { event.preventDefault(); setCardDropActive(false); if (!takeCardImage(event.dataTransfer.files)) setCardError("Drop an image of the card: JPG, PNG, WebP, BMP, or TIFF."); }}
        >
          <div>
            <b>Scan business card</b>
            <small>Drop a photo here, paste it with Ctrl+V, or choose a file (up to 20 MB); Qwen3-VL fills the draft fields. Add the back side to fill in what the front lacks. Review everything before saving.</small>
          </div>
          <div className="ai-capture-actions">
            {cardSides.length < 2 && canUseCamera && <button className="secondary-button" type="button" disabled={cardScanning} onClick={() => chooseCardFile(cardSides[0] ? 1 : 0, true)}>{cardScanning ? "Scanning…" : cardSides[0] ? "📸 Photo of back side" : "📸 Take photo"}</button>}
            {cardSides.length < 2 && <button className="secondary-button" type="button" disabled={cardScanning} onClick={() => chooseCardFile(cardSides[0] ? 1 : 0)}>{cardScanning ? "Scanning…" : cardSides[0] ? "📷 Add back side" : "📷 Scan / upload card"}</button>}
            <input ref={cardCameraRef} className="image-input" type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void scanCard(file, cardSideRef.current); }} />
            <input ref={cardInputRef} className="image-input" type="file" accept={OCR_CARD_TYPES.join(",")} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void scanCard(file, cardSideRef.current); }} />
          </div>
          {cardSides.length > 0 && <div className="card-sides">{cardSides.map((side, index) => <div className="card-side" key={index}>
            <img src={side.dataUrl} alt={index === 0 ? "Front of the card" : "Back of the card"} />
            <div>
              <b>{index === 0 ? "Front" : "Back"}</b>
              <small>{side.result ? `${side.result.confidence} confidence` : "No text recognized"}</small>
              <span>
                <button className="text-button" type="button" disabled={cardScanning} onClick={() => chooseCardFile(index === 0 ? 0 : 1)}>Replace photo</button>
                {index === 1 && <> · <button className="text-button" type="button" disabled={cardScanning} onClick={() => setCardSides((current) => current.slice(0, 1))}>Remove</button></>}
              </span>
            </div>
          </div>)}</div>}
          {cardError && <div className="form-error" role="alert">{cardError}</div>}
          {cardResult && <div className="ocr-preview" aria-live="polite">
            <b>Recognized text · {cardResult.confidence} confidence</b>
            <ul className="ocr-lines">{(cardResult.lines ?? cardResult.raw_text.split("\n").map((text) => ({ text, type: "other" as const }))).map((line, index) => <li key={`${index}-${line.text}`} className={OCR_FILLED_LINE_TYPES.has(line.type) ? "ocr-line-filled" : ""}><span className={`ocr-tag ocr-tag-${line.type}`}>{OCR_LINE_LABELS[line.type] ?? OCR_LINE_LABELS.other}</span><span>{line.text}</span></li>)}</ul>
            <small>Highlighted lines were filled into the form; the rest is kept for reference.</small>
            {cardCompanyMatch && <small>Company matched to “{cardCompanyMatch.name}” in the CRM.</small>}
          </div>}
        </section>}
        {OCR_INPUT_ENABLED && <input name="businessCardDataUrl" type="hidden" value={cardSides[0]?.dataUrl ?? ""} />}
        {OCR_INPUT_ENABLED && <input name="businessCardFileName" type="hidden" value={cardSides[0]?.name ?? ""} />}
        {OCR_INPUT_ENABLED && <input name="businessCardBackDataUrl" type="hidden" value={cardSides[1]?.dataUrl ?? ""} />}
        {OCR_INPUT_ENABLED && <input name="businessCardBackFileName" type="hidden" value={cardSides[1]?.name ?? ""} />}
        <ImageField label="Contact photo" name="contactPhoto" value={photoDataUrl} onChange={setPhotoDataUrl} onProcessingChange={setImageProcessing} />
        <CompanyCombobox inputId="contact-create-company" label="Company *" companies={companies} value={companyQuery} onChange={selectCompany} required />
        {onCreateCompany && !companyId && companyQuery.trim().length >= 2 && <div className="company-missing-action field-full"><small>{cardCompanyMissing ? <>New company from the card: <b>{companyQuery.trim()}</b>.</> : <>“{companyQuery.trim()}” is not in the CRM yet.</>} “Create contact” first asks you to confirm the company details, then saves both.</small><button className="text-button" type="button" onClick={() => createCompany(companyQuery)}>Review company details</button></div>}
        <label className="field"><span>First name *</span><input name="firstName" required minLength={2} maxLength={100} autoFocus /></label>
        <label className="field"><span>Last name</span><input name="lastName" maxLength={100} /></label>
        <label className="field"><span>Position</span><input name="position" maxLength={150} placeholder="External Relations Director" /></label>
        <label className="field"><span>Phone</span><input name="phone" type="tel" maxLength={100} placeholder="+380…; +380…" /></label>
        <label className="field"><span>Contact status</span><select name="contactStatus" defaultValue="active"><option value="active">Active — contactable</option><option value="inactive">Inactive — do not contact</option></select></label>
        <label className="field"><span>Email</span><input name="email" type="email" maxLength={255} placeholder="name@company.com" /></label>
        <label className="field"><span>LinkedIn</span><input name="linkedin" inputMode="url" maxLength={255} placeholder="linkedin.com/in/..." /></label>
        <label className="field"><span>First contact source</span><select name="source" value={source} onChange={(event) => setSource(event.target.value)}><option value="">Not specified</option>{sourceOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>Initiated by *</span><select name="initiatedByUserEmail" required value={initiatorChoice} onChange={(event) => setInitiatorChoice(event.target.value)} aria-describedby="contact-initiator-help">{initiatorOptions.map((user) => <option key={user.email} value={user.email.toLowerCase()}>{user.name}</option>)}<option value="manual">Enter a name manually</option></select></label>
        {initiatorChoice === "manual" && <label className="field"><span>Initiator name *</span><input name="initiatedBy" required minLength={2} maxLength={120} autoComplete="name" placeholder="Enter the initiator's name" /></label>}
        {["Exhibition / Conference", "Other"].includes(source) && <label className="field field-full"><span>{source === "Other" ? "Source detail" : "Exhibition / event name"}</span><input name="sourceDetail" maxLength={255} /></label>}
        {source === "Referral (word of mouth)" && <label className="field field-full"><span>Referred by</span><input name="referredBy" maxLength={255} /></label>}
        <div className="reminder-note field-full" id="contact-initiator-help"><span>i</span><p><b>Record attribution</b><small>Select an active CRM user or enter a name manually. Manual names are stored as text and do not receive in-app notifications.</small></p></div>
        {retry && <div className="form-error field-full" role="alert">The contact was not saved. Your entries are preserved; try again when the connection is available.</div>}
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => { contactCreateDraft.clear(); onClose(); }}>Cancel</button><button className="primary-button" type="submit" disabled={imageProcessing || cardScanning || submitting}>{cardScanning ? "Scanning card…" : imageProcessing ? "Processing image…" : submitting ? "Saving…" : retry ? "Try again" : "Create contact"}</button></div>
      </form>
    </Modal>
  );
}

function TaskForm({ companies, contacts, taskStatusOptions, reminderLeadOptions, managerOptions, defaultOwner, initiatorOptions, currentUserEmail, initialCompanyId, canAddContact, onAddContact, onClose, onSubmit }: { companies: Company[]; contacts: Contact[]; taskStatusOptions: string[]; reminderLeadOptions: string[]; managerOptions: string[]; defaultOwner: string; initiatorOptions: CRMUser[]; currentUserEmail: string; initialCompanyId?: string; canAddContact: boolean; onAddContact: (draft: ContactDraft) => Promise<ContactCreationResult>; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<boolean> }) {
  const taskCreateDraft = useFormDraft("task-create");
  const restoredCompanyName = taskCreateDraft.initialValue("companyName");
  const initialCompany = companies.find((company) => company.id === initialCompanyId) ?? companyByName(companies, restoredCompanyName) ?? companies[0];
  const [companyId, setCompanyId] = useState(initialCompany?.id ?? "");
  const [companyQuery, setCompanyQuery] = useState(initialCompany?.name ?? "");
  const [contactPersonId, setContactPersonId] = useState(() => taskCreateDraft.initialValue("contactPersonId"));
  const [quickContactOpen, setQuickContactOpen] = useState(() => ["quickFirstName", "quickLastName", "quickPosition", "quickEmail", "quickPhone", "quickInitiatorName"].some(taskCreateDraft.has));
  const [quickContact, setQuickContact] = useState(() => ({ firstName: taskCreateDraft.initialValue("quickFirstName"), lastName: taskCreateDraft.initialValue("quickLastName"), position: taskCreateDraft.initialValue("quickPosition"), email: taskCreateDraft.initialValue("quickEmail"), phone: taskCreateDraft.initialValue("quickPhone") }));
  const [quickPhoto, setQuickPhoto] = useState("");
  const [quickPhotoProcessing, setQuickPhotoProcessing] = useState(false);
  const [quickError, setQuickError] = useState("");
  const normalizedCurrentUserEmail = currentUserEmail.toLowerCase();
  const defaultQuickInitiator = initiatorOptions.some((user) => user.email.toLowerCase() === normalizedCurrentUserEmail) ? normalizedCurrentUserEmail : "manual";
  const [quickInitiatorChoice, setQuickInitiatorChoice] = useState(() => taskCreateDraft.initialValue("quickInitiatorChoice", defaultQuickInitiator));
  const [quickInitiatorName, setQuickInitiatorName] = useState(() => taskCreateDraft.initialValue("quickInitiatorName"));
  const [noteDraft, setNoteDraft, clearNoteDraft] = useCookieDraft("task-create-description", "");
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(false);
  const [contactDate, setContactDate] = useState(() => taskCreateDraft.initialValue("contactDate", todayUser()));
  const [deadline, setDeadline] = useState(() => taskDeadlineDraftValue(taskCreateDraft.initialValue, taskDeadlineFromContactDate(taskCreateDraft.initialValue("contactDate", todayUser()), "month")));
  const [priorityDraft, setPriorityDraft] = useState<Task["priority"]>(() => {
    const drafted = taskCreateDraft.initialValue("priority", "Low") as Task["priority"];
    return TASK_PRIORITIES.includes(drafted) ? drafted : "Low";
  });
  const managerStorageKey = `crm:last-task-manager:${currentUserEmail.toLowerCase()}`;
  const [responsibleManager, setResponsibleManager] = useState(() => {
    const drafted = taskCreateDraft.initialValue("owner");
    const remembered = typeof window === "undefined" ? "" : window.localStorage.getItem(managerStorageKey) ?? "";
    return [drafted, remembered, defaultOwner].find((value) => managerOptions.includes(value)) ?? managerOptions[0] ?? "";
  });
  const companyContacts = contacts.filter((contact) => contact.companyId === companyId);
  const selectedCompanyBlacklisted = companies.find((company) => company.id === companyId)?.status === "Black List";

  function selectCompany(value: string) {
    const match = companyByName(companies, value);
    const changed = value !== companyQuery;
    setCompanyQuery(value);
    setCompanyId(match?.id ?? "");
    if (changed) {
      setContactPersonId("");
      resetQuickContact();
    }
  }

  function resetQuickContact() {
    setQuickContact({ firstName: "", lastName: "", position: "", email: "", phone: "" });
    setQuickPhoto("");
    setQuickPhotoProcessing(false);
    setQuickError("");
    setQuickInitiatorChoice(defaultQuickInitiator);
    setQuickInitiatorName("");
    setQuickContactOpen(false);
  }

  async function saveQuickContact() {
    if (quickPhotoProcessing) return void setQuickError("Wait until the photo finishes processing.");
    const result = await onAddContact({
      companyId,
      ...quickContact,
      initiatedBy: quickInitiatorChoice === "manual" ? quickInitiatorName : undefined,
      initiatedByUserEmail: quickInitiatorChoice === "manual" ? undefined : quickInitiatorChoice,
      photoDataUrl: quickPhoto,
    });
    if (!result.contact) {
      setQuickError(result.error ?? "The contact could not be created.");
      return;
    }
    setContactPersonId(result.contact.id);
    resetQuickContact();
  }

  return (
    <Modal title="New task" eyebrow="Activity" onClose={onClose} closeOnBackdrop={false}>
      <form {...taskCreateDraft.formProps} onSubmit={(event) => { if (quickContactOpen) { event.preventDefault(); setQuickError("Save or cancel the quick contact before creating the task."); } else if (!companies.some((company) => company.id === companyId)) { event.preventDefault(); setFieldError(event.currentTarget, "companyName", "Select an existing company from the list."); } else { setSubmitting(true); setRetry(false); void onSubmit(event).then((saved) => { if (saved) { taskCreateDraft.clear(); clearNoteDraft(); } setRetry(!saved); }).finally(() => setSubmitting(false)); } }} className="entity-form">
        <input name="companyId" type="hidden" value={companyId} />
        <label className="field field-full"><span>Task title *</span><input name="title" list="task-title-options" required minLength={3} maxLength={255} autoFocus placeholder="Choose or enter a task title" /><datalist id="task-title-options"><option value="Follow Up" /><option value="Introductory meeting" /></datalist></label>
        <CompanyCombobox inputId="task-create-company" label="Company *" companies={companies} value={companyQuery} onChange={selectCompany} required />
        <div className="contact-field-with-action">
          <label className="field"><span>Contact person</span><select name="contactPersonId" value={contactPersonId} onChange={(event) => setContactPersonId(event.target.value)}><option value="">Not specified</option>{companyContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>
          {canAddContact && <button className="secondary-button" type="button" aria-expanded={quickContactOpen} aria-controls="quick-contact-panel" onClick={() => { setQuickContactOpen((open) => !open); setQuickError(""); }}>＋ Add contact</button>}
        </div>
        {quickContactOpen && <section className="quick-contact-panel field-full" id="quick-contact-panel" aria-label="Add a contact to this task">
          <div className="quick-contact-head"><div><b>Add contact without leaving this task</b><small>The new contact will be linked to {companyName(companies, companyId)} and selected above.</small></div><button className="icon-button" type="button" aria-label="Close quick contact form" onClick={resetQuickContact}>×</button></div>
          <div className="quick-contact-grid">
            <label><span>First name *</span><input name="quickFirstName" value={quickContact.firstName} onChange={(event) => setQuickContact((current) => ({ ...current, firstName: event.target.value }))} required minLength={2} maxLength={100} /></label>
            <label><span>Last name</span><input name="quickLastName" value={quickContact.lastName} onChange={(event) => setQuickContact((current) => ({ ...current, lastName: event.target.value }))} maxLength={100} /></label>
            <label><span>Position</span><input name="quickPosition" value={quickContact.position} onChange={(event) => setQuickContact((current) => ({ ...current, position: event.target.value }))} maxLength={150} /></label>
            <label><span>Email</span><input name="quickEmail" type="email" value={quickContact.email} onChange={(event) => setQuickContact((current) => ({ ...current, email: event.target.value }))} maxLength={255} /></label>
            <label><span>Phone</span><input name="quickPhone" type="tel" value={quickContact.phone} onChange={(event) => setQuickContact((current) => ({ ...current, phone: event.target.value }))} maxLength={50} /></label>
            <label><span>Initiated by *</span><select name="quickInitiatorChoice" value={quickInitiatorChoice} onChange={(event) => { setQuickInitiatorChoice(event.target.value); setQuickError(""); }}>{initiatorOptions.map((user) => <option key={user.email} value={user.email.toLowerCase()}>{user.name}</option>)}<option value="manual">Enter a name manually</option></select></label>
            {quickInitiatorChoice === "manual" && <label><span>Initiator name *</span><input name="quickInitiatorName" value={quickInitiatorName} onChange={(event) => setQuickInitiatorName(event.target.value)} required minLength={2} maxLength={120} placeholder="Enter the initiator's name" /></label>}
          </div>
          <ImageField label="Contact photo" name="quickContactPhoto" value={quickPhoto} onChange={setQuickPhoto} onProcessingChange={setQuickPhotoProcessing} />
          {quickError && <div className="form-error" role="alert">{quickError}</div>}
          <div className="quick-contact-actions"><button className="secondary-button" type="button" onClick={resetQuickContact}>Cancel</button><button className="primary-button" type="button" disabled={quickPhotoProcessing} onClick={saveQuickContact}>{quickPhotoProcessing ? "Processing image…" : "Save contact"}</button></div>
        </section>}
        <label className="field"><span>Contact date *</span><input name="contactDate" type="date" required value={contactDate} onChange={(event) => { const value = event.target.value; setContactDate(value); setDeadline((current) => current ? taskDeadlineFromContactDate(value, "month") : ""); }} /></label>
        <div className="field field-full task-deadline-field"><div className="task-deadline-row"><TaskDeadlineInput value={deadline} onChange={setDeadline} /><div className="deadline-presets" aria-label="Quick deadline choices"><button type="button" disabled={!deadline} onClick={() => setDeadline(taskDeadlineFromContactDate(contactDate, "week"))}>1 week</button><button type="button" disabled={!deadline} onClick={() => setDeadline(taskDeadlineFromContactDate(contactDate, "two-weeks"))}>2 weeks</button><button type="button" disabled={!deadline} onClick={() => setDeadline(taskDeadlineFromContactDate(contactDate, "month"))}>1 month</button></div></div></div>
        <label className="field"><span>Responsible manager *</span><select name="owner" required value={responsibleManager} onChange={(event) => { setResponsibleManager(event.target.value); window.localStorage.setItem(managerStorageKey, event.target.value); }}>{managerOptions.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
        <label className="field"><span>Status *</span><select name="status" defaultValue={taskStatusOptions[0] ?? ""}>{taskStatusOptions.map((status) => <option key={status}>{status}</option>)}</select></label>
        {selectedCompanyBlacklisted ? <div className="field priority-locked-field"><span>Priority</span><b>Unavailable for Black List companies</b></div> : <label className="field"><span>Priority *</span><select className={priorityToneClass(priorityDraft)} name="priority" value={priorityDraft} onChange={(event) => setPriorityDraft(event.target.value as Task["priority"])}>{TASK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>}
        <label className="field field-full"><span>Description</span><textarea name="note" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={4} maxLength={4000} placeholder="Context, expected result, and links" spellCheck autoCorrect="on" autoCapitalize="sentences" /><VoiceInputButton disabled={submitting} onText={(text) => setNoteDraft((current) => appendVoiceText(current, text, 4000))} /><TranslateToEnglishButton text={noteDraft} onChange={setNoteDraft} /></label>
        <TaskParticipantsField contacts={companyContacts} contactPersonId={contactPersonId} managers={managerOptions} />
        <fieldset className="settings-list field-full"><legend>Reminder advance notice</legend>{reminderLeadOptions.map((lead) => <label key={lead}><input name="reminderLeads" type="checkbox" value={lead} /><span>{lead}</span></label>)}</fieldset>
        <div className="reminder-note field-full"><span>◷</span><p><b>Calendar and email reminders</b><small>The CRM provides an .ics file. Scheduled email delivery requires an active User linked to the selected CJN Manager.</small></p></div>
        {retry && <div className="form-error field-full" role="alert">The task was not saved. Your entries are preserved; try again when the connection is available.</div>}
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => { taskCreateDraft.clear(); clearNoteDraft(); onClose(); }}>Cancel</button><button className="primary-button" type="submit" disabled={quickContactOpen || submitting}>{submitting ? "Saving…" : retry ? "Try again" : "Create task"}</button></div>
      </form>
    </Modal>
  );
}

function UserForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<boolean> }) {
  const userCreateDraft = useFormDraft("user-create");
  const [delivery, setDelivery] = useState<"invite" | "temporary_password">("invite");
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(false);
  return (
    <Modal title="New user" eyebrow="Team access" onClose={onClose} closeOnBackdrop={false}>
      <form {...userCreateDraft.formProps} className="entity-form" onSubmit={(event) => { setSubmitting(true); setRetry(false); void onSubmit(event).then((saved) => { if (saved) userCreateDraft.clear(); setRetry(!saved); }).finally(() => setSubmitting(false)); }}>
        <label className="field field-full"><span>Full name *</span><input name="name" required minLength={2} maxLength={120} autoFocus placeholder="First and last name" /></label>
        <label className="field field-full"><span>Work email *</span><input name="email" type="email" required maxLength={254} placeholder="name@company.com" /></label>
        <label className="field field-full"><span>Role</span><select name="role" defaultValue="Editor"><option>Editor</option><option>Manager</option><option>Read-only</option><option>Admin</option></select></label>
        <div className="role-hint-list field-full">{ROLE_ORDER.map((role) => <div key={role}><StaticStatusBadge value={role} /><span><b>{ROLE_DETAILS[role].summary}</b><small>{ROLE_DETAILS[role].permissions.join(" · ")}</small></span></div>)}</div>
        <fieldset className="settings-list field-full"><legend>Initial password setup</legend><label><input name="delivery" type="radio" value="invite" checked={delivery === "invite"} onChange={() => setDelivery("invite")} /><span>Email invitation with a one-time password link</span></label><label><input name="delivery" type="radio" value="temporary_password" checked={delivery === "temporary_password"} onChange={() => setDelivery("temporary_password")} /><span>Temporary password set by Admin</span></label></fieldset>
        {delivery === "temporary_password" && <label className="field field-full"><span>Temporary password *</span><input name="temporaryPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></label>}
        <div className="reminder-note field-full"><span>＋</span><p><b>{delivery === "invite" ? "Email invitation" : "Manual account setup"}</b><small>{delivery === "invite" ? "The user receives a 24-hour one-time link to set a password. If SMTP fails, the account remains created and Admin can set a temporary password later." : "The active user can sign in immediately and must replace the temporary password after the first sign-in."}</small></p></div>
        {retry && <div className="form-error field-full" role="alert">The user was not created. Your entries are preserved; try again.</div>}
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => { userCreateDraft.clear(); onClose(); }}>Cancel</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Saving…" : retry ? "Try again" : delivery === "invite" ? "Send invitation" : "Add user"}</button></div>
      </form>
    </Modal>
  );
}

function ProfileModal({ identity, onClose, onSave }: { identity: AuthIdentity; onClose: () => void; onSave: (identity: AuthIdentity, currentPassword: string, newPassword: string) => string | null }) {
  const profileDraft = useFormDraft("profile");
  const [error, setError] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState(identity.photoDataUrl ?? "");
  const [imageProcessing, setImageProcessing] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (imageProcessing) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const phone = String(data.get("phone") ?? "").trim();
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmPassword = String(data.get("confirmPassword") ?? "");
    if (name.length < 2) return void setFieldError(form, "name", "Enter at least 2 characters.");
    if (!EMAIL_PATTERN.test(email)) return void setFieldError(form, "email", "Enter a valid work email address.");
    if (phone && !/^[+()\d\s.-]{7,24}$/.test(phone)) return void setFieldError(form, "phone", "Enter a valid phone number.");
    if (email !== identity.email.toLowerCase() && !currentPassword) return void setFieldError(form, "currentPassword", "Enter your current password to change email.");
    if (newPassword && !isStrongPassword(newPassword)) return void setFieldError(form, "newPassword", "Use at least 8 characters with letters and numbers.");
    if (newPassword && newPassword === currentPassword) return void setFieldError(form, "newPassword", "Choose a different password.");
    if (newPassword !== confirmPassword) return void setFieldError(form, "confirmPassword", "Passwords do not match.");
    const saveError = onSave({ ...identity, name, email, phone, photoDataUrl: photoDataUrl || undefined }, currentPassword, newPassword);
    if (saveError) setError(saveError); else profileDraft.clear();
  }

  return (
    <Modal title="My profile" eyebrow="Personal details" onClose={onClose}>
      <form {...profileDraft.formProps} className="entity-form" onSubmit={submit}>
        <ImageField label="Profile photo" name="profilePhoto" value={photoDataUrl} onChange={setPhotoDataUrl} onProcessingChange={setImageProcessing} />
        <label className="field field-full"><span>Full name</span><input name="name" defaultValue={identity.name} required minLength={2} maxLength={120} autoFocus /></label>
        <label className="field field-full"><span>Work email</span><input name="email" type="email" defaultValue={identity.email} required maxLength={254} /></label>
        <label className="field field-full"><span>Phone</span><input name="phone" type="tel" maxLength={24} defaultValue={identity.phone ?? ""} /></label>
        <div className="form-divider field-full"><span>Password and login confirmation</span></div>
        <label className="field field-full"><span>Current password</span><input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} placeholder="Required for email or password changes" /></label>
        <label className="field"><span>New password</span><input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} placeholder="Leave blank to keep current" /></label>
        <label className="field"><span>Confirm new password</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} /></label>
        {error && <div className="form-error field-full" role="alert">{error}</div>}
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => { profileDraft.clear(); onClose(); }}>Cancel</button><button className="primary-button" type="submit" disabled={imageProcessing}>{imageProcessing ? "Processing image…" : "Save profile"}</button></div>
      </form>
    </Modal>
  );
}

function SettingsModal({ preferences, systemSettings, onClose, onSave }: { preferences: Preferences; systemSettings: SystemSettings | null; onClose: () => void; onSave: (preferences: Preferences, systemSettings?: SystemSettings) => Promise<boolean> }) {
  const settingsDraft = useFormDraft("settings");
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextPreferences = {
      deadlineReminders: data.get("deadlineReminders") === "on",
      overdueNotifications: data.get("overdueNotifications") === "on",
      workspaceSummary: data.get("workspaceSummary") === "on",
    };
    const domains = String(data.get("registrationAllowedDomains") ?? "").split(/[\s,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean);
    setSubmitting(true);
    setRetry(false);
    const saved = await onSave(nextPreferences, systemSettings ? { systemNotificationEmail: String(data.get("systemNotificationEmail") ?? "").trim(), notifyNewRegistrations: data.get("notifyNewRegistrations") === "on", registrationAllowedDomains: domains } : undefined);
    if (saved) settingsDraft.clear();
    setSubmitting(false);
    setRetry(!saved);
  }

  return (
    <Modal title="Settings" eyebrow="Workspace preferences" onClose={onClose}>
      <form {...settingsDraft.formProps} className="entity-form" onSubmit={submit}>
        <label className="field"><span>Interface language</span><input value="English" readOnly /></label>
        <label className="field"><span>Timezone</span><input value={CLIENT_TIME_ZONE_LABEL} readOnly /></label>
        <fieldset className="settings-list field-full"><legend>Notifications</legend><label><input name="deadlineReminders" type="checkbox" defaultChecked={preferences.deadlineReminders} /> <span>My upcoming deadlines</span></label><label><input name="overdueNotifications" type="checkbox" defaultChecked={preferences.overdueNotifications} /> <span>My overdue tasks</span></label><label><input name="workspaceSummary" type="checkbox" defaultChecked={preferences.workspaceSummary} /> <span>My activity summary</span></label></fieldset>
        {systemSettings && <><div className="form-divider field-full"><span>Registration and system email</span></div><label className="field field-full"><span>Allowed registration domains</span><textarea name="registrationAllowedDomains" rows={3} defaultValue={systemSettings.registrationAllowedDomains.join("\n")} placeholder="company.com&#10;subsidiary.com" /></label><label className="field field-full"><span>System notification email</span><input name="systemNotificationEmail" type="email" defaultValue={systemSettings.systemNotificationEmail} placeholder="admin@company.com" /></label><fieldset className="settings-list field-full"><legend>New registrations</legend><label><input name="notifyNewRegistrations" type="checkbox" defaultChecked={systemSettings.notifyNewRegistrations} /><span>Notify the system email when a user registers</span></label></fieldset></>}
        {retry && <div className="form-error field-full" role="alert">Settings were not saved. Your entries are preserved; try again.</div>}
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => { settingsDraft.clear(); onClose(); }}>Cancel</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Saving…" : retry ? "Try again" : "Save settings"}</button></div>
      </form>
    </Modal>
  );
}
