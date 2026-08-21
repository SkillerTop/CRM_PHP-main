"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

type View =
  | "dashboard"
  | "pipeline"
  | "companies"
  | "contacts"
  | "activity"
  | "lookups"
  | "users"
  | "audit";

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
  logoDataUrl?: string;
  description: string;
};

type ContactStatus = "Active" | "Inactive";

type Contact = {
  id: string;
  companyId: string;
  status: ContactStatus;
  name: string;
  position: string;
  email: string;
  phone: string;
  linkedin?: string;
  source: string;
  sourceDetail?: string;
  referredBy?: string;
  owner: string;
  initiatedBy?: string;
  ownerUserEmail?: string;
  initiatedByUserEmail?: string;
  photoDataUrl?: string;
};

type Task = {
  id: string;
  companyId: string;
  title: string;
  contactDate?: string;
  deadline: string;
  owner: string;
  createdBy?: string;
  ownerUserEmail?: string;
  createdByUserEmail?: string;
  contactPersonId?: string;
  status: string;
  priority: "High" | "Medium" | "Normal";
  note: string;
  outcomeStatus?: string;
  outcomeNotes?: string;
  reminderLeads?: string[];
};

type TaskComment = {
  id: string;
  taskId: string;
  author: string;
  createdAt: string;
  text: string;
};

type AuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
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
  name: string;
  email: string;
  role: Role;
  state: "Active" | "Inactive" | "Pending";
  lastLogin: string;
  photoDataUrl?: string;
};

type AuthIdentity = {
  name: string;
  email: string;
  accountEmail: string;
  method: "Email";
  role: Role;
  phone?: string;
  photoDataUrl?: string;
};

type LookupItem = { id: string; value: string; active: boolean };
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
  companyName?: string;
  status?: ContactStatus;
  firstName: string;
  lastName?: string;
  position?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  source?: string;
  sourceDetail?: string;
  referredBy?: string;
  initiatedBy?: string;
  initiatedByUserEmail?: string;
  photoDataUrl?: string;
};

type ContactCreationResult = {
  contact?: Contact;
  field?: keyof ContactDraft;
  error?: string;
};

type ToastState = { message: string; tone: "success" | "warning" };

const DEFAULT_PREFERENCES: Preferences = { deadlineReminders: true, overdueNotifications: true, workspaceSummary: true };
const CONTACT_STATUSES: ContactStatus[] = ["Active", "Inactive"];

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

const TEST_PASSWORD = "Client2026";

const CJN_MANAGER_VALUES = [
  "Andrey Zherebetsky",
  "Olga Kalnauz",
  "Vitalii Vyshnevskyi",
  "Mikhail Bardin",
  "Maksym Zarvanskyi",
  "Yurii Maksymov",
  "Dmytro Volik",
  "Ivan Tatko",
  "Mykhailo Balanovskyi",
  "Mariia Klimova",
  "Oleksandr Zherebetskyi",
  "Olga Kucherenko",
];

const RELATIONSHIP_STATUSES = [
  "New Organization",
  "Follow-up Active",
  "Awaiting Response",
  "Active Relationship",
  "Inactive",
] as const;

const LOOKUP_SEED: LookupGroup[] = [
  { type: "company-type", label: "Company Type", items: ["Shipyard", "Ship design", "Equipment", "Equipment provider", "Software developer"].map((value, index) => ({ id: `company-type-${index + 1}`, value, active: true })) },
  { type: "client-status", label: "Relationship Status", items: RELATIONSHIP_STATUSES.map((value, index) => ({ id: `client-status-${index + 1}`, value, active: true })) },
  { type: "task-status", label: "Task Status", items: ["Not Started", "Started", "Completed", "Canceled", "Deferred"].map((value, index) => ({ id: `task-status-${index + 1}`, value, active: true })) },
  { type: "outcome-status", label: "Outcome Status", items: ["Positive / interested", "Neutral / pending", "Negative / not interested", "No response"].map((value, index) => ({ id: `outcome-status-${index + 1}`, value, active: true })) },
  { type: "contact-source", label: "Contact Source", items: ["Exhibition / Conference", "Referral (word of mouth)", "Inbound LinkedIn", "Outbound LinkedIn", "Inbound (website / email)", "Outbound (cold outreach)", "Partner", "Other"].map((value, index) => ({ id: `contact-source-${index + 1}`, value, active: true })) },
  { type: "reminder-lead", label: "Reminder Advance Notice", items: ["1 week before", "1 day before", "2 hours before", "1 hour before"].map((value, index) => ({ id: `reminder-lead-${index + 1}`, value, active: true })) },
  { type: "cjn-manager", label: "CJN Manager", items: CJN_MANAGER_VALUES.map((value, index) => ({ id: `cjn-manager-${index + 1}`, value, active: true })) },
];

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

const INITIAL_COMPANIES: Company[] = [
  {
    id: "C-0001",
    name: "Jun Engineering",
    kind: "Ship design",
    country: "South Korea",
    city: "Jinju-si",
    status: "Awaiting Response",
    contacts: 2,
    lastContact: "2026-07-24",
    owner: "Vitalii Vyshnevskyi",
    website: "jun-eng.kr",
    description:
      "Offshore renewables, electrical and structural design, ship design and additive manufacturing.",
  },
  {
    id: "C-0002",
    name: "Keppel AmFELS",
    kind: "Shipyard",
    country: "USA",
    city: "Brownsville",
    status: "Inactive",
    contacts: 1,
    lastContact: "2026-06-18",
    owner: "Andrey Zherebetsky",
    website: "seatrium.com",
    description:
      "Offshore fabrication and shipbuilding yard at the Port of Brownsville, Texas.",
  },
  {
    id: "C-0003",
    name: "CONRAD Shipyard",
    kind: "Shipyard",
    country: "USA",
    city: "Morgan City",
    status: "Active Relationship",
    contacts: 3,
    lastContact: "2026-07-29",
    owner: "Mikhail Bardin",
    website: "conradindustries.com",
    description:
      "Civil and government vessels, autonomous platforms, barges, dredges and repair services.",
  },
  {
    id: "C-0004",
    name: "Thoma-Sea Marine",
    kind: "Shipyard",
    country: "USA",
    city: "Houma",
    status: "Follow-up Active",
    contacts: 2,
    lastContact: "2026-07-28",
    owner: "Mikhail Bardin",
    website: "thoma-sea.com",
    description:
      "Research vessels, ferries and diesel-electric platforms for public and private operators.",
  },
  {
    id: "C-0005",
    name: "Eastern Shipbuilding Group",
    kind: "Shipyard",
    country: "USA",
    city: "Panama City",
    status: "Follow-up Active",
    contacts: 2,
    lastContact: "2026-07-21",
    owner: "Mikhail Bardin",
    website: "easternshipbuilding.com",
    description:
      "Builder of escort tugs, ferries, dredges and offshore support vessels.",
  },
  {
    id: "C-0006",
    name: "Fincantieri Marine Group",
    kind: "Shipyard",
    country: "USA",
    city: "Green Bay",
    status: "Follow-up Active",
    contacts: 2,
    lastContact: "2026-07-30",
    owner: "Vitalii Vyshnevskyi",
    website: "fincantierimarinegroup.com",
    description:
      "Naval and civil shipbuilding group with three US yards and engineering centers.",
  },
  {
    id: "C-0007",
    name: "ICE Marine Design",
    kind: "Ship design",
    country: "United Kingdom",
    city: "London",
    status: "New Organization",
    contacts: 2,
    lastContact: "2026-07-25",
    owner: "Olga Kalnauz",
    website: "icedesign.info",
    description:
      "International marine engineering group with design teams in Romania, Croatia and the UK.",
  },
  {
    id: "C-0008",
    name: "Norsepower",
    kind: "Equipment",
    country: "Finland",
    city: "Helsinki",
    status: "Follow-up Active",
    contacts: 2,
    lastContact: "2026-07-27",
    owner: "Olga Kalnauz",
    website: "norsepower.com",
    description:
      "Rotor Sail wind-assisted propulsion systems for merchant shipping.",
  },
  {
    id: "C-0009",
    name: "Baltic Workboats",
    kind: "Shipyard",
    country: "Estonia",
    city: "Nasva",
    status: "Active Relationship",
    contacts: 3,
    lastContact: "2026-07-30",
    owner: "Vitalii Vyshnevskyi",
    website: "bwb.ee",
    description:
      "High-speed workboats, patrol vessels and ferries for international operators.",
  },
];

const INITIAL_CONTACTS: Contact[] = [
  { id: "K01", companyId: "C-0001", status: "Active", name: "Seonju Moon", position: "External Relations Manager", email: "junglobal@jun-eng.kr", phone: "+82 10 4845 4889", source: "Exhibition / Conference", sourceDetail: "SMM Hamburg", owner: "Vitalii Vyshnevskyi" },
  { id: "K02", companyId: "C-0001", status: "Active", name: "Hyeong Jin Jeon", position: "CEO", email: "juneng0214@gmail.com", phone: "+82 55 761 0634", source: "Referral (word of mouth)", owner: "Vitalii Vyshnevskyi" },
  { id: "K03", companyId: "C-0002", status: "Active", name: "Bernardino Salinas", position: "Engineering Manager", email: "bernardino.salinas@keppelamfels.com", phone: "+1 956 592 6175", source: "Outbound (cold outreach)", owner: "Andrey Zherebetsky" },
  { id: "K04", companyId: "C-0003", status: "Active", name: "Rene J. Leonard", position: "Vice President", email: "rjleonard@conradindustries.com", phone: "+1 985 665 9057", source: "Referral (word of mouth)", owner: "Mikhail Bardin" },
  { id: "K05", companyId: "C-0003", status: "Active", name: "Shaun D. Hunter", position: "General Manager", email: "sdhunter@conradindustries.com", phone: "+1 985 413 9709", source: "Referral (word of mouth)", owner: "Mikhail Bardin" },
  { id: "K06", companyId: "C-0006", status: "Active", name: "Terrence Hickey", position: "Director Engineering", email: "terrence.hickey@us.fincantieri.com", phone: "—", source: "Outbound LinkedIn", owner: "Vitalii Vyshnevskyi" },
  { id: "K07", companyId: "C-0007", status: "Active", name: "Jason Nunn", position: "External Relations Director", email: "jason.nunn@icedesign.info", phone: "—", source: "Outbound LinkedIn", owner: "Olga Kalnauz" },
  { id: "K08", companyId: "C-0008", status: "Active", name: "Dirk Höflich", position: "Director, Client Relations", email: "dirk.hoflich@norsepower.com", phone: "+49 151 2910 0117", source: "Inbound (website / email)", owner: "Olga Kalnauz" },
  { id: "K09", companyId: "C-0009", status: "Active", name: "Karl-Gustav Kalm", position: "External Relations Director", email: "karl.kalm@bwb.ee", phone: "+372 45 21 140", source: "Exhibition / Conference", sourceDetail: "Industry conference", owner: "Vitalii Vyshnevskyi" },
];

const INITIAL_TASKS: Task[] = [
  { id: "T-0001", companyId: "C-0001", title: "SMM 2026 — confirm meeting slot", deadline: "2026-08-03T10:00", owner: "Vitalii Vyshnevskyi", status: "Started", priority: "High", note: "Confirm stand visit and share the updated engineering capability deck." },
  { id: "T-0002", companyId: "C-0004", title: "Review technical scope before call", deadline: "2026-08-01T15:30", owner: "Mikhail Bardin", status: "Started", priority: "High", note: "Prepare three delivery scenarios and clarify vessel class requirements." },
  { id: "T-0003", companyId: "C-0006", title: "Follow up with engineering director", deadline: "2026-07-28T10:00", owner: "Vitalii Vyshnevskyi", status: "Not Started", priority: "High", note: "Previous contact changed role; re-establish the engineering relationship." },
  { id: "T-0004", companyId: "C-0005", title: "Solution brief feedback", deadline: "2026-08-04T11:00", owner: "Mikhail Bardin", status: "Not Started", priority: "Medium", note: "Ask whether the delivery scope, responsibilities and timing assumptions are clear." },
  { id: "T-0005", companyId: "C-0007", title: "Send mutual NDA", deadline: "2026-08-07T12:00", owner: "Olga Kalnauz", status: "Not Started", priority: "Normal", note: "Use the approved 2026 NDA template." },
  { id: "T-0006", companyId: "C-0008", title: "Rotor Sail integration workshop", deadline: "2026-08-10T09:00", owner: "Olga Kalnauz", status: "Started", priority: "Medium", note: "Align available CAD formats and engineering work packages." },
  { id: "T-0007", companyId: "C-0003", title: "Monthly delivery check-in", deadline: "2026-07-30T16:00", owner: "Mikhail Bardin", status: "Completed", priority: "Normal", note: "Meeting held, action points circulated." },
  { id: "T-0008", companyId: "C-0009", title: "Prepare repeat-client engagement plan", deadline: "2026-08-02T14:00", owner: "Vitalii Vyshnevskyi", status: "Started", priority: "High", note: "Include the agreed delivery approach and relevant prior-project context." },
];

const INITIAL_AUDIT: AuditEvent[] = [
  { id: "E-1048", at: "2026-07-31 10:42", actor: "Vitalii Vyshnevskyi", action: "FIELD CHANGE", entity: "Task · T-0001", detail: "Deadline: 2026-08-01 10:00 → 2026-08-03 10:00" },
  { id: "E-1047", at: "2026-07-31 10:18", actor: "Mikhail Bardin", action: "COMMENT", entity: "Company · C-0004", detail: "Added note after technical alignment call" },
  { id: "E-1046", at: "2026-07-30 16:04", actor: "Mikhail Bardin", action: "STATUS CHANGE", entity: "Task · T-0007", detail: "Started → Completed" },
  { id: "E-1045", at: "2026-07-30 14:33", actor: "Andrey Zherebetsky", action: "FIELD CHANGE", entity: "Contact · K08", detail: "Phone number updated" },
  { id: "E-1044", at: "2026-07-30 09:51", actor: "Vitalii Vyshnevskyi", action: "FIELD CHANGE", entity: "Task · T-0008", detail: "Reminder advance notice: — → 1 day before" },
];

const INITIAL_TASK_COMMENTS: TaskComment[] = [
  { id: "CM-001", taskId: "T-0001", author: "Vitalii Vyshnevskyi", createdAt: "2026-07-31 10:44", text: "The meeting request was sent. Waiting for the final stand number." },
  { id: "CM-002", taskId: "T-0002", author: "Mikhail Bardin", createdAt: "2026-07-31 10:20", text: "Technical scope and delivery scenarios are ready for review." },
];

const INITIAL_USERS: CRMUser[] = [
  { name: "Andrey Zherebetsky", email: "admin@cjn.example", role: "Admin", state: "Active", lastLogin: "2026-07-31 08:54" },
  { name: "Mikhail Bardin", email: "m.bardin@cjn.example", role: "Manager", state: "Active", lastLogin: "2026-07-31 09:17" },
  { name: "Vitalii Vyshnevskyi", email: "v.vyshnevskyi@cjn.example", role: "Editor", state: "Active", lastLogin: "2026-07-31 10:31" },
  { name: "Olga Kalnauz", email: "o.kalnauz@cjn.example", role: "Editor", state: "Active", lastLogin: "2026-07-30 15:42" },
  { name: "Yurii Maksymov", email: "y.maksymov@cjn.example", role: "Read-only", state: "Active", lastLogin: "2026-07-29 11:02" },
];

const VIEW_META: Record<View, { label: string; eyebrow: string; icon: string }> = {
  dashboard: { label: "Dashboard", eyebrow: "Team overview", icon: "⌂" },
  pipeline: { label: "Relationship Board", eyebrow: "Client workflow", icon: "◇" },
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

function formatDateTime(value: string) {
  if (!value) return "—";
  return value.replace("T", " · ");
}

function currentKyivStamp() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function todayKyiv() {
  return currentKyivStamp().slice(0, 10);
}

function kyivGreeting() {
  const hour = Number(currentKyivStamp().slice(11, 13));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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

function isOverdue(task: Task) {
  return !["Completed", "Canceled", "Deferred"].includes(task.status) && Boolean(task.deadline) && task.deadline.replace("T", " ") < currentKyivStamp();
}

function isOpenTask(task: Task) {
  return !["Completed", "Canceled", "Deferred"].includes(task.status);
}

function websiteHref(value: string) {
  if (!value) return "#";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
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

function contactCount(contacts: Contact[], companyId: string) {
  return contacts.filter((contact) => contact.companyId === companyId).length;
}

function openTaskLabel(count: number) {
  return `${count} open ${count === 1 ? "task" : "tasks"}`;
}

function nextActivityLabel(tasks: Task[], companyId?: string) {
  const nextTask = tasks
    .filter((task) => (!companyId || task.companyId === companyId) && isOpenTask(task) && Boolean(task.deadline))
    .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  return nextTask ? `${isOverdue(nextTask) ? "Overdue · " : ""}${formatDateTime(nextTask.deadline)}` : "No open activity";
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?";
}

function autocompleteRank(primary: string, values: string[], query: string) {
  const normalizedPrimary = primary.toLowerCase();
  if (normalizedPrimary.startsWith(query)) return 0;
  if (normalizedPrimary.split(/\s+/).some((word) => word.startsWith(query))) return 1;
  if (normalizedPrimary.includes(query)) return 2;
  return values.some((value) => value.toLowerCase().includes(query)) ? 3 : 4;
}

function Avatar({ name, src, className = "avatar", lazy = false }: { name: string; src?: string; className?: string; lazy?: boolean }) {
  return (
    <span className={className} aria-hidden="true">
      {src ? <img src={src} alt="" loading={lazy ? "lazy" : undefined} decoding="async" /> : initials(name)}
    </span>
  );
}

function EntityLogo({ name, src, className = "company-logo", lazy = false }: { name: string; src?: string; className?: string; lazy?: boolean }) {
  return (
    <span className={className} aria-hidden="true">
      {src ? <img src={src} alt="" loading={lazy ? "lazy" : undefined} decoding="async" /> : name.slice(0, 2).toUpperCase()}
    </span>
  );
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

function CompanyPicker({ companies, defaultCompanyId, autoFocus = false }: { companies: Company[]; defaultCompanyId?: string; autoFocus?: boolean }) {
  const initialCompany = companies.find((company) => company.id === defaultCompanyId);
  const [query, setQuery] = useState(initialCompany?.name ?? "");
  const [selectedId, setSelectedId] = useState(initialCompany?.id ?? "");
  const [open, setOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId().replace(/:/g, "");
  const inputId = `contact-company-${generatedId}`;
  const listId = `${inputId}-suggestions`;
  const helpId = `${inputId}-help`;
  const normalizedQuery = query.trim().toLowerCase();
  const selectedCompany = companies.find((company) => company.id === selectedId);
  const suggestions = useMemo(() => {
    const ranked = companies
      .filter((company) => !normalizedQuery || [company.name, company.city, company.country].some((value) => value.toLowerCase().includes(normalizedQuery)))
      .sort((a, b) => {
        const rank = (company: Company) => {
          const name = company.name.toLowerCase();
          if (!normalizedQuery || name.startsWith(normalizedQuery)) return 0;
          if (name.split(/\s+/).some((word) => word.startsWith(normalizedQuery))) return 1;
          if (name.includes(normalizedQuery)) return 2;
          return 3;
        };
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
    return ranked.slice(0, 6);
  }, [companies, normalizedQuery]);

  useEffect(() => {
    if (activeSuggestion < 0) return;
    pickerRef.current?.querySelector<HTMLElement>(".contact-company-suggestions > button.active")?.scrollIntoView({ block: "nearest" });
  }, [activeSuggestion]);

  function selectCompany(company: Company) {
    setQuery(company.name);
    setSelectedId(company.id);
    inputRef.current?.setCustomValidity("");
    setOpen(false);
    setActiveSuggestion(-1);
  }

  function updateQuery(value: string) {
    const normalizedValue = value.trim().toLowerCase();
    const exactMatches = companies.filter((company) => company.name.toLowerCase() === normalizedValue);
    setQuery(value);
    setSelectedId(exactMatches.length === 1 ? exactMatches[0].id : "");
    inputRef.current?.setCustomValidity(exactMatches.length === 1 || !normalizedValue ? "" : "Select an existing company from the suggestions.");
    setOpen(Boolean(normalizedValue));
    setActiveSuggestion(-1);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActiveSuggestion(-1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (suggestions.length) setActiveSuggestion((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (suggestions.length) setActiveSuggestion((current) => current <= 0 ? suggestions.length - 1 : current - 1);
    } else if (event.key === "Enter" && open && activeSuggestion >= 0) {
      event.preventDefault();
      selectCompany(suggestions[activeSuggestion]);
    }
  }

  return (
    <div className="field contact-company-field" ref={pickerRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActiveSuggestion(-1); } }}>
      <label className="field-label" htmlFor={inputId}>Company *</label>
      <div className="contact-company-picker">
        <input
          ref={inputRef}
          id={inputId}
          name="companyName"
          type="text"
          value={query}
          required
          minLength={2}
          maxLength={255}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder="Start typing a company name"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && Boolean(normalizedQuery)}
          aria-controls={listId}
          aria-activedescendant={activeSuggestion >= 0 ? `${inputId}-option-${suggestions[activeSuggestion]?.id}` : undefined}
          aria-describedby={helpId}
          onChange={(event) => updateQuery(event.target.value)}
          onFocus={() => setOpen(Boolean(normalizedQuery))}
          onKeyDown={handleKeyDown}
        />
        <span className={`contact-company-picker-state${selectedCompany ? " selected" : ""}`} aria-hidden="true">{selectedCompany ? "✓" : "⌕"}</span>
        <input name="companyId" type="hidden" value={selectedId} />
        {open && normalizedQuery && (
          <div className="contact-company-suggestions" id={listId} role="listbox" aria-label="Existing companies">
            {suggestions.map((company, index) => (
              <button
                id={`${inputId}-option-${company.id}`}
                className={activeSuggestion === index ? "active" : ""}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={company.id === selectedId}
                key={company.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCompany(company)}
              >
                <EntityLogo name={company.name} src={company.logoDataUrl} lazy />
                <span><b>{company.name}</b><small>{[company.city, company.country].filter(Boolean).join(", ")} · {company.kind}</small></span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
            {suggestions.length === 0 && <div className="contact-company-empty">No existing company matches this name. Add the company in Companies first.</div>}
          </div>
        )}
      </div>
      <small className="field-help" id={helpId}>{selectedCompany ? `${selectedCompany.city}, ${selectedCompany.country} · ${selectedCompany.kind}` : "Type a company name, then choose it from the list."}</small>
      <span className="sr-only" aria-live="polite">{normalizedQuery ? `${suggestions.length} company choices` : ""}</span>
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
  "Normal priority": "Normal priority with no urgent escalation.",
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

function downloadTaskIcs(task: Task, company: string) {
  const escapeIcs = (value: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const localStart = task.deadline.replace(/[-:]/g, "").replace("T", "T") + "00";
  const [datePart, timePart] = task.deadline.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const endDate = new Date(Date.UTC(year, month - 1, day, hour + 1, minute));
  const pad = (value: number) => String(value).padStart(2, "0");
  const localEnd = `${endDate.getUTCFullYear()}${pad(endDate.getUTCMonth() + 1)}${pad(endDate.getUTCDate())}T${pad(endDate.getUTCHours())}${pad(endDate.getUTCMinutes())}00`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Client Data CRM//Tasks//UK",
    "BEGIN:VEVENT",
    `UID:${task.id}@client-data-crm`,
    `DTSTART;TZID=Europe/Kyiv:${localStart}`,
    `DTEND;TZID=Europe/Kyiv:${localEnd}`,
    `SUMMARY:${escapeIcs(task.title)}`,
    `DESCRIPTION:${escapeIcs(`${company} · ${task.note}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${task.id}-${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "task"}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

function Modal({ title, eyebrow, onClose, children, wide = false }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
    const initialFocusFrame = window.requestAnimationFrame(() => {
      const preferred = dialogRef.current?.querySelector<HTMLElement>("[autofocus]");
      const first = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (preferred ?? first)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
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
        const anotherModalIsOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
        if (!anotherModalIsOpen && previousFocus?.isConnected) previousFocus.focus();
      });
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={`modal-card${wide ? " modal-wide" : ""}`}
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
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function AuthScreen({ users, credentials, onAuthenticate, onRegister }: {
  users: CRMUser[];
  credentials: Record<string, string>;
  onAuthenticate: (identity: AuthIdentity) => void;
  onRegister: (name: string, email: string, password: string) => string | null;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const signInTabRef = useRef<HTMLButtonElement>(null);
  const registerTabRef = useRef<HTMLButtonElement>(null);

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

  function emailLogin(event: FormEvent<HTMLFormElement>) {
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
      const registrationError = onRegister(name, email, password);
      if (registrationError) return setFormError(registrationError);
      selectMode("signin");
      setMessage("Registration submitted. An administrator must approve the Read-only account before sign-in.");
      return;
    }

    const liveAccount = users.find((user) => user.email.toLowerCase() === email);
    if (!liveAccount || credentials[email] !== password) {
      setFormError("Email or password is incorrect.");
      return;
    }
    if (liveAccount.state === "Pending") {
      setFormError("This registration is waiting for administrator approval.");
      return;
    }
    if (liveAccount.state === "Inactive") {
      setFormError("This account is inactive. Contact a CRM administrator.");
      return;
    }
    onAuthenticate({ name: liveAccount.name, email, accountEmail: email, method: "Email", role: liveAccount.role });
  }

  function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("recoveryEmail") ?? "").trim();
    if (!EMAIL_PATTERN.test(email)) return setFieldError(event.currentTarget, "recoveryEmail", "Enter a valid email address.");
    setMessage(`Recovery for ${email} requires the production email service. In this frontend, ask an administrator to set a temporary password.`);
    setRecoveryOpen(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-shell" aria-label="Client Data CRM authentication">
        <div className="auth-intro">
          <div className="auth-brand"><span className="brand-mark">C</span><span><b>Client Data</b><small>CRM workspace</small></span></div>
          <div className="auth-intro-copy"><p className="eyebrow">CRM workspace</p><h1>Clients, contacts, and tasks in one clear workflow.</h1><p>Use email and password to review the role-aware frontend.</p></div>
          <div className="auth-benefits"><span><i>✓</i>Four clearly separated roles</span><span><i>✓</i>Responsive client workflow</span><span><i>✓</i>Europe/Kyiv interface dates</span></div>
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
                <label><span>Work email</span><input name="email" type="email" autoComplete="email" required maxLength={254} autoFocus defaultValue={mode === "signin" ? "admin@cjn.example" : ""} placeholder="name@company.com" /></label>
                <label><span>Password</span><span className="password-field"><input name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} maxLength={128} defaultValue={mode === "signin" ? TEST_PASSWORD : ""} placeholder="8+ characters, letters and numbers" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "Hide" : "Show"}</button></span></label>
                {mode === "signup" && <label><span>Confirm password</span><input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} placeholder="Repeat your password" /></label>}
                <div className="auth-form-options auth-form-options-end">{mode === "signin" && <button type="button" onClick={() => { setRecoveryOpen(true); setMessage(""); }}>Forgot password?</button>}</div>
                <button className="primary-button auth-submit" type="submit">{mode === "signin" ? "Sign in to CRM" : "Submit registration"}<span>→</span></button>
              </form>
            </div>
            <p className="auth-security-note"><span>⌾</span> Test account: admin@cjn.example · {TEST_PASSWORD}. Data is kept in this page session.</p>
            {formError && <div className="auth-message auth-error" role="alert">{formError}</div>}
            {message && <div className="auth-message" role="status">{message}</div>}
          </div>
        </div>
      </section>
      {recoveryOpen && (
        <div className="auth-recovery-backdrop" role="presentation" onMouseDown={() => setRecoveryOpen(false)}><section className="auth-recovery" role="dialog" aria-modal="true" aria-label="Password recovery" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">Password recovery</p><h2>Reset password</h2></div><button className="icon-button" type="button" onClick={() => setRecoveryOpen(false)} aria-label="Close">×</button></header><p>Enter your work email to see the recovery path available in this frontend.</p><form onSubmit={recover}><label><span>Work email</span><input name="recoveryEmail" type="email" required autoFocus placeholder="name@company.com" /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setRecoveryOpen(false)}>Cancel</button><button className="primary-button" type="submit">Continue</button></div></form></section></div>
      )}
    </main>
  );
}

export function CRMApp() {
  const [view, setView] = useState<View>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>(() => INITIAL_COMPANIES.map((company) => {
    const ownerUserEmail = INITIAL_USERS.find((user) => user.name === company.owner)?.email.toLowerCase();
    return { ...company, createdBy: company.createdBy ?? company.owner, ownerUserEmail, createdByUserEmail: company.createdByUserEmail ?? ownerUserEmail };
  }));
  const [contacts, setContacts] = useState<Contact[]>(() => INITIAL_CONTACTS.map((contact) => {
    const ownerUserEmail = INITIAL_USERS.find((user) => user.name === contact.owner)?.email.toLowerCase();
    const initiatedByUserEmail = contact.initiatedBy ? INITIAL_USERS.find((user) => user.name === contact.initiatedBy)?.email.toLowerCase() : undefined;
    return { ...contact, status: contact.status ?? "Active", ownerUserEmail, initiatedByUserEmail: contact.initiatedByUserEmail ?? initiatedByUserEmail };
  }));
  const [tasks, setTasks] = useState<Task[]>(() => INITIAL_TASKS.map((task) => {
    const ownerUserEmail = INITIAL_USERS.find((user) => user.name === task.owner)?.email.toLowerCase();
    return { ...task, createdBy: task.createdBy ?? task.owner, ownerUserEmail, createdByUserEmail: task.createdByUserEmail ?? ownerUserEmail };
  }));
  const [taskComments, setTaskComments] = useState(INITIAL_TASK_COMMENTS);
  const [audit, setAudit] = useState(INITIAL_AUDIT);
  const [users, setUsers] = useState(INITIAL_USERS);
  const [lookups, setLookups] = useState(LOOKUP_SEED);
  const [credentials, setCredentials] = useState<Record<string, string>>(() => Object.fromEntries(INITIAL_USERS.map((user) => [user.email.toLowerCase(), TEST_PASSWORD])));
  const [archivedCompanyIds, setArchivedCompanyIds] = useState<string[]>([]);
  const [archivedContactIds, setArchivedContactIds] = useState<string[]>([]);
  const [archivedTaskIds, setArchivedTaskIds] = useState<string[]>([]);
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalSearchIndex, setGlobalSearchIndex] = useState(-1);
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyStatus, setCompanyStatus] = useState("All statuses");
  const [contactQuery, setContactQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState("Actual");
  const [taskManagerFilter, setTaskManagerFilter] = useState("All managers");
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedUser, setSelectedUser] = useState<CRMUser | null>(null);
  const [modal, setModal] = useState<"company" | "contact" | "task" | "user" | "profile" | "settings" | null>(null);
  const [modalCompanyId, setModalCompanyId] = useState<string | undefined>();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [readNotificationIdsByAccount, setReadNotificationIdsByAccount] = useState<Record<string, string[]>>({});
  const [preferencesByAccount, setPreferencesByAccount] = useState<Record<string, Preferences>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const notificationAccountKey = identity?.accountEmail.toLowerCase() ?? "";
  const readNotificationIds = readNotificationIdsByAccount[notificationAccountKey] ?? [];
  const preferences = preferencesByAccount[notificationAccountKey] ?? DEFAULT_PREFERENCES;

  function updateReadNotificationIds(update: string[] | ((current: string[]) => string[])) {
    if (!notificationAccountKey) return;
    setReadNotificationIdsByAccount((current) => {
      const previous = current[notificationAccountKey] ?? [];
      const next = typeof update === "function" ? update(previous) : update;
      return { ...current, [notificationAccountKey]: next };
    });
  }
  const toastTimer = useRef<number | null>(null);
  const globalSearchRef = useRef<HTMLDivElement>(null);
  const topbarActionsRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarCloseButtonRef = useRef<HTMLButtonElement>(null);
  const isMobileNavigation = useMediaQuery("(max-width: 900px)");
  const overlayOpen = Boolean(modal || selectedCompany || selectedContact || selectedTask || selectedUser || (sidebarOpen && isMobileNavigation));

  const liveCompanies = companies.filter((company) => !archivedCompanyIds.includes(company.id));
  const liveContacts = contacts.filter((contact) => !archivedContactIds.includes(contact.id) && !archivedCompanyIds.includes(contact.companyId));
  const liveTasks = tasks.filter((task) => !archivedTaskIds.includes(task.id) && !archivedCompanyIds.includes(task.companyId));
  const openTasks = liveTasks.filter(isOpenTask);
  const overdueTasks = openTasks.filter(isOverdue);
  const currentRole = identity?.role ?? "Read-only";
  const canViewAudit = hasPermission(currentRole, "audit.view");
  const lookupValues = (type: string, activeOnly = true) => lookups.find((group) => group.type === type)?.items.filter((item) => !activeOnly || item.active).map((item) => item.value) ?? [];
  const activeClientStatuses = lookupValues("client-status");
  const clientStatusOrder = activeClientStatuses;
  const taskStatusOptions = lookupValues("task-status");
  const outcomeStatusOptions = lookupValues("outcome-status");
  const contactSourceOptions = lookupValues("contact-source");
  const reminderLeadOptions = lookupValues("reminder-lead");
  const companyTypeOptions = lookupValues("company-type");
  const managerOptions = lookupValues("cjn-manager");
  const allManagerOptions = lookupValues("cjn-manager", false);
  const userEmailForName = (name: string) => users.find((user) => user.name === name)?.email.toLowerCase();

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
      ? relatedOpenTasks.filter((task) => !isOverdue(task)).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 2).map((task) => ({
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
      const safeEntity = currentRole === "Admin"
        ? event.entity
        : entityType === "Company"
          ? `Company · ${liveCompanies.find((company) => company.id === targetId)?.name ?? "record"}`
          : entityType === "Contact"
            ? `Contact · ${liveContacts.find((contact) => contact.id === targetId)?.name ?? "record"}`
            : event.entity;
      return {
        id: `audit:${event.id}`,
        kind: event.action === "STATUS CHANGE" ? "update" : "audit",
        title,
        detail: `${safeEntity} · ${event.detail}`,
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
  }, [audit, currentRole, liveCompanies, liveContacts, liveTasks, notificationAccountKey, preferences]);

  const unreadNotifications = notifications.filter((item) => !readNotificationIds.includes(item.id));

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

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
    if (!notificationsOpen && !profileOpen && !globalSearch && !(sidebarOpen && isMobileNavigation)) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (globalSearch && !globalSearchRef.current?.contains(target)) {
        setGlobalSearch("");
        setGlobalSearchIndex(-1);
      }
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
  }, [globalSearch, isMobileNavigation, notificationsOpen, profileOpen, sidebarOpen]);

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
    const query = companyQuery.trim().toLowerCase();
    return liveCompanies.filter((company) => {
      const matchesQuery = !query || [company.name, company.country, company.city, company.owner, company.kind, company.website, company.linkedin ?? "", company.description].some((value) => value.toLowerCase().includes(query));
      const matchesStatus = companyStatus === "All statuses" || company.status === companyStatus;
      return matchesQuery && matchesStatus;
    });
  }, [liveCompanies, companyQuery, companyStatus]);

  const filteredContacts = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    return liveContacts.filter((contact) =>
      !query || [contact.name, contact.email, contact.phone, contact.position, contact.status, contact.source, contact.owner, contact.linkedin ?? "", companyName(liveCompanies, contact.companyId)].some((value) => value.toLowerCase().includes(query)),
    );
  }, [liveContacts, contactQuery, liveCompanies]);

  const globalResults = useMemo(() => {
    const query = globalSearch.trim().toLowerCase();
    if (!query) return [];
    const candidates: Array<{ type: "Company" | "Contact" | "Task"; label: string; meta: string; id: string; searchValues: string[] }> = [
      ...liveCompanies.map((company) => ({
        type: "Company" as const,
        label: company.name,
        meta: `${company.city}, ${company.country}`,
        id: company.id,
        searchValues: [company.name, company.country, company.city, company.description, company.website, company.linkedin ?? ""],
      })),
      ...liveContacts.map((contact) => ({
        type: "Contact" as const,
        label: contact.name,
        meta: companyName(liveCompanies, contact.companyId),
        id: contact.id,
        searchValues: [contact.name, contact.email, contact.phone, contact.position, contact.source, contact.linkedin ?? "", companyName(liveCompanies, contact.companyId)],
      })),
      ...liveTasks.map((task) => ({
        type: "Task" as const,
        label: task.title,
        meta: companyName(liveCompanies, task.companyId),
        id: task.id,
        searchValues: [task.title, task.note, task.outcomeNotes ?? "", companyName(liveCompanies, task.companyId), ...taskComments.filter((comment) => comment.taskId === task.id).map((comment) => comment.text)],
      })),
    ];
    return candidates
      .filter((result) => autocompleteRank(result.label, result.searchValues, query) < 4)
      .sort((a, b) => autocompleteRank(a.label, a.searchValues, query) - autocompleteRank(b.label, b.searchValues, query) || a.label.localeCompare(b.label))
      .slice(0, 6)
      .map(({ type, label, meta, id }) => ({ type, label, meta, id }));
  }, [globalSearch, liveCompanies, liveContacts, liveTasks, taskComments]);
  const globalSearchOpen = Boolean(globalSearch.trim());

  const activeGlobalSearchIndex = globalResults.length > 0 ? Math.min(Math.max(globalSearchIndex, 0), globalResults.length - 1) : -1;

  useEffect(() => {
    if (activeGlobalSearchIndex < 0) return;
    globalSearchRef.current?.querySelector<HTMLElement>(".search-results [role='option'][aria-selected='true']")?.scrollIntoView({ block: "nearest" });
  }, [activeGlobalSearchIndex]);

  function notify(message: string, tone: ToastState["tone"] = "success") {
    setToast({ message, tone });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }

  function authenticate(nextIdentity: AuthIdentity) {
    const account = users.find((user) => user.email.toLowerCase() === nextIdentity.accountEmail.toLowerCase());
    setIdentity({ ...nextIdentity, photoDataUrl: account?.photoDataUrl });
    setView("dashboard");
    setUsers((current) => current.map((user) => user.email.toLowerCase() === nextIdentity.accountEmail.toLowerCase() ? { ...user, lastLogin: currentKyivStamp() } : user));
    notify(`Signed in as ${nextIdentity.role}`);
  }

  function registerAccount(name: string, email: string, password: string) {
    const normalizedEmail = email.toLowerCase();
    if (users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
      return "Registration could not be completed. Contact an administrator if you already requested access.";
    }
    if (users.some((user) => user.name.toLowerCase() === name.toLowerCase())) {
      return "This display name is already assigned. Use your full work name or contact an administrator.";
    }
    const user: CRMUser = { name, email: normalizedEmail, role: "Read-only", state: "Pending", lastLogin: "Awaiting approval" };
    setUsers((current) => [user, ...current]);
    setCredentials((current) => ({ ...current, [normalizedEmail]: password }));
    addAudit("USER REGISTERED", `User · ${normalizedEmail}`, "Pending administrator approval · Read-only");
    return null;
  }

  function requirePermission(permission: Permission, action: string) {
    if (hasPermission(currentRole, permission)) return true;
    notify(`${currentRole} access cannot ${action}.`, "warning");
    return false;
  }

  function signOut() {
    setIdentity(null);
    setProfileOpen(false);
    setNotificationsOpen(false);
    setSelectedCompany(null);
    setSelectedContact(null);
    setSelectedTask(null);
    setSelectedUser(null);
    setModal(null);
  }

  function addAudit(action: string, entity: string, detail: string) {
    setAudit((current) => [
      {
        id: `E-${Math.max(1050, ...current.map((event) => Number(event.id.replace(/\D/g, "")) || 0)) + 1}`,
        at: currentKyivStamp(),
        actor: identity?.name ?? "Self-service registration",
        action,
        entity,
        detail,
      },
      ...current,
    ]);
  }

  function navigate(nextView: View) {
    if (nextView === "lookups" && !requirePermission("lookup.manage", "manage Lookups")) return;
    if (nextView === "users" && !requirePermission("user.manage", "manage users and roles")) return;
    if (nextView === "audit" && !requirePermission("audit.view", "open the Audit Log")) return;
    setView(nextView);
    setSidebarOpen(false);
    setNotificationsOpen(false);
    setProfileOpen(false);
  }

  function openGlobalResult(result: { type: string; id: string }) {
    if (result.type === "Company") {
      setSelectedCompany(companies.find((company) => company.id === result.id) ?? null);
    } else if (result.type === "Contact") {
      setSelectedContact(contacts.find((item) => item.id === result.id) ?? null);
    } else {
      setSelectedTask(tasks.find((task) => task.id === result.id) ?? null);
    }
    setGlobalSearch("");
  }

  function handleGlobalSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!globalSearchOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (globalResults.length > 0) setGlobalSearchIndex((current) => (current + 1 + globalResults.length) % globalResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (globalResults.length > 0) setGlobalSearchIndex((current) => (current - 1 + globalResults.length) % globalResults.length);
    } else if (event.key === "Enter" && activeGlobalSearchIndex >= 0) {
      event.preventDefault();
      const result = globalResults[activeGlobalSearchIndex];
      if (result) openGlobalResult(result);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setGlobalSearch("");
    }
  }

  function openAuditEntity(event: AuditEvent) {
    const [entityType, id] = event.entity.split(" · ");
    if (entityType === "Company") setSelectedCompany(companies.find((company) => company.id === id) ?? null);
    else if (entityType === "Contact") setSelectedContact(contacts.find((contact) => contact.id === id) ?? null);
    else if (entityType === "Task") setSelectedTask(tasks.find((task) => task.id === id) ?? null);
    else if (hasPermission(currentRole, "audit.view")) navigate("audit");
  }

  function openNotification(item: AppNotification) {
    updateReadNotificationIds((current) => current.includes(item.id) ? current : [...current, item.id]);
    setNotificationsOpen(false);
    if (item.target === "task") setSelectedTask(tasks.find((task) => task.id === item.targetId) ?? null);
    else if (item.target === "company") setSelectedCompany(companies.find((company) => company.id === item.targetId) ?? null);
    else if (item.target === "contact") setSelectedContact(contacts.find((contact) => contact.id === item.targetId) ?? null);
    else if (item.target === "activity") navigate("activity");
    else if (hasPermission(currentRole, "audit.view")) navigate("audit");
  }

  function addCompany(event: FormEvent<HTMLFormElement>, logoDataUrl = "") {
    event.preventDefault();
    if (!requirePermission("company.create", "create companies")) return;
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
    if (name.length < 2) return void setFieldError(form, "name", "Enter at least 2 characters.");
    if (companies.some((company) => company.name.toLowerCase() === name.toLowerCase())) return void setFieldError(form, "name", "A company with this name already exists.");
    if (!country) return void setFieldError(form, "country", "Country is required.");
    if (websiteInput && !website) return void setFieldError(form, "website", "Enter a valid website address.");
    if (linkedinInput && !linkedin) return void setFieldError(form, "linkedin", "Enter a valid LinkedIn URL.");
    if (!companyTypeOptions.includes(String(data.get("kind") ?? ""))) return void setFieldError(form, "kind", "Select a valid company type.");
    if (!activeClientStatuses.includes(status)) return void setFieldError(form, "status", "Select a valid client status.");
    if (!managerOptions.includes(owner)) return void setFieldError(form, "owner", "Select an active CJN Manager.");
    const nextNumber = Math.max(0, ...companies.map((company) => Number(company.id.replace(/\D/g, "")) || 0)) + 1;
    const id = `C-${String(nextNumber).padStart(4, "0")}`;
    const company: Company = {
      id,
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
      logoDataUrl: logoDataUrl || undefined,
      description: String(data.get("description") ?? "").trim(),
    };
    setCompanies((current) => [company, ...current]);
    addAudit("CREATE", `Company · ${id}`, name);
    setModal(null);
    notify("Company added to this session");
  }

  function createContact(draft: ContactDraft): ContactCreationResult {
    if (!requirePermission("contact.create", "create contacts")) return { error: "Your role cannot create contacts." };
    const firstName = draft.firstName.trim();
    const lastName = draft.lastName?.trim() ?? "";
    const name = [firstName, lastName].filter(Boolean).join(" ");
    const companyId = draft.companyId;
    const status = draft.status ?? "Active";
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
    if (!liveCompanies.some((company) => company.id === companyId)) return { field: "companyName", error: "Select an existing company." };
    if (!CONTACT_STATUSES.includes(status)) return { field: "status", error: "Select a valid contact status." };
    if (source && !contactSourceOptions.includes(source)) return { field: "source", error: "Select a valid contact source." };
    if (requestedInitiatorEmail && manualInitiator) return { field: "initiatedBy", error: "Choose a CRM user or enter a manual name, not both." };
    if (requestedInitiatorEmail && !initiatorUser) return { field: "initiatedByUserEmail", error: "Select an active CRM user or enter the initiator manually." };
    if (initiatedBy.length < 2) return { field: "initiatedBy", error: "Enter at least 2 characters for the initiator name." };
    if (initiatedBy.length > 120) return { field: "initiatedBy", error: "Keep the initiator name within 120 characters." };
    if (email && !EMAIL_PATTERN.test(email)) return { field: "email", error: "Enter a valid email address." };
    if (email && contacts.some((item) => item.email.toLowerCase() === email)) return { field: "email", error: "A contact with this email already exists." };
    if (linkedinInput && !linkedin) return { field: "linkedin", error: "Enter a valid LinkedIn URL." };
    if (phone && phone !== "—" && !/^[+()\d\s.-]{7,24}$/.test(phone)) return { field: "phone", error: "Enter a valid phone number." };
    const nextNumber = Math.max(0, ...contacts.map((contact) => Number(contact.id.replace(/\D/g, "")) || 0)) + 1;
    const id = `K${String(nextNumber).padStart(2, "0")}`;
    const contact: Contact = {
      id,
      companyId,
      status,
      name,
      position: draft.position?.trim() ?? "",
      email,
      phone,
      linkedin,
      source,
      sourceDetail: draft.sourceDetail?.trim() ?? "",
      referredBy: draft.referredBy?.trim() ?? "",
      owner: identity?.name ?? "Unassigned",
      initiatedBy,
      ownerUserEmail: identity?.accountEmail.toLowerCase(),
      initiatedByUserEmail,
      photoDataUrl: draft.photoDataUrl?.startsWith("data:image/") ? draft.photoDataUrl : undefined,
    };
    if (!["Exhibition / Conference", "Other"].includes(contact.source)) contact.sourceDetail = "";
    if (contact.source !== "Referral (word of mouth)") contact.referredBy = "";
    setContacts((current) => [contact, ...current]);
    setCompanies((current) => current.map((company) => company.id === contact.companyId ? { ...company, contacts: company.contacts + 1 } : company));
    addAudit("CREATE", `Contact · ${id}`, `${contact.name} · ${companyName(companies, contact.companyId)} · Initiated by: ${contact.initiatedBy}`);
    notify("Contact created");
    return { contact };
  }

  function addContact(event: FormEvent<HTMLFormElement>, photoDataUrl = "") {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const initiatorChoice = String(data.get("initiatedByUserEmail") ?? "").trim().toLowerCase();
    const result = createContact({
      companyId: String(data.get("companyId") ?? ""),
      companyName: String(data.get("companyName") ?? ""),
      status: String(data.get("status") ?? "Active") as ContactStatus,
      firstName: String(data.get("firstName") ?? ""),
      lastName: String(data.get("lastName") ?? ""),
      position: String(data.get("position") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      linkedin: String(data.get("linkedin") ?? ""),
      source: String(data.get("source") ?? ""),
      sourceDetail: String(data.get("sourceDetail") ?? ""),
      referredBy: String(data.get("referredBy") ?? ""),
      initiatedBy: initiatorChoice === "manual" ? String(data.get("initiatedBy") ?? "") : undefined,
      initiatedByUserEmail: initiatorChoice === "manual" ? undefined : initiatorChoice,
      photoDataUrl,
    });
    if (result.error) {
      if (!result.field || !setFieldError(form, result.field, result.error)) notify(result.error, "warning");
      return;
    }
    setModal(null);
    setModalCompanyId(undefined);
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

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requirePermission("task.create", "create tasks")) return;
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const nextNumber = Math.max(0, ...tasks.map((task) => Number(task.id.replace(/\D/g, "")) || 0)) + 1;
    const id = `T-${String(nextNumber).padStart(4, "0")}`;
    const task: Task = {
      id,
      companyId: String(data.get("companyId") ?? companies[0]?.id),
      title: String(data.get("title") ?? "").trim(),
      contactDate: String(data.get("contactDate") ?? todayKyiv()),
      deadline: String(data.get("deadline") ?? ""),
      owner: String(data.get("owner") ?? "Andrey Zherebetsky"),
      createdBy: identity?.name ?? "Unknown user",
      ownerUserEmail: userEmailForName(String(data.get("owner") ?? "Andrey Zherebetsky")),
      createdByUserEmail: identity?.accountEmail.toLowerCase(),
      contactPersonId: String(data.get("contactPersonId") ?? ""),
      status: String(data.get("status") ?? "Not Started") as Task["status"],
      priority: String(data.get("priority") ?? "Normal") as Task["priority"],
      note: String(data.get("note") ?? "").trim(),
      outcomeStatus: String(data.get("outcomeStatus") ?? ""),
      outcomeNotes: String(data.get("outcomeNotes") ?? "").trim(),
      reminderLeads: data.getAll("reminderLeads").map(String),
    };
    if (task.title.length < 3) return void setFieldError(form, "title", "Enter at least 3 characters.");
    if (!companies.some((company) => company.id === task.companyId)) return void setFieldError(form, "companyId", "Select an existing company.");
    if (!managerOptions.includes(task.owner)) return void setFieldError(form, "owner", "Select an active CJN Manager.");
    if (!["Normal", "Medium", "High"].includes(task.priority)) return void setFieldError(form, "priority", "Select a valid priority.");
    if (!taskStatusOptions.includes(task.status)) return void setFieldError(form, "status", "Select a valid task status.");
    if (task.outcomeStatus && !outcomeStatusOptions.includes(task.outcomeStatus)) return void setFieldError(form, "outcomeStatus", "Select a valid outcome status.");
    if ((task.reminderLeads ?? []).some((lead) => !reminderLeadOptions.includes(lead))) return void setFieldError(form, "reminderLeads", "Select valid reminder notice times.");
    if (!task.contactDate) return void setFieldError(form, "contactDate", "Choose the contact date.");
    if (task.contactPersonId && !contacts.some((contact) => contact.id === task.contactPersonId && contact.companyId === task.companyId && contact.status === "Active")) return void setFieldError(form, "contactPersonId", "Select an active contact from this company.");
    if (!task.deadline) return void setFieldError(form, "deadline", "Choose a deadline.");
    const nextTasks = [task, ...tasks];
    setTasks(nextTasks);
    recalculateLastContact(task.companyId, nextTasks);
    addAudit("CREATE", `Task · ${id}`, task.title);
    setModal(null);
    notify(task.deadline.replace("T", " ") <= currentKyivStamp() ? "Task created. Its past deadline will not generate reminders." : "Task created. Calendar download is available.", task.deadline.replace("T", " ") <= currentKyivStamp() ? "warning" : "success");
  }

  function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requirePermission("user.manage", "manage users")) return;
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
    if (user.name.length < 2) return void setFieldError(form, "name", "Enter at least 2 characters.");
    if (!EMAIL_PATTERN.test(user.email)) return void setFieldError(form, "email", "Enter a valid work email address.");
    if (users.some((item) => item.email.toLowerCase() === user.email)) return void setFieldError(form, "email", "A user with this email already exists.");
    if (users.some((item) => item.name.toLowerCase() === user.name.toLowerCase())) return void setFieldError(form, "name", "A user with this name already exists.");
    if (!ROLE_ORDER.includes(user.role)) return void setFieldError(form, "role", "Select a valid role.");
    if (!isStrongPassword(temporaryPassword)) return void setFieldError(form, "temporaryPassword", "Use at least 8 characters with letters and numbers.");
    setUsers((current) => [user, ...current]);
    setCompanies((current) => current.map((company) => company.owner === user.name && !company.ownerUserEmail ? { ...company, ownerUserEmail: user.email } : company));
    setContacts((current) => current.map((contact) => contact.owner === user.name && !contact.ownerUserEmail ? { ...contact, ownerUserEmail: user.email } : contact));
    setTasks((current) => current.map((task) => task.owner === user.name && !task.ownerUserEmail ? { ...task, ownerUserEmail: user.email } : task));
    setCredentials((current) => ({ ...current, [user.email]: temporaryPassword }));
    addAudit("CREATE", `User · ${user.email}`, `${user.name} · ${user.role}`);
    setModal(null);
    notify("User created with a temporary password");
  }

  function updateCompany(updated: Company) {
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
    setCompanies((current) => current.map((company) => company.id === updated.id ? normalized : company));
    setSelectedCompany(normalized);
    addAudit("FIELD CHANGE", `Company · ${updated.id}`, "Company profile updated");
    notify("Company profile updated");
    return true;
  }

  function updateContact(updated: Contact) {
    if (!requirePermission("contact.edit", "edit contacts")) return false;
    const existing = contacts.find((contact) => contact.id === updated.id);
    if (!existing) {
      notify("This contact no longer exists.", "warning");
      return false;
    }
    if (updated.name.trim().length < 2 || (updated.email && !EMAIL_PATTERN.test(updated.email))) {
      notify("Enter a valid contact name and email.", "warning");
      return false;
    }
    if (!liveCompanies.some((company) => company.id === updated.companyId)) {
      notify("Select an existing company.", "warning");
      return false;
    }
    if (!CONTACT_STATUSES.includes(updated.status)) {
      notify("Select a valid contact status.", "warning");
      return false;
    }
    if (updated.email && contacts.some((contact) => contact.id !== updated.id && contact.email.toLowerCase() === updated.email.toLowerCase())) {
      notify("A contact with this email already exists.", "warning");
      return false;
    }
    if (updated.source && !lookupValues("contact-source", false).includes(updated.source)) {
      notify("Select a valid contact source.", "warning");
      return false;
    }
    if (existing?.owner !== updated.owner && !managerOptions.includes(updated.owner)) {
      notify("Select an active CJN Manager.", "warning");
      return false;
    }
    const normalized = { ...updated, ownerUserEmail: existing.owner === updated.owner ? existing.ownerUserEmail : userEmailForName(updated.owner) };
    const companyChanged = existing.companyId !== normalized.companyId;
    const detachedTaskCount = companyChanged
      ? tasks.filter((task) => task.contactPersonId === normalized.id && task.companyId !== normalized.companyId).length
      : 0;
    setContacts((current) => current.map((contact) => contact.id === updated.id ? normalized : contact));
    if (companyChanged) {
      setCompanies((current) => current.map((company) => {
        if (company.id === existing.companyId) return { ...company, contacts: Math.max(0, company.contacts - 1) };
        if (company.id === normalized.companyId) return { ...company, contacts: company.contacts + 1 };
        return company;
      }));
      if (detachedTaskCount > 0) {
        setTasks((current) => current.map((task) => task.contactPersonId === normalized.id && task.companyId !== normalized.companyId ? { ...task, contactPersonId: undefined } : task));
      }
    }
    setSelectedContact(normalized);
    const companyChange = companyChanged ? `Company: ${companyName(companies, existing.companyId)} → ${companyName(companies, normalized.companyId)}` : "Contact profile updated";
    const taskChange = detachedTaskCount > 0 ? ` · ${detachedTaskCount} task contact link${detachedTaskCount === 1 ? "" : "s"} cleared` : "";
    addAudit("FIELD CHANGE", `Contact · ${updated.id}`, `${companyChange}${taskChange}`);
    notify(companyChanged ? "Contact moved to the selected company" : "Contact updated");
    return true;
  }

  function updateTask(updated: Task) {
    if (!requirePermission("task.edit", "edit tasks")) return false;
    const existing = tasks.find((task) => task.id === updated.id);
    if (!existing) return false;
    if (updated.title.trim().length < 3 || !updated.contactDate || !updated.deadline) {
      notify("Complete the task title, contact date, and deadline.", "warning");
      return false;
    }
    if (!taskStatusOptions.includes(updated.status)) {
      notify("Select a valid task status.", "warning");
      return false;
    }
    if (!allManagerOptions.includes(updated.owner) || (existing.owner !== updated.owner && !managerOptions.includes(updated.owner))) {
      notify("Select an active CJN Manager.", "warning");
      return false;
    }
    if (updated.outcomeStatus && !outcomeStatusOptions.includes(updated.outcomeStatus)) {
      notify("Select a valid outcome status.", "warning");
      return false;
    }
    if ((updated.reminderLeads ?? []).some((lead) => !reminderLeadOptions.includes(lead))) {
      notify("Select valid reminder notice times.", "warning");
      return false;
    }
    if (updated.contactPersonId && !contacts.some((contact) => contact.id === updated.contactPersonId && contact.companyId === updated.companyId && (contact.status === "Active" || contact.id === existing.contactPersonId))) {
      notify("Select an active contact from the selected company.", "warning");
      return false;
    }
    const normalized = { ...updated, ownerUserEmail: existing.owner === updated.owner ? existing.ownerUserEmail : userEmailForName(updated.owner) };
    const nextTasks = tasks.map((task) => task.id === updated.id ? normalized : task);
    setTasks(nextTasks);
    setSelectedTask(normalized);
    recalculateLastContact(existing.companyId, nextTasks);
    if (updated.companyId !== existing.companyId) recalculateLastContact(updated.companyId, nextTasks);
    const fields: Array<[string, string, string]> = [
      ["Task title", existing.title, updated.title],
      ["Status", existing.status, updated.status],
      ["Contact Date", existing.contactDate ?? "—", updated.contactDate ?? "—"],
      ["Deadline", existing.deadline, updated.deadline],
      ["CJN Manager", existing.owner, updated.owner],
      ["Contact Person", existing.contactPersonId ?? "—", updated.contactPersonId ?? "—"],
      ["Description", existing.note, updated.note],
      ["Outcome status", existing.outcomeStatus ?? "—", updated.outcomeStatus ?? "—"],
      ["Outcome notes", existing.outcomeNotes ?? "—", updated.outcomeNotes ?? "—"],
    ];
    const changes = fields.filter(([, from, to]) => from !== to);
    changes.forEach(([field, from, to]) => addAudit("FIELD CHANGE", `Task · ${updated.id}`, `${field}: ${from || "—"} → ${to || "—"}`));
    notify(changes.length ? "Task updated" : "No task changes to save");
    return true;
  }

  function addTaskComment(taskId: string, text: string) {
    if (!requirePermission("task.comment", "comment on tasks")) return false;
    const body = text.trim();
    if (!body || body.length > 2000) {
      notify("Write a comment between 1 and 2,000 characters.", "warning");
      return false;
    }
    const comment: TaskComment = {
      id: `CM-${String(taskComments.length + 1).padStart(3, "0")}`,
      taskId,
      author: identity?.name ?? "CRM user",
      createdAt: currentKyivStamp(),
      text: body,
    };
    setTaskComments((current) => [...current, comment]);
    addAudit("COMMENT", `Task · ${taskId}`, body);
    notify("Comment posted");
    return true;
  }

  function archiveCompany(company: Company) {
    if (!requirePermission("record.archive", "archive records")) return;
    if (liveTasks.some((task) => task.companyId === company.id && isOpenTask(task))) {
      notify("Close all open tasks before archiving this company.", "warning");
      return;
    }
    setArchivedCompanyIds((current) => [...current, company.id]);
    setSelectedCompany(null);
    addAudit("ARCHIVE", `Company · ${company.id}`, company.name);
    notify("Company archived");
  }

  function archiveContact(contact: Contact) {
    if (!requirePermission("record.archive", "archive records")) return;
    setArchivedContactIds((current) => [...current, contact.id]);
    setSelectedContact(null);
    addAudit("ARCHIVE", `Contact · ${contact.id}`, contact.name);
    notify("Contact archived");
  }

  function archiveTask(task: Task) {
    if (!requirePermission("record.archive", "archive records")) return;
    const nextArchived = [...archivedTaskIds, task.id];
    setArchivedTaskIds(nextArchived);
    setSelectedTask(null);
    recalculateLastContact(task.companyId, tasks, nextArchived);
    addAudit("ARCHIVE", `Task · ${task.id}`, task.title);
    notify("Task archived");
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
    addAudit("RESTORE", `${entity} · ${id}`, "Record restored from archive");
    notify(`${entity} restored`);
  }

  function addLookupValue(type: string, value: string) {
    if (!requirePermission("lookup.manage", "manage Lookups")) return false;
    if (type === "client-status") {
      notify("Relationship Status is fixed at five options. Rename or reorder the existing stages.", "warning");
      return false;
    }
    const clean = value.trim();
    const group = lookups.find((item) => item.type === type);
    if (!group || !clean || group.items.some((item) => item.value.toLowerCase() === clean.toLowerCase())) {
      notify("Enter a unique lookup option.", "warning");
      return false;
    }
    setLookups((current) => current.map((item) => item.type === type ? { ...item, items: [...item.items, { id: `${type}-${Date.now()}`, value: clean, active: true }] } : item));
    addAudit("LOOKUP CHANGE", `Lookup · ${type}`, `Added: ${clean}`);
    notify("Lookup option added");
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
    addAudit("LOOKUP CHANGE", `Lookup · ${type}`, `${existing.value} → ${clean}`);
    notify("Lookup option renamed");
    return true;
  }

  function toggleLookupValue(type: string, id: string) {
    if (!requirePermission("lookup.manage", "manage Lookups")) return;
    if (type === "client-status") return notify("Keep all five Relationship Status options active. You can rename or reorder them.", "warning");
    const group = lookups.find((item) => item.type === type);
    const item = group?.items.find((lookup) => lookup.id === id);
    if (!group || !item) return;
    if (item.active && group.items.filter((lookup) => lookup.active).length <= 1) return notify("Keep at least one active option in each lookup.", "warning");
    setLookups((current) => current.map((lookupGroup) => lookupGroup.type === type ? { ...lookupGroup, items: lookupGroup.items.map((lookup) => lookup.id === id ? { ...lookup, active: !lookup.active } : lookup) } : lookupGroup));
    addAudit("LOOKUP CHANGE", `Lookup · ${type}`, `${item.value}: ${item.active ? "deactivated" : "activated"}`);
    notify(item.active ? "Lookup option deactivated" : "Lookup option activated");
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
    addAudit("LOOKUP CHANGE", `Lookup · ${type}`, "Order changed");
  }

  function updateUser(updated: CRMUser, temporaryPassword = "") {
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
    setUsers((current) => current.map((user) => user.email === updated.email ? updated : user));
    if (updated.email.toLowerCase() === identity?.accountEmail.toLowerCase() && updated.role !== identity.role) {
      setIdentity((current) => current ? { ...current, role: updated.role } : current);
      if (updated.role !== "Admin" && ["lookups", "users", "audit"].includes(view)) setView("dashboard");
    }
    setSelectedUser(updated);
    if (temporaryPassword) {
      setCredentials((current) => ({ ...current, [updated.email.toLowerCase()]: temporaryPassword }));
      addAudit("FIELD CHANGE", `User · ${updated.email}`, "Password reset by administrator");
    }
    if (currentUser?.role !== updated.role) addAudit("ROLE CHANGE", `User · ${updated.email}`, `${currentUser?.role} → ${updated.role}`);
    if (currentUser?.state !== updated.state) addAudit("FIELD CHANGE", `User · ${updated.email}`, `Status: ${currentUser?.state} → ${updated.state}`);
    notify("User permissions updated");
    return true;
  }

  function openContactForm(companyId?: string) {
    if (!requirePermission("contact.create", "create contacts")) return;
    setModalCompanyId(companyId);
    setModal("contact");
  }

  function openTaskForm(companyId?: string) {
    if (!requirePermission("task.create", "create tasks")) return;
    setModalCompanyId(companyId);
    setModal("task");
  }

  function moveCompany(companyId: string, nextStatus: string) {
    if (!requirePermission("pipeline.move", "change relationship status")) return;
    if (!clientStatusOrder.includes(nextStatus)) return notify("Select a valid client status.", "warning");
    const current = companies.find((company) => company.id === companyId);
    if (!current || current.status === nextStatus) return;
    setCompanies((items) => items.map((company) => company.id === companyId ? { ...company, status: nextStatus } : company));
    addAudit("STATUS CHANGE", `Company · ${companyId}`, `${current.status} → ${nextStatus}`);
    notify(`${current.name}: ${nextStatus}`);
  }

  function updateTaskStatus(task: Task, nextStatus: Task["status"]) {
    if (!requirePermission("task.edit", "update task status")) return;
    if (!taskStatusOptions.includes(nextStatus)) return notify("Select a valid task status.", "warning");
    if (task.status === nextStatus) return;
    const updated = { ...task, status: nextStatus };
    setTasks((items) => items.map((item) => item.id === task.id ? updated : item));
    addAudit("STATUS CHANGE", `Task · ${task.id}`, `${task.status} → ${nextStatus}`);
    setSelectedTask(updated);
    notify(`Task status changed to ${nextStatus}`);
  }

  function updateProfile(nextIdentity: AuthIdentity, currentPassword: string, newPassword: string) {
    if (!identity) return "Sign in again before changing the profile.";
    const previousEmail = identity.accountEmail.toLowerCase();
    const nextEmail = nextIdentity.email.toLowerCase();
    const emailChanged = previousEmail !== nextEmail;
    const nameChanged = identity.name !== nextIdentity.name;
    const photoChanged = identity.photoDataUrl !== nextIdentity.photoDataUrl;
    if (users.some((user) => user.email.toLowerCase() === nextEmail && user.email.toLowerCase() !== previousEmail)) {
      return "This email is already assigned to another CRM user.";
    }
    if (users.some((user) => user.email.toLowerCase() !== previousEmail && user.name.toLowerCase() === nextIdentity.name.toLowerCase())) {
      return "This display name is already assigned to another CRM user.";
    }
    const managerNameCollision = nameChanged && lookups
      .find((group) => group.type === "cjn-manager")
      ?.items.some((item) => item.value.toLowerCase() === nextIdentity.name.toLowerCase() && item.value.toLowerCase() !== identity.name.toLowerCase());
    if (managerNameCollision) {
      return "This display name is already assigned to another CJN Manager.";
    }
    if ((emailChanged || newPassword) && credentials[previousEmail] !== currentPassword) {
      return "Current password is incorrect.";
    }
    const nextCredentials = { ...credentials };
    if (emailChanged) delete nextCredentials[previousEmail];
    nextCredentials[nextEmail] = newPassword || credentials[previousEmail];
    setCredentials(nextCredentials);
    setUsers((current) => current.map((user) => user.email.toLowerCase() === previousEmail ? { ...user, name: nextIdentity.name, email: nextEmail, photoDataUrl: nextIdentity.photoDataUrl } : user));
    if (nameChanged || emailChanged) {
      setCompanies((current) => current.map((company) => {
        const owns = company.ownerUserEmail === previousEmail;
        const created = company.createdByUserEmail === previousEmail;
        return { ...company, owner: nameChanged && owns ? nextIdentity.name : company.owner, createdBy: nameChanged && created ? nextIdentity.name : company.createdBy, ownerUserEmail: owns ? nextEmail : company.ownerUserEmail, createdByUserEmail: created ? nextEmail : company.createdByUserEmail };
      }));
      setContacts((current) => current.map((contact) => {
        const owns = contact.ownerUserEmail === previousEmail;
        const initiated = contact.initiatedByUserEmail === previousEmail;
        return { ...contact, owner: nameChanged && owns ? nextIdentity.name : contact.owner, initiatedBy: nameChanged && initiated ? nextIdentity.name : contact.initiatedBy, ownerUserEmail: owns ? nextEmail : contact.ownerUserEmail, initiatedByUserEmail: initiated ? nextEmail : contact.initiatedByUserEmail };
      }));
      setTasks((current) => current.map((task) => {
        const owns = task.ownerUserEmail === previousEmail;
        const created = task.createdByUserEmail === previousEmail;
        return { ...task, owner: nameChanged && owns ? nextIdentity.name : task.owner, createdBy: nameChanged && created ? nextIdentity.name : task.createdBy, ownerUserEmail: owns ? nextEmail : task.ownerUserEmail, createdByUserEmail: created ? nextEmail : task.createdByUserEmail };
      }));
    }
    if (nameChanged) {
      setLookups((current) => current.map((group) => group.type === "cjn-manager" ? { ...group, items: group.items.map((item) => item.value === identity.name ? { ...item, value: nextIdentity.name } : item) } : group));
    }
    if (emailChanged) {
      setReadNotificationIdsByAccount((current) => {
        const next = { ...current, [nextEmail]: current[previousEmail] ?? [] };
        delete next[previousEmail];
        return next;
      });
      setPreferencesByAccount((current) => {
        const next = { ...current, [nextEmail]: current[previousEmail] ?? DEFAULT_PREFERENCES };
        delete next[previousEmail];
        return next;
      });
    }
    setIdentity({ ...nextIdentity, email: nextEmail, accountEmail: nextEmail, role: identity.role, method: "Email" });
    if (nameChanged) addAudit("FIELD CHANGE", `User · ${nextEmail}`, `Full name: ${identity.name} → ${nextIdentity.name}`);
    if (emailChanged) addAudit("FIELD CHANGE", `User · ${nextEmail}`, `Email: ${previousEmail} → ${nextEmail}`);
    if (photoChanged) addAudit("FIELD CHANGE", `User · ${nextEmail}`, nextIdentity.photoDataUrl ? "Profile photo updated" : "Profile photo removed");
    if (newPassword) addAudit("FIELD CHANGE", `User · ${nextEmail}`, "Password changed");
    setModal(null);
    notify(newPassword ? "Profile and password updated" : "Profile updated");
    return null;
  }

  function updatePreferences(nextPreferences: Preferences) {
    if (notificationAccountKey) setPreferencesByAccount((current) => ({ ...current, [notificationAccountKey]: nextPreferences }));
    setModal(null);
    notify("Notification preferences saved");
  }

  if (!identity) return <AuthScreen users={users} credentials={credentials} onAuthenticate={authenticate} onRegister={registerAccount} />;

  const navPrimary: View[] = ["dashboard", "pipeline", "companies", "contacts", "activity"];
  const navAdmin: View[] = [
    ...(hasPermission(currentRole, "lookup.manage") ? ["lookups" as View] : []),
    ...(hasPermission(currentRole, "user.manage") ? ["users" as View] : []),
    ...(hasPermission(currentRole, "audit.view") ? ["audit" as View] : []),
  ];

  return (
    <div className="crm-app">
      <header className="topbar">
        <button ref={mobileMenuButtonRef} className="topbar-icon mobile-menu-button" type="button" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? "Close menu" : "Open menu"} aria-expanded={sidebarOpen} aria-controls="main-navigation">☰</button>
        <button className="brand" type="button" onClick={() => navigate("dashboard")} aria-label="Client Data CRM — Dashboard">
          <span className="brand-mark">C</span>
          <span className="brand-copy"><b>Client Data</b><small>CRM workspace</small></span>
        </button>
        <div className="global-search" ref={globalSearchRef}>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={globalSearch}
            onChange={(event) => { setGlobalSearch(event.target.value); setGlobalSearchIndex(0); }}
            onKeyDown={handleGlobalSearchKeyDown}
            placeholder="Search companies, contacts, tasks…"
            aria-label="Global search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={globalSearchOpen}
            aria-controls="global-search-results"
            aria-activedescendant={activeGlobalSearchIndex >= 0 ? `global-search-option-${activeGlobalSearchIndex}` : undefined}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {globalSearchOpen && (
            <div className="search-results">
              <p id="global-search-label">Suggestions</p>
              <div id="global-search-results" role="listbox" aria-labelledby="global-search-label">
              {globalResults.map((result, index) => (
                <button id={`global-search-option-${index}`} key={`${result.type}-${result.id}`} type="button" role="option" tabIndex={-1} aria-selected={activeGlobalSearchIndex === index} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setGlobalSearchIndex(index)} onClick={() => openGlobalResult(result)}>
                  <span className="result-type">{result.type.slice(0, 1)}</span>
                  <span><b>{result.label}</b><small>{result.meta}</small></span>
                </button>
              ))}
              {globalResults.length === 0 && <div className="search-results-empty" role="status">No matches found</div>}
              </div>
            </div>
          )}
          <span className="sr-only" aria-live="polite">{globalSearchOpen ? `${globalResults.length} search suggestions` : ""}</span>
        </div>
        <div className="topbar-actions" ref={topbarActionsRef}>
          <button
            ref={notificationButtonRef}
            className={`topbar-icon notification-button${notificationsOpen ? " active" : ""}`}
            type="button"
            aria-label={`Notifications, ${unreadNotifications.length} unread`}
            aria-expanded={notificationsOpen}
            aria-controls="notifications-popover"
            onClick={() => { setNotificationsOpen((open) => !open); setProfileOpen(false); }}
          >♢{unreadNotifications.length > 0 && <span>{unreadNotifications.length}</span>}</button>
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
            <span aria-hidden="true">⌄</span>
          </button>
          {notificationsOpen && (
            <div className="topbar-popover notifications-popover" id="notifications-popover" role="dialog" aria-label="Notifications">
              <div className="popover-heading"><div><b>Notifications</b><small>{unreadNotifications.length === 0 ? "You're all caught up" : `${unreadNotifications.length} ${unreadNotifications.length === 1 ? "item needs" : "items need"} attention`}</small></div><button type="button" disabled={unreadNotifications.length === 0} onClick={() => { updateReadNotificationIds((current) => Array.from(new Set([...current, ...notifications.map((item) => item.id)]))); notify("All notifications marked as read"); }}>Mark all as read</button></div>
              <div className="notification-logic"><b>Only activity connected to you</b><small>Unread items from tasks you own or created, records you manage, their changes, and your activity summary. The list is capped at 10.</small></div>
              <div className="notification-list">
                {notifications.map((item) => {
                  const isRead = readNotificationIds.includes(item.id);
                  return <button type="button" className={`notification-item${isRead ? " read" : ""}`} key={item.id} onClick={() => openNotification(item)}><span className={`notification-icon ${item.kind}`}>{item.kind === "overdue" ? "!" : item.kind === "update" ? "↻" : "✓"}</span><span><b>{item.title}</b><small>{item.detail}</small></span>{!isRead && <i className="unread-dot" aria-label="Unread" />}</button>;
                })}
                {notifications.length === 0 && <div className="notification-empty"><b>No notifications</b><small>New tasks and record changes will appear here.</small></div>}
              </div>
              <button type="button" className="popover-footer-button" onClick={() => navigate("activity")}>Open Activity →</button>
            </div>
          )}
          {profileOpen && (
            <div className="topbar-popover profile-popover" id="profile-popover" role="dialog" aria-label="Profile menu">
              <div className="profile-popover-user"><Avatar name={identity.name} src={identity.photoDataUrl} /><span><b>{identity.name}</b><a href={`mailto:${identity.email}`}>{identity.email}</a><small>{identity.role} · signed in by email</small></span></div>
              <button type="button" onClick={() => { setProfileOpen(false); setModal("profile"); }}><span>◎</span><span><b>My profile</b><small>Contact details and role</small></span></button>
              <button type="button" onClick={() => { setProfileOpen(false); setModal("settings"); }}><span>⚙</span><span><b>Settings</b><small>Language, timezone, notifications</small></span></button>
              {canViewAudit && <button type="button" onClick={() => { setProfileOpen(false); navigate("audit"); }}><span>↻</span><span><b>My activity</b><small>Recent changes in the Audit Log</small></span></button>}
              <button className="profile-signout" type="button" onClick={signOut}><span>↪</span><span><b>Sign out</b><small>Return to the sign-in screen</small></span></button>
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
                {item === "activity" && openTasks.length > 0 && <em title={`${openTasks.length} open tasks`} aria-label={`${openTasks.length} open tasks`}>{openTasks.length}</em>}
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
            <div><b>Workspace ready</b><small>Europe/Kyiv · Session data</small></div>
          </div>
        </aside>
        {sidebarOpen && <button className="sidebar-scrim" type="button" tabIndex={-1} onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}

        <main className="main-content">
          <div className="page-topline">
            <div>
              <p className="eyebrow">{VIEW_META[view].eyebrow}</p>
              <h1>{VIEW_META[view].label}</h1>
            </div>
            <div className="date-chip"><span>●</span> {todayKyiv()} · Kyiv</div>
          </div>

          {view === "dashboard" && (
            <Dashboard
              companies={liveCompanies}
              contacts={liveContacts}
              tasks={liveTasks}
              statusOrder={clientStatusOrder}
              openTasks={openTasks}
              overdueTasks={overdueTasks}
              audit={audit}
              canViewAudit={canViewAudit}
              identity={identity}
              navigate={navigate}
              openAuditEntity={openAuditEntity}
              openCompaniesForStatus={(status) => { setCompanyStatus(status); navigate("companies"); }}
              openTasksForManager={(manager) => { setTaskManagerFilter(manager); setTaskFilter("All"); navigate("activity"); }}
            />
          )}
          {view === "pipeline" && <Pipeline companies={liveCompanies} contacts={liveContacts} tasks={liveTasks} statusOrder={clientStatusOrder} canMove={hasPermission(currentRole, "pipeline.move")} showInternalIds={currentRole === "Admin"} moveCompany={moveCompany} openCompany={setSelectedCompany} />}
          {view === "companies" && (
            <Companies
              companies={filteredCompanies}
              allCompanies={liveCompanies}
              query={companyQuery}
              setQuery={setCompanyQuery}
              status={companyStatus}
              setStatus={setCompanyStatus}
              contacts={liveContacts}
              statusOptions={clientStatusOrder}
              canCreate={hasPermission(currentRole, "company.create")}
              showInternalIds={currentRole === "Admin"}
              openCompany={setSelectedCompany}
              add={() => { if (requirePermission("company.create", "create companies")) setModal("company"); }}
            />
          )}
          {view === "contacts" && (
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
          {view === "activity" && (
            <Activity
              tasks={liveTasks}
              companies={liveCompanies}
              filter={taskFilter}
              setFilter={setTaskFilter}
              managerFilter={taskManagerFilter}
              setManagerFilter={setTaskManagerFilter}
              comments={taskComments}
              canCreate={hasPermission(currentRole, "task.create")}
              canCreateContact={hasPermission(currentRole, "contact.create")}
              add={() => openTaskForm()}
              addContact={() => openContactForm()}
              openTask={setSelectedTask}
            />
          )}
          {view === "lookups" && hasPermission(currentRole, "lookup.manage") && <Lookups groups={lookups} archivedRecords={[
            ...companies.filter((company) => archivedCompanyIds.includes(company.id)).map((company) => ({ entity: "Company" as const, id: company.id, label: company.name })),
            ...contacts.filter((contact) => archivedContactIds.includes(contact.id)).map((contact) => ({ entity: "Contact" as const, id: contact.id, label: contact.name })),
            ...tasks.filter((task) => archivedTaskIds.includes(task.id)).map((task) => ({ entity: "Task" as const, id: task.id, label: task.title })),
          ]} restoreRecord={restoreRecord} addValue={addLookupValue} renameValue={renameLookupValue} toggleValue={toggleLookupValue} moveValue={moveLookupValue} />}
          {view === "users" && hasPermission(currentRole, "user.manage") && <Users users={users} invite={() => { if (requirePermission("user.manage", "manage users")) setModal("user"); }} openUser={setSelectedUser} />}
          {view === "audit" && hasPermission(currentRole, "audit.view") && <Audit events={audit} canExport={hasPermission(currentRole, "audit.export")} />}
        </main>
      </div>

      {selectedCompany && (
        <CompanyDetail
          key={`${selectedCompany.id}-${currentRole}`}
          company={companies.find((company) => company.id === selectedCompany.id) ?? selectedCompany}
          contacts={liveContacts.filter((contact) => contact.companyId === selectedCompany.id)}
          tasks={liveTasks.filter((task) => task.companyId === selectedCompany.id)}
          onClose={() => setSelectedCompany(null)}
          openTask={(task) => { setSelectedCompany(null); setSelectedTask(task); }}
          openContact={(contact) => { setSelectedCompany(null); setSelectedContact(contact); }}
          updateCompany={updateCompany}
          canEdit={hasPermission(currentRole, "company.edit")}
          canMovePipeline={hasPermission(currentRole, "pipeline.move")}
          canAddContact={hasPermission(currentRole, "contact.create")}
          canAddTask={hasPermission(currentRole, "task.create")}
          canArchive={hasPermission(currentRole, "record.archive")}
          showInternalIds={currentRole === "Admin"}
          archive={() => archiveCompany(selectedCompany)}
          statusOptions={activeClientStatuses}
          companyTypeOptions={companyTypeOptions}
          managerOptions={managerOptions}
          addContact={() => { const id = selectedCompany.id; setSelectedCompany(null); openContactForm(id); }}
          addTask={() => { const id = selectedCompany.id; setSelectedCompany(null); openTaskForm(id); }}
        />
      )}

      {selectedContact && (
        <ContactDetail
          key={`${selectedContact.id}-${currentRole}`}
          contact={contacts.find((contact) => contact.id === selectedContact.id) ?? selectedContact}
          companies={liveCompanies}
          onClose={() => setSelectedContact(null)}
          updateContact={updateContact}
          canEdit={hasPermission(currentRole, "contact.edit")}
          canArchive={hasPermission(currentRole, "record.archive")}
          showInternalIds={currentRole === "Admin"}
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
          contacts={contacts.filter((contact) => contact.companyId === selectedTask.companyId && !archivedContactIds.includes(contact.id))}
          comments={taskComments.filter((comment) => comment.taskId === selectedTask.id)}
          events={audit.filter((event) => event.entity === `Task · ${selectedTask.id}`)}
          onClose={() => setSelectedTask(null)}
          updateStatus={updateTaskStatus}
          updateTask={updateTask}
          addComment={addTaskComment}
          canEdit={hasPermission(currentRole, "task.edit")}
          canComment={hasPermission(currentRole, "task.comment")}
          canArchive={hasPermission(currentRole, "record.archive")}
          archive={() => archiveTask(selectedTask)}
          taskStatusOptions={taskStatusOptions}
          outcomeStatusOptions={outcomeStatusOptions}
          reminderLeadOptions={reminderLeadOptions}
          managerOptions={managerOptions}
        />
      )}

      {selectedUser && (
        <UserDetail
          user={users.find((user) => user.email === selectedUser.email) ?? selectedUser}
          onClose={() => setSelectedUser(null)}
          updateUser={updateUser}
        />
      )}

      {modal === "company" && <CompanyForm statusOptions={activeClientStatuses} companyTypeOptions={companyTypeOptions} managerOptions={managerOptions} onClose={() => setModal(null)} onSubmit={addCompany} />}
      {modal === "contact" && <ContactForm companies={liveCompanies} sourceOptions={contactSourceOptions} initiatorOptions={users.filter((user) => user.state === "Active")} initialCompanyId={modalCompanyId} currentUserEmail={identity.accountEmail} onClose={() => setModal(null)} onSubmit={addContact} />}
      {modal === "task" && <TaskForm companies={liveCompanies} contacts={liveContacts} taskStatusOptions={taskStatusOptions} outcomeStatusOptions={outcomeStatusOptions} reminderLeadOptions={reminderLeadOptions} managerOptions={managerOptions} initiatorOptions={users.filter((user) => user.state === "Active")} currentUserEmail={identity.accountEmail} initialCompanyId={modalCompanyId} canAddContact={hasPermission(currentRole, "contact.create")} onAddContact={createContact} onClose={() => setModal(null)} onSubmit={addTask} />}
      {modal === "user" && <UserForm onClose={() => setModal(null)} onSubmit={inviteUser} />}
      {modal === "profile" && <ProfileModal identity={identity} onClose={() => setModal(null)} onSave={updateProfile} />}
      {modal === "settings" && <SettingsModal preferences={preferences} onClose={() => setModal(null)} onSave={updatePreferences} />}

      <PageScrollControls hidden={overlayOpen} />

      {toast && <div className={`toast toast-${toast.tone}`} role="status"><span>{toast.tone === "success" ? "✓" : "!"}</span>{toast.message}</div>}
    </div>
  );
}

function Dashboard({ companies, contacts, tasks, statusOrder, openTasks, overdueTasks, audit, canViewAudit, identity, navigate, openAuditEntity, openCompaniesForStatus, openTasksForManager }: {
  companies: Company[];
  contacts: Contact[];
  tasks: Task[];
  statusOrder: string[];
  openTasks: Task[];
  overdueTasks: Task[];
  audit: AuditEvent[];
  canViewAudit: boolean;
  identity: AuthIdentity;
  navigate: (view: View) => void;
  openAuditEntity: (event: AuditEvent) => void;
  openCompaniesForStatus: (status: string) => void;
  openTasksForManager: (manager: string) => void;
}) {
  const stageCounts = statusOrder.map((status) => ({ status, count: companies.filter((company) => company.status === status).length }));
  const max = Math.max(...stageCounts.map((item) => item.count), 1);
  const managerActivity = Array.from(new Set(tasks.map((task) => task.owner)))
    .map((manager) => ({ manager, count: tasks.filter((task) => task.owner === manager).length, open: openTasks.filter((task) => task.owner === manager).length }))
    .sort((a, b) => b.count - a.count);

  return (
    <>
      <section className="welcome-card">
        <div>
          <p>{kyivGreeting()}, {identity.name.split(" ")[0]}</p>
          <h2>Here is what needs the team&apos;s attention today.</h2>
        </div>
        <button className="primary-button" type="button" onClick={() => navigate("activity")}>View tasks <span>→</span></button>
      </section>

      <section className="kpi-grid" aria-label="Key metrics">
        <button className="kpi-card" type="button" onClick={() => navigate("companies")}>
          <span className="kpi-icon blue">▦</span>
          <span><small>Companies</small><b>{companies.length}</b><em>All active CRM records</em></span>
        </button>
        <button className="kpi-card" type="button" onClick={() => navigate("contacts")}>
          <span className="kpi-icon cyan">◎</span>
          <span><small>Contacts</small><b>{contacts.length}</b><em>Across {companies.filter((company) => contactCount(contacts, company.id) > 0).length} companies</em></span>
        </button>
        <button className="kpi-card" type="button" onClick={() => navigate("activity")}>
          <span className="kpi-icon green">≡</span>
          <span><small>Tasks total</small><b>{tasks.length}</b><em>{tasks.filter((task) => task.status === "Completed").length} completed</em></span>
        </button>
        <button className="kpi-card kpi-open" type="button" onClick={() => navigate("activity")}>
          <span className="kpi-icon amber">✓</span>
          <span><small>Open tasks</small><b>{openTasks.length}</b><em>Current work queue</em></span>
        </button>
        <button className="kpi-card kpi-overdue" type="button" onClick={() => navigate("activity")}>
          <span className="kpi-icon red">!</span>
          <span><small>Overdue</small><b>{overdueTasks.length}</b><em>{overdueTasks.length ? "Needs attention" : "No overdue tasks"}</em></span>
        </button>
      </section>

      {canViewAudit && <section className="panel recent-panel dashboard-recent-panel">
          <div className="panel-heading"><div><p className="eyebrow">Live</p><h2>Recent changes</h2></div><CountBadge count={audit.length} label="events" detail={`${audit.length} events are currently recorded in the Audit Log.`} /></div>
          <div className="timeline">
            {audit.slice(0, 4).map((event, index) => <button className="timeline-event" type="button" key={event.id} onClick={() => openAuditEntity(event)}><span className={`timeline-avatar ${["green", "blue", "violet", "navy"][index % 4]}`}>{event.actor.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span><b>{event.actor}</b><small>{event.action.toLowerCase()} · {event.entity}</small><em>{event.at} · Kyiv</em></span><span className="row-arrow">›</span></button>)}
            {audit.length === 0 && <div className="empty-state compact"><b>No recent changes</b><span>New CRM activity will appear here.</span></div>}
          </div>
        </section>}

      <section className="panel funnel-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Client workflow</p><h2>Relationship overview</h2></div>
          <button className="text-button" type="button" onClick={() => navigate("pipeline")}>Open board →</button>
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
        <div className="panel-heading"><div><p className="eyebrow">Team load</p><h2>Activity by manager</h2></div><CountBadge count={tasks.length} label="tasks" detail={`${tasks.length} active task records are included in this view.`} /></div>
        <div className="manager-activity-list">
          {managerActivity.map((item) => <button type="button" key={item.manager} onClick={() => openTasksForManager(item.manager)}><span className="mini-avatar">{item.manager.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><b>{item.manager}</b><small>{item.open} open</small></span><strong>{item.count}</strong><span className="row-arrow">›</span></button>)}
          {managerActivity.length === 0 && <div className="empty-state compact"><b>No manager activity</b><span>Tasks will appear here after creation.</span></div>}
        </div>
      </section>
    </>
  );
}

function Pipeline({ companies, contacts, tasks, statusOrder, canMove, showInternalIds, moveCompany, openCompany }: { companies: Company[]; contacts: Contact[]; tasks: Task[]; statusOrder: string[]; canMove: boolean; showInternalIds: boolean; moveCompany: (id: string, status: string) => void; openCompany: (company: Company) => void }) {
  return (
    <>
      <div className="page-actions-row">
        <p className="page-description">{canMove ? "Use the status selector on a card to update the relationship workflow. On mobile, the board scrolls horizontally." : "Browse every stage of the relationship workflow. Your role has view-only access."}</p>
        <div className="legend"><span><i className="legend-dot hot" /> Active</span><span><i className="legend-dot quiet" /> No open activity</span></div>
      </div>
      <section className="kanban" aria-label="Relationship workflow board">
        {statusOrder.map((status) => {
          const items = companies.filter((company) => company.status === status);
          const columnOpenTasks = items.reduce((sum, company) => sum + tasks.filter((task) => task.companyId === company.id && isOpenTask(task)).length, 0);
          return (
            <div className="kanban-column" key={status}>
              <header><span><i className={`stage-dot stage-${status.toLowerCase().replace(/[^a-z]+/g, "-")}`} />{status}</span><CountBadge count={items.length} label="companies" detail={`${status} column: ${items.length} companies and ${columnOpenTasks} open tasks.`} /></header>
              <p className="column-total">{openTaskLabel(columnOpenTasks)}</p>
              <div className="kanban-stack">
                {items.map((company) => (
                  <article key={company.id} className="pipeline-card" tabIndex={0} onClick={() => openCompany(company)} onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) openCompany(company); }}>
                    <div className="pipeline-card-top"><span>{showInternalIds ? company.id : company.kind}</span><button type="button" aria-label={`Open details for ${company.name}`} onClick={(event) => { event.stopPropagation(); openCompany(company); }}>•••</button></div>
                    <h3>{company.name}</h3>
                    <p>{company.city}, {company.country}</p>
                    <div className="pipeline-card-meta"><span>{openTaskLabel(tasks.filter((task) => task.companyId === company.id && isOpenTask(task)).length)}</span><CountBadge count={contactCount(contacts, company.id)} label="contacts" detail={`Contact people at ${company.name}. Open the card to view the full list.`} /></div>
                    {canMove && <select className="pipeline-stage-select" value={company.status} aria-label={`Relationship status for ${company.name}`} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); moveCompany(company.id, event.target.value); }}>{statusOrder.map((stage) => <option key={stage}>{stage}</option>)}</select>}
                    <footer><span className="mini-avatar">{company.owner.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span>Next activity: {nextActivityLabel(tasks, company.id)}</span></footer>
                  </article>
                ))}
                {items.length === 0 && <div className="kanban-empty">No companies</div>}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

function Companies({ companies, allCompanies, contacts, statusOptions, query, setQuery, status, setStatus, canCreate, showInternalIds, openCompany, add }: {
  companies: Company[];
  allCompanies: Company[];
  contacts: Contact[];
  statusOptions: string[];
  query: string;
  setQuery: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  canCreate: boolean;
  showInternalIds: boolean;
  openCompany: (company: Company) => void;
  add: () => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const [ownerFilter, setOwnerFilter] = useState("All owners");
  const [countryFilter, setCountryFilter] = useState("All countries");
  const [typeFilter, setTypeFilter] = useState("All types");
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<"name" | "kind" | "country" | "status" | "lastContact">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const filtered = companies.filter((company) =>
    (ownerFilter === "All owners" || company.owner === ownerFilter) &&
    (countryFilter === "All countries" || company.country === countryFilter) &&
    (typeFilter === "All types" || company.kind === typeFilter),
  ).sort((a, b) => String(a[sortField]).localeCompare(String(b[sortField])) * (sortDirection === "asc" ? 1 : -1));
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleCompanies = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const owners = Array.from(new Set(allCompanies.map((company) => company.owner))).sort();
  const countries = Array.from(new Set(allCompanies.map((company) => company.country))).sort();
  const types = Array.from(new Set(allCompanies.map((company) => company.kind))).sort();
  const sortBy = (field: typeof sortField) => { setPage(1); if (sortField === field) setSortDirection((direction) => direction === "asc" ? "desc" : "asc"); else { setSortField(field); setSortDirection("asc"); } };
  const advancedFiltersActive = ownerFilter !== "All owners" || countryFilter !== "All countries" || typeFilter !== "All types";
  const normalizedQuery = query.trim().toLowerCase();
  const suggestions = normalizedQuery ? allCompanies
    .filter((company) => (status === "All statuses" || company.status === status)
      && (ownerFilter === "All owners" || company.owner === ownerFilter)
      && (countryFilter === "All countries" || company.country === countryFilter)
      && (typeFilter === "All types" || company.kind === typeFilter)
      && [company.name, company.city, company.country, company.kind, company.website, company.linkedin ?? "", company.owner, company.description].some((value) => value.toLowerCase().includes(normalizedQuery)))
    .sort((a, b) => {
      const rank = (company: Company) => {
        const name = company.name.toLowerCase();
        if (name.startsWith(normalizedQuery)) return 0;
        if (name.split(/\s+/).some((word) => word.startsWith(normalizedQuery))) return 1;
        if (name.includes(normalizedQuery)) return 2;
        return 3;
      };
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    })
    .slice(0, 5) : [];

  useEffect(() => {
    if (activeSuggestion < 0) return;
    searchWrapperRef.current?.querySelector<HTMLElement>(".company-search-suggestions > button.active")?.scrollIntoView({ block: "nearest" });
  }, [activeSuggestion]);

  function selectSuggestion(company: Company) {
    setQuery(company.name);
    setPage(1);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    openCompany(company);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      setActiveSuggestion(-1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSuggestionsOpen(Boolean(normalizedQuery));
      if (suggestions.length) setActiveSuggestion((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSuggestionsOpen(Boolean(normalizedQuery));
      if (suggestions.length) setActiveSuggestion((current) => current <= 0 ? suggestions.length - 1 : current - 1);
    } else if (event.key === "Enter" && activeSuggestion >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeSuggestion]);
    }
  }

  return (
    <section className="panel data-panel">
      <div className="data-toolbar companies-toolbar">
        <div className="company-search-combobox" ref={searchWrapperRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setSuggestionsOpen(false); setActiveSuggestion(-1); } }}>
          <div className="toolbar-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => { const value = event.target.value; setQuery(value); setPage(1); setSuggestionsOpen(Boolean(value.trim())); setActiveSuggestion(-1); }} onFocus={() => setSuggestionsOpen(Boolean(query.trim()))} onKeyDown={handleSearchKeyDown} placeholder="Search companies" aria-label="Search companies" role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen && Boolean(normalizedQuery)} aria-controls="company-search-results" aria-activedescendant={activeSuggestion >= 0 ? `company-search-option-${suggestions[activeSuggestion]?.id}` : undefined} autoComplete="off" spellCheck={false} enterKeyHint="search" />{query && <button className="search-clear-button" type="button" aria-label="Clear company search" onClick={() => { setQuery(""); setPage(1); setSuggestionsOpen(false); setActiveSuggestion(-1); }}>×</button>}</div>
          {suggestionsOpen && normalizedQuery && <div className="company-search-suggestions" id="company-search-results" role="listbox" aria-label="Company suggestions">
            {suggestions.map((company, index) => <button id={`company-search-option-${company.id}`} className={activeSuggestion === index ? "active" : ""} type="button" role="option" tabIndex={-1} aria-selected={activeSuggestion === index} key={company.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectSuggestion(company)}><EntityLogo name={company.name} src={company.logoDataUrl} lazy /><span><b>{company.name}</b><small>{company.city}, {company.country} · {company.kind}</small></span><span aria-hidden="true">›</span></button>)}
            {suggestions.length === 0 && <div className="company-search-empty">No matching companies</div>}
          </div>}
          <span className="sr-only" aria-live="polite">{normalizedQuery ? `${suggestions.length} company suggestions` : ""}</span>
        </div>
        <div className="companies-toolbar-controls">
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); setSuggestionsOpen(Boolean(query.trim())); }} aria-label="Filter by status">
            <option>All statuses</option>
            {statusOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
          <button className={`secondary-button${filtersOpen || advancedFiltersActive ? " control-active" : ""}`} type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>≡ Filters</button>
          <span className="toolbar-spacer" />
          {canCreate && <button className="primary-button companies-add-button" type="button" onClick={add}><span className="button-label-full">＋ Add company</span><span className="button-label-short">＋ Add</span></button>}
        </div>
      </div>
      {filtersOpen && (
        <div className="filter-drawer">
          <label><span>Owner</span><select value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setPage(1); }}><option>All owners</option>{owners.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
          <label><span>Country</span><select value={countryFilter} onChange={(event) => { setCountryFilter(event.target.value); setPage(1); }}><option>All countries</option>{countries.map((country) => <option key={country}>{country}</option>)}</select></label>
          <label><span>Company type</span><select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}><option>All types</option>{types.map((type) => <option key={type}>{type}</option>)}</select></label>
          <button className="secondary-button" type="button" onClick={() => { setStatus("All statuses"); setOwnerFilter("All owners"); setCountryFilter("All countries"); setTypeFilter("All types"); setPage(1); }}>Reset</button>
          <button className="primary-button" type="button" onClick={() => setFiltersOpen(false)}>Done</button>
        </div>
      )}
      <div className="table-scroll responsive-card-scroll" role="region" aria-label="Companies table" tabIndex={0}>
        <table className="data-table companies-table responsive-card-table">
          <thead><tr><th><button className="sort-button" type="button" onClick={() => sortBy("name")}>Company {sortField === "name" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th><th><button className="sort-button" type="button" onClick={() => sortBy("kind")}>Type {sortField === "kind" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th><th><button className="sort-button" type="button" onClick={() => sortBy("country")}>Location {sortField === "country" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th><th><button className="sort-button" type="button" onClick={() => sortBy("status")}>Client status {sortField === "status" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th><th>Contacts</th><th><button className="sort-button" type="button" onClick={() => sortBy("lastContact")}>Last contact {sortField === "lastContact" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th><th>Owner</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {visibleCompanies.map((company) => (
              <tr key={company.id} tabIndex={0} onClick={() => openCompany(company)} onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) openCompany(company); }}>
                <td data-label="Company"><span className="company-cell"><EntityLogo name={company.name} src={company.logoDataUrl} lazy /><span><b>{company.name}</b>{(showInternalIds || company.website) && <small>{showInternalIds && <>{company.id}{company.website ? " · " : ""}</>}{company.website && <a className="inline-data-link compact" href={websiteHref(company.website)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{company.website}</a>}</small>}</span></span></td>
                <td data-label="Type"><span className="company-card-value">{company.kind}</span></td>
                <td data-label="Location"><span className="company-card-value"><b className="normal-weight">{company.city}</b><small className="cell-sub">{company.country}</small></span></td>
                <td data-label="Client status"><span className="company-card-value"><StatusBadge value={company.status} /></span></td>
                <td data-label="Contacts"><span className="company-card-value"><CountBadge count={contactCount(contacts, company.id)} label="contacts" detail={`${company.name} has ${contactCount(contacts, company.id)} saved contact people. Open the company profile for details.`} /></span></td>
                <td data-label="Last contact"><span className="company-card-value">{company.lastContact}</span></td>
                <td data-label="Owner"><span className="company-card-value"><span className="owner-cell"><span className="mini-avatar">{company.owner.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>{company.owner}</span></span></td>
                <td data-label="Actions"><button className="row-menu" type="button" aria-label={`Open details for ${company.name}`} onClick={(event) => { event.stopPropagation(); openCompany(company); }}>•••</button></td>
              </tr>
            ))}
            {visibleCompanies.length === 0 && <tr className="table-empty-row"><td colSpan={8}>No companies match the current filters.</td></tr>}
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
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const [sourceFilter, setSourceFilter] = useState("All sources");
  const [ownerFilter, setOwnerFilter] = useState("All owners");
  const [companyFilter, setCompanyFilter] = useState("All companies");
  const [linkedinFilter, setLinkedinFilter] = useState("Any LinkedIn");
  const [statusFilter, setStatusFilter] = useState("All contact statuses");
  const [page, setPage] = useState(1);
  const filtered = contacts.filter((contact) =>
    (sourceFilter === "All sources" || contact.source === sourceFilter) &&
    (ownerFilter === "All owners" || contact.owner === ownerFilter) &&
    (companyFilter === "All companies" || contact.companyId === companyFilter) &&
    (statusFilter === "All contact statuses" || contact.status === statusFilter) &&
    (linkedinFilter === "Any LinkedIn" || (linkedinFilter === "Has LinkedIn" ? Boolean(contact.linkedin) : !contact.linkedin)),
  );
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleContacts = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const sources = Array.from(new Set(contacts.map((contact) => contact.source))).sort();
  const owners = Array.from(new Set(contacts.map((contact) => contact.owner))).sort();
  const hasActiveFilters = Boolean(query) || sourceFilter !== "All sources" || ownerFilter !== "All owners" || companyFilter !== "All companies" || linkedinFilter !== "Any LinkedIn" || statusFilter !== "All contact statuses";
  const normalizedQuery = query.trim().toLowerCase();
  const suggestions = normalizedQuery ? [...filtered]
    .sort((a, b) => {
      const aValues = [a.name, a.email, a.phone, a.position, a.source, a.linkedin ?? "", companyName(companies, a.companyId)];
      const bValues = [b.name, b.email, b.phone, b.position, b.source, b.linkedin ?? "", companyName(companies, b.companyId)];
      return autocompleteRank(a.name, aValues, normalizedQuery) - autocompleteRank(b.name, bValues, normalizedQuery) || a.name.localeCompare(b.name);
    })
    .slice(0, 6) : [];

  useEffect(() => {
    if (activeSuggestion < 0) return;
    searchWrapperRef.current?.querySelector<HTMLElement>(".contact-search-suggestions > button.active")?.scrollIntoView({ block: "nearest" });
  }, [activeSuggestion]);

  function selectSuggestion(contact: Contact) {
    setQuery(contact.name);
    setPage(1);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    openContact(contact);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (!suggestionsOpen) return;
      event.preventDefault();
      event.stopPropagation();
      setSuggestionsOpen(false);
      setActiveSuggestion(-1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSuggestionsOpen(Boolean(normalizedQuery));
      if (suggestions.length) setActiveSuggestion((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSuggestionsOpen(Boolean(normalizedQuery));
      if (suggestions.length) setActiveSuggestion((current) => current <= 0 ? suggestions.length - 1 : current - 1);
    } else if (event.key === "Enter" && suggestionsOpen && activeSuggestion >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeSuggestion]);
    }
  }

  return (
    <section className="panel data-panel">
      <div className="data-toolbar contacts-toolbar">
        <div className="contact-search-combobox" ref={searchWrapperRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setSuggestionsOpen(false); setActiveSuggestion(-1); } }}>
          <div className="toolbar-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => { const value = event.target.value; setQuery(value); setPage(1); setSuggestionsOpen(Boolean(value.trim())); setActiveSuggestion(-1); }} onFocus={() => setSuggestionsOpen(Boolean(query.trim()))} onKeyDown={handleSearchKeyDown} placeholder="Name, email, or company" aria-label="Search contacts" role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen && Boolean(normalizedQuery)} aria-controls="contact-search-results" aria-activedescendant={activeSuggestion >= 0 ? `contact-search-option-${suggestions[activeSuggestion]?.id}` : undefined} autoComplete="off" spellCheck={false} enterKeyHint="search" />{query && <button className="search-clear-button" type="button" aria-label="Clear contact search" onClick={() => { setQuery(""); setPage(1); setSuggestionsOpen(false); setActiveSuggestion(-1); }}>×</button>}</div>
          {suggestionsOpen && normalizedQuery && <div className="contact-search-suggestions" id="contact-search-results" role="listbox" aria-label="Contact suggestions">
            {suggestions.map((contact, index) => <button id={`contact-search-option-${contact.id}`} className={activeSuggestion === index ? "active" : ""} type="button" role="option" tabIndex={-1} aria-selected={activeSuggestion === index} key={contact.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectSuggestion(contact)}><Avatar name={contact.name} src={contact.photoDataUrl} className="person-avatar" lazy /><span><b>{contact.name}</b><small>{companyName(companies, contact.companyId)} · {contact.email || "No email"}</small></span><span aria-hidden="true">›</span></button>)}
            {suggestions.length === 0 && <div className="contact-search-empty" role="status">No matching contacts</div>}
          </div>}
          <span className="sr-only" aria-live="polite">{normalizedQuery ? `${suggestions.length} contact suggestions` : ""}</span>
        </div>
        <div className="contacts-toolbar-controls">
          <button className={`secondary-button${filtersOpen ? " control-active" : ""}`} type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>≡ Filters</button>
          {hasActiveFilters && <button className="text-button toolbar-clear" type="button" onClick={() => { setQuery(""); setSourceFilter("All sources"); setOwnerFilter("All owners"); setCompanyFilter("All companies"); setLinkedinFilter("Any LinkedIn"); setStatusFilter("All contact statuses"); setSuggestionsOpen(false); setActiveSuggestion(-1); setPage(1); }}>Clear</button>}
          <span className="toolbar-spacer" />
          {canCreate && <button className="primary-button contacts-add-button" type="button" onClick={add}><span className="button-label-full">＋ Add contact manually</span><span className="button-label-short">＋ Add</span></button>}
        </div>
      </div>
      {filtersOpen && (
        <div className="filter-drawer">
          <label><span>Source</span><select value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value); setPage(1); }}><option>All sources</option>{sources.map((source) => <option key={source}>{source}</option>)}</select></label>
          <label><span>Company</span><select value={companyFilter} onChange={(event) => { setCompanyFilter(event.target.value); setPage(1); }}><option>All companies</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
          <label><span>LinkedIn</span><select value={linkedinFilter} onChange={(event) => { setLinkedinFilter(event.target.value); setPage(1); }}><option>Any LinkedIn</option><option>Has LinkedIn</option><option>No LinkedIn</option></select></label>
          <label><span>Contact status</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option>All contact statuses</option>{CONTACT_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Owner</span><select value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setPage(1); }}><option>All owners</option>{owners.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
          <button className="secondary-button" type="button" onClick={() => { setSourceFilter("All sources"); setOwnerFilter("All owners"); setCompanyFilter("All companies"); setLinkedinFilter("Any LinkedIn"); setStatusFilter("All contact statuses"); setPage(1); }}>Reset</button>
          <button className="primary-button" type="button" onClick={() => setFiltersOpen(false)}>Done</button>
        </div>
      )}
      <div className="table-scroll responsive-card-scroll" role="region" aria-label="Contacts table" tabIndex={0}>
        <table className="data-table contacts-table responsive-card-table">
          <thead><tr><th>Contact</th><th>Company</th><th>Status</th><th>Position</th><th>Phone</th><th>Source</th><th>Owner</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {visibleContacts.map((contact) => {
              const company = companies.find((item) => item.id === contact.companyId);
              return (
                <tr key={contact.id} tabIndex={0} onClick={() => openContact(contact)} onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) openContact(contact); }}>
                  <td data-label="Contact"><span className="contact-person"><Avatar name={contact.name} src={contact.photoDataUrl} className="person-avatar" lazy /><span><b>{contact.name}</b>{contact.email ? <a className="inline-data-link compact" href={`mailto:${contact.email}`} onClick={(event) => event.stopPropagation()}>{contact.email}</a> : <small>No email</small>}</span></span></td>
                  <td data-label="Company"><button className="table-link" type="button" onClick={(event) => { event.stopPropagation(); if (company) openCompany(company); }}>{company?.name}</button></td>
                  <td data-label="Status"><StatusBadge value={contact.status} /></td>
                  <td data-label="Position">{contact.position || "—"}</td><td data-label="Phone">{contact.phone && contact.phone !== "—" ? <a className="inline-data-link" href={`tel:${contact.phone}`} onClick={(event) => event.stopPropagation()}>{contact.phone}</a> : "—"}</td><td data-label="Source"><StatusBadge value={contact.source} /></td>
                  <td data-label="Owner"><span className="owner-cell"><span className="mini-avatar">{contact.owner.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>{contact.owner}</span></td>
                  <td data-label="Actions"><button className="row-menu" type="button" aria-label={`Open details for ${contact.name}`} onClick={(event) => { event.stopPropagation(); openContact(contact); }}>•••</button></td>
                </tr>
              );
            })}
            {visibleContacts.length === 0 && <tr className="table-empty-row"><td colSpan={8}>No contacts match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="table-footer"><span>Showing {visibleContacts.length} of {filtered.length} contacts</span><div><button type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button><b>{currentPage}/{pageCount}</b><button type="button" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button></div></footer>
    </section>
  );
}

function Activity({ tasks, companies, comments, filter, setFilter, managerFilter, setManagerFilter, canCreate, canCreateContact, add, addContact, openTask }: {
  tasks: Task[];
  companies: Company[];
  comments: TaskComment[];
  filter: string;
  setFilter: (value: string) => void;
  managerFilter: string;
  setManagerFilter: (value: string) => void;
  canCreate: boolean;
  canCreateContact: boolean;
  add: () => void;
  addContact: () => void;
  openTask: (task: Task) => void;
}) {
  const filters = ["Actual", "Overdue", "Completed", "Deferred", "Canceled", "All"];
  const counts: Record<string, number> = {
    Actual: tasks.filter(isOpenTask).length,
    Overdue: tasks.filter(isOverdue).length,
    Completed: tasks.filter((task) => task.status === "Completed").length,
    Deferred: tasks.filter((task) => task.status === "Deferred").length,
    Canceled: tasks.filter((task) => task.status === "Canceled").length,
    All: tasks.length,
  };
  const managers = Array.from(new Set(tasks.map((task) => task.owner))).sort();
  const visibleTasks = tasks.filter((task) => {
    const matchesManager = managerFilter === "All managers" || task.owner === managerFilter;
    const matchesState = filter === "All" || (filter === "Actual" ? isOpenTask(task) : filter === "Overdue" ? isOverdue(task) : task.status === filter);
    return matchesManager && matchesState;
  });
  return (
    <>
      <div className="activity-toolbar">
        <div className="activity-filter-group"><label><span>Manager</span><select value={managerFilter} onChange={(event) => setManagerFilter(event.target.value)}><option>All managers</option>{managers.map((manager) => <option key={manager}>{manager}</option>)}</select></label><div className="segmented-control">{filters.map((item) => <button key={item} className={filter === item ? "active" : ""} type="button" onClick={() => setFilter(item)}>{item}<span>{counts[item]}</span></button>)}</div></div>
        <div className="activity-toolbar-actions">
          {canCreateContact && <button className="secondary-button" type="button" onClick={addContact}>＋ Add contact</button>}
          {canCreate && <button className="primary-button" type="button" onClick={add}>＋ New task</button>}
        </div>
      </div>
      <section className="task-board">
        {visibleTasks.map((task) => (
          <button className={`task-card${isOverdue(task) ? " task-overdue" : ""}`} key={task.id} type="button" onClick={() => openTask(task)}>
            <span className={`task-status-line ${task.status.toLowerCase().replace(" ", "-")}`} />
            <span className="task-card-main">
              <span className="task-title-row"><b>{task.title}</b><StaticStatusBadge value={task.status} /></span>
              <span className="task-company">{companyName(companies, task.companyId)} · {task.id}</span>
              <span className="task-note">{task.note}</span>
              <span className="task-counters">💬 {comments.filter((comment) => comment.taskId === task.id).length} comments</span>
            </span>
            <span className="task-card-side"><StaticStatusBadge value={`${task.priority} priority`} /><b className={isOverdue(task) ? "overdue-text" : ""}>{formatDateTime(task.deadline)}</b><small>{task.owner}</small></span>
            <span className="row-arrow">›</span>
          </button>
        ))}
        {visibleTasks.length === 0 && <div className="empty-state"><b>No tasks match this filter</b><span>Change the filter{canCreate ? " or create a new task" : ""}.</span></div>}
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
  const [activeType, setActiveType] = useState(groups[0]?.type ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const group = groups.find((item) => item.type === activeType) ?? groups[0];
  const fixedRelationshipWorkflow = group.type === "client-status";

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = String(new FormData(form).get("lookupValue") ?? "");
    if (addValue(group.type, value)) form.reset();
  }

  function saveRename(id: string) {
    if (renameValue(group.type, id, editingValue)) {
      setEditingId(null);
      setEditingValue("");
    }
  }

  return (
    <section className="panel lookups-panel">
      <div className="panel-heading"><div><p className="eyebrow">Controlled options</p><h2>Lookup lists</h2></div><CountBadge count={groups.reduce((sum, item) => sum + item.items.filter((value) => value.active).length, 0)} label="active options" detail="Active options are available in create and edit forms." /></div>
      <div className="lookup-layout">
        <div className="lookup-tabs" role="tablist" aria-label="Lookup groups">
          {groups.map((item) => <button type="button" role="tab" aria-selected={group.type === item.type} className={group.type === item.type ? "active" : ""} key={item.type} onClick={() => { setActiveType(item.type); setEditingId(null); }}><span>{item.label}</span><b>{item.items.filter((value) => value.active).length}</b></button>)}
        </div>
        <div className="lookup-editor">
          <header><div><p className="eyebrow">Selected list</p><h3>{group.label}</h3></div><small>{fixedRelationshipWorkflow ? "This workflow always contains exactly five active statuses. You can rename or reorder them." : "Rename, reorder, or deactivate options. Existing records keep their history."}</small></header>
          <ol className="lookup-values">
            {group.items.map((item, index) => <li key={item.id} className={item.active ? "" : "inactive"}>
              <span className="lookup-order">{index + 1}</span>
              {editingId === item.id ? <input value={editingValue} onChange={(event) => setEditingValue(event.target.value)} maxLength={120} autoFocus onKeyDown={(event) => { if (event.key === "Enter") saveRename(item.id); if (event.key === "Escape") setEditingId(null); }} aria-label={`Rename ${item.value}`} /> : <span className="lookup-value-copy"><b>{item.value}</b><small>{item.active ? "Active" : "Inactive · retained for existing records"}</small></span>}
              <span className="lookup-actions">
                <button type="button" disabled={index === 0} onClick={() => moveValue(group.type, item.id, -1)} aria-label={`Move ${item.value} up`}>↑</button>
                <button type="button" disabled={index === group.items.length - 1} onClick={() => moveValue(group.type, item.id, 1)} aria-label={`Move ${item.value} down`}>↓</button>
                {editingId === item.id ? <><button type="button" onClick={() => saveRename(item.id)}>Save</button><button type="button" onClick={() => setEditingId(null)}>Cancel</button></> : <button type="button" onClick={() => { setEditingId(item.id); setEditingValue(item.value); }}>Rename</button>}
                {!fixedRelationshipWorkflow && <button type="button" className={item.active ? "danger-text" : ""} onClick={() => toggleValue(group.type, item.id)}>{item.active ? "Deactivate" : "Activate"}</button>}
              </span>
            </li>)}
          </ol>
        </div>
        {fixedRelationshipWorkflow ? <div className="lookup-fixed-note"><b>Five-status workflow</b><span>{group.items.map((item) => item.value).join(" → ")}</span></div> : <form className="lookup-add-form" onSubmit={add}><label><span>New option</span><input name="lookupValue" required maxLength={120} placeholder={`Add to ${group.label}`} /></label><button className="primary-button" type="submit">＋ Add option</button></form>}
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
        <table className="data-table users-table responsive-card-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login · Kyiv</th><th>Access note</th><th aria-label="Actions" /></tr></thead>
          <tbody>{visibleUsers.map((user) => <tr key={user.email} tabIndex={0} onClick={() => openUser(user)} onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) openUser(user); }}><td data-label="User"><span className="contact-person"><Avatar name={user.name} src={user.photoDataUrl} className="person-avatar" lazy /><span><b>{user.name}</b><a className="inline-data-link compact" href={`mailto:${user.email}`} onClick={(event) => event.stopPropagation()}>{user.email}</a></span></span></td><td data-label="Role"><StatusBadge value={user.role} /></td><td data-label="Status"><StatusBadge value={user.state} /></td><td data-label="Last login · Kyiv">{user.lastLogin}</td><td data-label="Access note">{ROLE_DETAILS[user.role].summary}</td><td data-label="Actions"><button className="row-menu" type="button" aria-label={`Edit access for ${user.name}`} onClick={(event) => { event.stopPropagation(); openUser(user); }}>•••</button></td></tr>)}{visibleUsers.length === 0 && <tr className="table-empty-row"><td colSpan={6}>No users are assigned to this role.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
}

function Audit({ events, canExport }: { events: AuditEvent[]; canExport: boolean }) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("All actions");
  const filtered = events.filter((event) => {
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || [event.actor, event.action, event.entity, event.detail, event.id].some((value) => value.toLowerCase().includes(needle));
    return matchesQuery && (action === "All actions" || event.action === action);
  });

  function exportCsv() {
    const cells = [
      ["Time · Kyiv", "Actor", "Action", "Entity", "Change detail", "Event ID"],
      ...filtered.map((event) => [event.at, event.actor, event.action, event.entity, event.detail, event.id]),
    ];
    const csv = cells.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `client-data-audit-${todayKyiv()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel data-panel">
      <div className="audit-banner"><span>↻</span><p><b>Read-only event view</b><small>This frontend exposes no edit or delete action for activity events.</small></p></div>
      <div className="data-toolbar"><div className="toolbar-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the log" aria-label="Search the log" /></div><select value={action} onChange={(event) => setAction(event.target.value)} aria-label="Event type"><option>All actions</option><option>FIELD CHANGE</option><option>STATUS CHANGE</option><option>CREATE</option><option>COMMENT</option><option>REMINDER SENT</option></select><span className="toolbar-spacer" />{canExport && <button className="secondary-button" type="button" onClick={exportCsv}>Export CSV</button>}</div>
      <div className="table-scroll responsive-card-scroll" role="region" aria-label="Audit Log table" tabIndex={0}><table className="data-table audit-table responsive-card-table"><thead><tr><th>Time · Kyiv</th><th>Actor</th><th>Action</th><th>Entity</th><th>Change detail</th><th>Event ID</th></tr></thead><tbody>{filtered.map((event) => <tr key={event.id}><td data-label="Time · Kyiv">{event.at}</td><td data-label="Actor"><b className="normal-weight">{event.actor}</b></td><td data-label="Action"><StatusBadge value={event.action} /></td><td data-label="Entity">{event.entity}</td><td className="audit-detail" data-label="Change detail">{event.detail}</td><td data-label="Event ID"><code>{event.id}</code></td></tr>)}{filtered.length === 0 && <tr className="table-empty-row"><td colSpan={6}>No audit events match the current filters.</td></tr>}</tbody></table></div>
      <footer className="table-footer"><span>Showing {filtered.length} events</span></footer>
    </section>
  );
}

function CompanyDetail({ company, contacts, tasks, onClose, openTask, openContact, updateCompany, canEdit, canMovePipeline, canAddContact, canAddTask, canArchive, showInternalIds, archive, statusOptions, companyTypeOptions, managerOptions, addContact, addTask }: {
  company: Company;
  contacts: Contact[];
  tasks: Task[];
  onClose: () => void;
  openTask: (task: Task) => void;
  openContact: (contact: Contact) => void;
  updateCompany: (company: Company) => boolean;
  canEdit: boolean;
  canMovePipeline: boolean;
  canAddContact: boolean;
  canAddTask: boolean;
  canArchive: boolean;
  showInternalIds: boolean;
  archive: () => void;
  statusOptions: string[];
  companyTypeOptions: string[];
  managerOptions: string[];
  addContact: () => void;
  addTask: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState(company.logoDataUrl ?? "");
  const [imageProcessing, setImageProcessing] = useState(false);

  function save(event: FormEvent<HTMLFormElement>) {
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
    const status = canMovePipeline ? String(data.get("status") ?? company.status) : company.status;
    if (name.length < 2) return void setFieldError(form, "name", "Enter at least 2 characters.");
    if (!country) return void setFieldError(form, "country", "Country is required.");
    if (websiteInput && !website) return void setFieldError(form, "website", "Enter a valid website address.");
    if (linkedinInput && !linkedin) return void setFieldError(form, "linkedin", "Enter a valid LinkedIn URL.");
    if (!updateCompany({
      ...company,
      name,
      kind: String(data.get("kind") ?? company.kind),
      country,
      city,
      status,
      owner: String(data.get("owner") ?? company.owner),
      website,
      linkedin,
      logoDataUrl: logoDataUrl || undefined,
      description: String(data.get("description") ?? company.description).trim(),
    })) return;
    setEditing(false);
  }

  return (
    <Modal title={company.name} eyebrow={showInternalIds ? `${company.id} · ${company.kind}` : company.kind} onClose={onClose} wide>
      {editing ? (
        <form className="entity-form detail-edit-form" onSubmit={save}>
          <ImageField label="Company logo" name="companyLogo" value={logoDataUrl} onChange={setLogoDataUrl} onProcessingChange={setImageProcessing} kind="company" />
          <label className="field field-full"><span>Company name</span><input name="name" defaultValue={company.name} required minLength={2} maxLength={120} autoFocus /></label>
          <label className="field"><span>Company type</span><select name="kind" defaultValue={company.kind}>{Array.from(new Set([...companyTypeOptions, company.kind])).map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <label className="field"><span>Relationship status</span>{canMovePipeline ? <select name="status" defaultValue={company.status}>{Array.from(new Set([...statusOptions, company.status])).map((status) => <option key={status}>{status}</option>)}</select> : <input value={company.status} readOnly aria-label="Relationship status" />}</label>
          <label className="field"><span>Country</span><input name="country" defaultValue={company.country} required maxLength={80} /></label>
          <label className="field"><span>City</span><input name="city" defaultValue={company.city} maxLength={80} /></label>
          <label className="field"><span>Website</span><input name="website" inputMode="url" defaultValue={company.website} maxLength={300} /></label>
          <label className="field"><span>LinkedIn</span><input name="linkedin" inputMode="url" defaultValue={company.linkedin ?? ""} maxLength={300} /></label>
          <label className="field"><span>CJN Manager</span><select name="owner" defaultValue={company.owner}>{Array.from(new Set([...managerOptions, company.owner])).map((owner) => <option key={owner}>{owner}</option>)}</select></label>
          <label className="field field-full"><span>Description</span><textarea name="description" defaultValue={company.description} rows={4} maxLength={2000} /></label>
          <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => { setLogoDataUrl(company.logoDataUrl ?? ""); setEditing(false); }}>Cancel</button><button className="primary-button" type="submit" disabled={imageProcessing}>{imageProcessing ? "Processing image…" : "Save changes"}</button></div>
        </form>
      ) : (
        <>
          <div className="company-detail-head"><EntityLogo name={company.name} src={company.logoDataUrl} className="detail-logo" /><div><StatusBadge value={company.status} /><p>{company.city}, {company.country}{company.website && <> · <a className="inline-data-link compact" href={websiteHref(company.website)} target="_blank" rel="noreferrer">{company.website}</a></>}</p></div>{canEdit && <button className="secondary-button" type="button" onClick={() => setEditing(true)}>Edit</button>}</div>
          <div className="detail-grid"><div><small>Owner</small><b>{company.owner}</b></div><div><small>Open tasks</small><b>{tasks.filter(isOpenTask).length}</b></div><div><small>Last contact</small><b>{company.lastContact}</b></div><div><small>Next activity</small><b>{nextActivityLabel(tasks)}</b></div></div>
          <div className="detail-description"><small>About company</small><p>{company.description}</p></div>
          <div className="detail-columns">
            <section><div className="detail-section-head"><h3>Contacts <CountBadge count={contacts.length} label="contacts" detail={`Contact people at ${company.name}.`} /></h3>{canAddContact && <button type="button" aria-label="Add contact" onClick={addContact}>＋</button>}</div>{contacts.map((contact) => <button className={`detail-contact${contact.status === "Inactive" ? " inactive-contact" : ""}`} type="button" key={contact.id} onClick={() => openContact(contact)}><Avatar name={contact.name} src={contact.photoDataUrl} className="person-avatar" lazy /><span><b>{contact.name}</b><small>{contact.position || "Position not specified"} · {contact.status}{contact.email ? ` · ${contact.email}` : ""}</small></span><span className="row-arrow">›</span></button>)}{contacts.length === 0 && <p className="muted-copy">No contacts yet.</p>}</section>
            <section><div className="detail-section-head"><h3>Activity <CountBadge count={tasks.length} label="tasks" detail={`All tasks linked to ${company.name}.`} /></h3>{canAddTask && <button type="button" aria-label="Add task" onClick={addTask}>＋</button>}</div>{tasks.slice(0, 4).map((task) => <button className="detail-task" type="button" key={task.id} onClick={() => openTask(task)}><span className={`priority-mark ${isOverdue(task) ? "overdue" : ""}`}>{task.status === "Completed" ? "✓" : "!"}</span><span><b>{task.title}</b><small>{formatDateTime(task.deadline)}</small></span><span>›</span></button>)}{tasks.length === 0 && <p className="muted-copy">No tasks yet.</p>}</section>
          </div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Close</button>{canArchive && <button className="danger-button" type="button" onClick={archive}>Archive company</button>}</div>
        </>
      )}
    </Modal>
  );
}

function ContactDetail({ contact, companies, onClose, updateContact, canEdit, canArchive, showInternalIds, archive, sourceOptions, managerOptions }: {
  contact: Contact;
  companies: Company[];
  onClose: () => void;
  updateContact: (contact: Contact) => boolean;
  canEdit: boolean;
  canArchive: boolean;
  showInternalIds: boolean;
  archive: () => void;
  sourceOptions: string[];
  managerOptions: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [sourceValue, setSourceValue] = useState(contact.source);
  const [photoDataUrl, setPhotoDataUrl] = useState(contact.photoDataUrl ?? "");
  const [imageProcessing, setImageProcessing] = useState(false);
  const company = companyName(companies, contact.companyId);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (imageProcessing) return;
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const companyId = String(data.get("companyId") ?? "");
    const name = String(data.get("name") ?? contact.name).trim();
    const email = String(data.get("email") ?? contact.email).trim().toLowerCase();
    const phone = String(data.get("phone") ?? contact.phone).trim();
    const linkedinInput = String(data.get("linkedin") ?? contact.linkedin ?? "").trim();
    const linkedin = normalizeUrl(linkedinInput);
    if (name.length < 2) return void setFieldError(form, "name", "Enter at least 2 characters.");
    if (email && !EMAIL_PATTERN.test(email)) return void setFieldError(form, "email", "Enter a valid email address.");
    if (phone && phone !== "—" && !/^[+()\d\s.-]{7,24}$/.test(phone)) return void setFieldError(form, "phone", "Enter a valid phone number.");
    if (linkedinInput && !linkedin) return void setFieldError(form, "linkedin", "Enter a valid LinkedIn URL.");
    if (!companies.some((item) => item.id === companyId)) return void setFieldError(form, "companyName", "Select an existing company.");
    if (!updateContact({
      ...contact,
      companyId,
      status: String(data.get("status") ?? contact.status) as ContactStatus,
      name,
      position: String(data.get("position") ?? contact.position).trim(),
      email,
      phone,
      linkedin,
      source: sourceValue,
      sourceDetail: ["Exhibition / Conference", "Other"].includes(sourceValue) ? String(data.get("sourceDetail") ?? "").trim() : "",
      referredBy: sourceValue === "Referral (word of mouth)" ? String(data.get("referredBy") ?? "").trim() : "",
      owner: String(data.get("owner") ?? contact.owner),
      photoDataUrl: photoDataUrl || undefined,
    })) return;
    setEditing(false);
  }

  return (
    <Modal title={contact.name} eyebrow={showInternalIds ? `${contact.id} · ${company}` : company} onClose={onClose}>
      {editing ? (
        <form className="entity-form detail-edit-form contact-entry-form" onSubmit={save}>
          <ImageField label="Contact photo" name="contactPhoto" value={photoDataUrl} onChange={setPhotoDataUrl} onProcessingChange={setImageProcessing} />
          <label className="field field-full"><span>Full name</span><input name="name" defaultValue={contact.name} required minLength={2} maxLength={120} autoFocus /></label>
          <CompanyPicker companies={companies} defaultCompanyId={contact.companyId} />
          <label className="field"><span>Contact status *</span><select name="status" defaultValue={contact.status} required>{CONTACT_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field"><span>Position</span><input name="position" defaultValue={contact.position} maxLength={120} /></label>
          <label className="field"><span>Phone</span><input name="phone" type="tel" defaultValue={contact.phone} maxLength={24} /></label>
          <label className="field"><span>Email</span><input name="email" type="email" defaultValue={contact.email} maxLength={254} /></label>
          <label className="field"><span>LinkedIn</span><input name="linkedin" inputMode="url" defaultValue={contact.linkedin ?? ""} maxLength={300} /></label>
          <label className="field"><span>Source</span><select name="source" value={sourceValue} onChange={(event) => setSourceValue(event.target.value)}><option value="">Not specified</option>{Array.from(new Set([...sourceOptions, contact.source].filter(Boolean))).map((source) => <option key={source}>{source}</option>)}</select></label>
          <label className="field"><span>CJN Manager</span><select name="owner" defaultValue={contact.owner}>{Array.from(new Set([...managerOptions, contact.owner])).map((owner) => <option key={owner}>{owner}</option>)}</select></label>
          {["Exhibition / Conference", "Other"].includes(sourceValue) && <label className="field field-full"><span>{sourceValue === "Other" ? "Source detail" : "Exhibition / event name"}</span><input name="sourceDetail" defaultValue={contact.sourceDetail ?? ""} maxLength={255} /></label>}
          {sourceValue === "Referral (word of mouth)" && <label className="field field-full"><span>Referred by</span><input name="referredBy" defaultValue={contact.referredBy ?? ""} maxLength={255} /></label>}
          <div className="reminder-note field-full"><span>i</span><p><b>Company and contact status</b><small>Change the company here only to correct an assignment mistake. If the person changed jobs, mark this contact Inactive and create a new contact at the new company.</small></p></div>
          <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => { setPhotoDataUrl(contact.photoDataUrl ?? ""); setEditing(false); }}>Cancel</button><button className="primary-button" type="submit" disabled={imageProcessing}>{imageProcessing ? "Processing image…" : "Save changes"}</button></div>
        </form>
      ) : (
        <>
          <div className="person-detail-head"><Avatar name={contact.name} src={contact.photoDataUrl} className="person-detail-avatar" /><div><StatusBadge value={contact.status} /><h3>{contact.position || "Position not specified"}</h3><p>{company}</p></div>{canEdit && <button className="secondary-button" type="button" onClick={() => setEditing(true)}>Edit</button>}</div>
          <div className="detail-grid contact-info-grid"><div><small>Status</small><b>{contact.status}</b></div><div><small>Email</small>{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : <b>—</b>}</div><div><small>Phone</small>{contact.phone && contact.phone !== "—" ? <a href={`tel:${contact.phone}`}>{contact.phone}</a> : <b>—</b>}</div><div><small>LinkedIn</small>{contact.linkedin ? <a href={websiteHref(contact.linkedin)} target="_blank" rel="noreferrer">Open profile</a> : <b>—</b>}</div><div><small>Source</small><b>{contact.source || "—"}</b></div><div><small>Source detail</small><b>{contact.sourceDetail || contact.referredBy || "—"}</b></div><div><small>CJN Manager</small><b>{contact.owner}</b></div><div><small>Initiated by</small><b>{contact.initiatedBy || "Not recorded"}</b></div></div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Close</button>{canArchive && <button className="danger-button" type="button" onClick={archive}>Archive contact</button>}{contact.email && contact.status === "Active" && <a className="primary-button action-link" href={`mailto:${contact.email}`}>Send email</a>}{contact.email && contact.status === "Inactive" && <button className="secondary-button" type="button" disabled title="This contact is inactive at the selected company">Contact inactive</button>}</div>
        </>
      )}
    </Modal>
  );
}

function UserDetail({ user, onClose, updateUser }: { user: CRMUser; onClose: () => void; updateUser: (user: CRMUser, temporaryPassword?: string) => boolean }) {
  const [role, setRole] = useState<Role>(user.role);
  const [state, setState] = useState<CRMUser["state"]>(user.state);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (updateUser({ ...user, role, state }, String(data.get("temporaryPassword") ?? ""))) onClose();
  }

  return (
    <Modal title={user.name} eyebrow="Team member" onClose={onClose}>
      <div className="person-detail-head"><Avatar name={user.name} src={user.photoDataUrl} className="person-detail-avatar" /><div><h3><a className="inline-data-link" href={`mailto:${user.email}`}>{user.email}</a></h3><p>Last sign-in: {user.lastLogin}</p></div></div>
      <form className="entity-form compact-form" onSubmit={save}>
        <label className="field"><span>Role</span><select name="role" value={role} onChange={(event) => setRole(event.target.value as Role)}><option>Admin</option><option>Manager</option><option>Editor</option><option>Read-only</option></select></label>
        <label className="field"><span>Status</span><select name="state" value={state} onChange={(event) => setState(event.target.value as CRMUser["state"])}><option>Active</option><option>Inactive</option><option>Pending</option></select></label>
        <label className="field field-full"><span>Reset password</span><input name="temporaryPassword" type="password" minLength={8} maxLength={128} placeholder="Optional new temporary password" autoComplete="new-password" /></label>
        <div className="reminder-note field-full"><span>i</span><p><b>{ROLE_DETAILS[role].summary}</b><small>{ROLE_DETAILS[role].permissions.join(" · ")}</small></p></div>
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Save access</button></div>
      </form>
    </Modal>
  );
}

function TaskDetail({ task, company, contacts, comments, events, onClose, canEdit, canComment, canArchive, archive, updateTask, updateStatus, addComment, taskStatusOptions, outcomeStatusOptions, reminderLeadOptions, managerOptions }: {
  task: Task;
  company: string;
  contacts: Contact[];
  comments: TaskComment[];
  events: AuditEvent[];
  onClose: () => void;
  canEdit: boolean;
  canComment: boolean;
  canArchive: boolean;
  archive: () => void;
  updateTask: (task: Task) => boolean;
  updateStatus: (task: Task, status: Task["status"]) => void;
  addComment: (taskId: string, text: string) => boolean;
  taskStatusOptions: string[];
  outcomeStatusOptions: string[];
  reminderLeadOptions: string[];
  managerOptions: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const contactDate = String(data.get("contactDate") ?? "");
    const deadline = String(data.get("deadline") ?? "");
    if (title.length < 3) return void setFieldError(form, "title", "Enter at least 3 characters.");
    if (!contactDate) return void setFieldError(form, "contactDate", "Choose the contact date.");
    if (!deadline) return void setFieldError(form, "deadline", "Choose a deadline.");
    const updated: Task = {
      ...task,
      title,
      contactDate,
      deadline,
      owner: String(data.get("owner") ?? task.owner),
      contactPersonId: String(data.get("contactPersonId") ?? ""),
      status: String(data.get("status") ?? task.status),
      note: String(data.get("note") ?? "").trim(),
      outcomeStatus: String(data.get("outcomeStatus") ?? ""),
      outcomeNotes: String(data.get("outcomeNotes") ?? "").trim(),
      reminderLeads: data.getAll("reminderLeads").map(String),
    };
    if (updateTask(updated)) setEditing(false);
  }

  function postComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addComment(task.id, commentDraft)) setCommentDraft("");
  }

  return (
    <Modal title={task.title} eyebrow={`${task.id} · ${company}`} onClose={onClose} wide>
      {editing ? (
        <form className="entity-form detail-edit-form" onSubmit={save}>
          <label className="field field-full"><span>Task title *</span><input name="title" defaultValue={task.title} required minLength={3} maxLength={255} autoFocus /></label>
          <label className="field"><span>Contact date *</span><input name="contactDate" type="date" defaultValue={task.contactDate ?? task.deadline.slice(0, 10)} required /></label>
          <label className="field"><span>Deadline · Europe/Kyiv *</span><input name="deadline" type="datetime-local" defaultValue={task.deadline} required /></label>
          <label className="field"><span>Responsible manager</span><select name="owner" defaultValue={task.owner}>{Array.from(new Set([...managerOptions, task.owner])).map((owner) => <option key={owner}>{owner}</option>)}</select></label>
          <label className="field"><span>Contact person</span><select name="contactPersonId" defaultValue={task.contactPersonId ?? ""}><option value="">Not specified</option>{contacts.filter((contact) => contact.status === "Active" || contact.id === task.contactPersonId).map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.status === "Inactive" ? " (Inactive)" : ""}</option>)}</select></label>
          <label className="field"><span>Status</span><select name="status" defaultValue={task.status}>{Array.from(new Set([...taskStatusOptions, task.status])).map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="field"><span>Outcome status</span><select name="outcomeStatus" defaultValue={task.outcomeStatus ?? ""}><option value="">Not specified</option>{outcomeStatusOptions.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="field field-full"><span>Description</span><textarea name="note" defaultValue={task.note} rows={4} maxLength={4000} /></label>
          <label className="field field-full"><span>Outcome notes</span><textarea name="outcomeNotes" defaultValue={task.outcomeNotes ?? ""} rows={3} maxLength={4000} /></label>
          <fieldset className="settings-list field-full"><legend>Reminder advance notice</legend>{reminderLeadOptions.map((lead) => <label key={lead}><input name="reminderLeads" type="checkbox" value={lead} defaultChecked={(task.reminderLeads ?? []).includes(lead)} /><span>{lead}</span></label>)}</fieldset>
          <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="primary-button" type="submit">Save task</button></div>
        </form>
      ) : (
        <>
          <div className="task-detail-status"><StatusBadge value={task.status} /><StatusBadge value={`${task.priority} priority`} />{isOverdue(task) && <StaticStatusBadge value="Overdue" />}{canEdit && <button className="secondary-button task-edit-button" type="button" onClick={() => setEditing(true)}>Edit task</button>}</div>
          <div className="detail-grid task-info-grid"><div><small>Contact date</small><b>{task.contactDate ?? task.deadline.slice(0, 10)}</b></div><div><small>Deadline · Europe/Kyiv</small><b className={isOverdue(task) ? "overdue-text" : ""}>{formatDateTime(task.deadline)}</b></div><div><small>Responsible manager</small><b>{task.owner}</b></div><div><small>Contact person</small><b>{contacts.find((contact) => contact.id === task.contactPersonId)?.name ?? "—"}{contacts.find((contact) => contact.id === task.contactPersonId)?.status === "Inactive" ? " (Inactive)" : ""}</b></div><div><small>Outcome</small><b>{task.outcomeStatus || "—"}</b></div><div><small>Calendar</small><button className="detail-action-button" type="button" onClick={() => downloadTaskIcs(task, company)}>Download .ics</button></div></div>
          <div className="detail-description"><small>Description</small><p>{task.note || "No description."}</p>{task.outcomeNotes && <><small>Outcome notes</small><p>{task.outcomeNotes}</p></>}</div>
          <section className="comment-stream"><div className="detail-section-head"><h3>Comments <StaticStatusBadge value={String(comments.length)} /></h3></div>{comments.map((comment) => <article key={comment.id}><span className="timeline-avatar blue">{comment.author.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><p><b>{comment.author}</b><small>{comment.createdAt} · Kyiv</small><span>{comment.text}</span></p></article>)}{comments.length === 0 && <div className="empty-state compact"><b>No comments yet</b><span>The task discussion will appear here.</span></div>}{canComment && <form className="comment-form" onSubmit={postComment}><label><span>Add a comment</span><textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} required maxLength={2000} rows={3} placeholder="Write a clear update for the team" /></label><button className="primary-button" type="submit">Post comment</button></form>}</section>
          <section className="change-log"><div className="detail-section-head"><h3>Change log</h3><small>{events.length} events</small></div>{events.slice(0, 8).map((event) => <article key={event.id}><span>{event.action}</span><p><b>{event.detail}</b><small>{event.actor} · {event.at} · Kyiv</small></p></article>)}{events.length === 0 && <p className="muted-copy">No changes recorded in this page session.</p>}</section>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Close</button><button className="secondary-button" type="button" onClick={() => downloadTaskIcs(task, company)}>↓ Add to calendar</button>{canArchive && <button className="danger-button" type="button" onClick={archive}>Archive task</button>}{canEdit && task.status !== "Completed" && task.status !== "Started" && taskStatusOptions.includes("Started") && <button className="secondary-button" type="button" onClick={() => updateStatus(task, "Started")}>Start task</button>}{canEdit && task.status === "Started" && taskStatusOptions.includes("Deferred") && <button className="secondary-button" type="button" onClick={() => updateStatus(task, "Deferred")}>Defer</button>}{canEdit && task.status !== "Completed" && taskStatusOptions.includes("Completed") && <button className="primary-button" type="button" onClick={() => updateStatus(task, "Completed")}>✓ Mark as completed</button>}</div>
        </>
      )}
    </Modal>
  );
}

function CompanyForm({ statusOptions, companyTypeOptions, managerOptions, onClose, onSubmit }: { statusOptions: string[]; companyTypeOptions: string[]; managerOptions: string[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>, logoDataUrl: string) => void }) {
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [imageProcessing, setImageProcessing] = useState(false);
  return (
    <Modal title="New company" eyebrow="Companies" onClose={onClose}>
      <form onSubmit={(event) => { if (imageProcessing) event.preventDefault(); else onSubmit(event, logoDataUrl); }} className="entity-form">
        <ImageField label="Company logo" name="companyLogo" value={logoDataUrl} onChange={setLogoDataUrl} onProcessingChange={setImageProcessing} kind="company" />
        <label className="field field-full"><span>Company name *</span><input name="name" required minLength={2} maxLength={255} autoFocus placeholder="For example, Baltic Engineering" /></label>
        <label className="field"><span>Company type *</span><select name="kind" required>{companyTypeOptions.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label className="field"><span>Relationship status *</span><select name="status" required>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label className="field"><span>Country *</span><input name="country" required maxLength={100} placeholder="Ukraine" /></label>
        <label className="field"><span>City</span><input name="city" maxLength={100} placeholder="Kyiv" /></label>
        <label className="field"><span>Website</span><input name="website" inputMode="url" maxLength={255} placeholder="example.com" /></label>
        <label className="field"><span>LinkedIn</span><input name="linkedin" inputMode="url" maxLength={255} placeholder="linkedin.com/company/..." /></label>
        <label className="field"><span>CJN Manager</span><select name="owner" required>{managerOptions.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
        <label className="field field-full"><span>Description</span><textarea name="description" rows={4} maxLength={4000} placeholder="Directions, projects, and cooperation context" /></label>
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={imageProcessing}>{imageProcessing ? "Processing image…" : "Create company"}</button></div>
      </form>
    </Modal>
  );
}

function ContactForm({ companies, sourceOptions, initiatorOptions, initialCompanyId, currentUserEmail, onClose, onSubmit }: { companies: Company[]; sourceOptions: string[]; initiatorOptions: CRMUser[]; initialCompanyId?: string; currentUserEmail: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>, photoDataUrl: string) => void }) {
  const [source, setSource] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [imageProcessing, setImageProcessing] = useState(false);
  const normalizedCurrentUserEmail = currentUserEmail.toLowerCase();
  const defaultInitiator = initiatorOptions.some((user) => user.email.toLowerCase() === normalizedCurrentUserEmail) ? normalizedCurrentUserEmail : "manual";
  const [initiatorChoice, setInitiatorChoice] = useState(defaultInitiator);
  return (
    <Modal title="Add contact manually" eyebrow="Contacts" onClose={onClose}>
      <form onSubmit={(event) => { if (imageProcessing) event.preventDefault(); else onSubmit(event, photoDataUrl); }} className="entity-form contact-entry-form">
        <ImageField label="Contact photo" name="contactPhoto" value={photoDataUrl} onChange={setPhotoDataUrl} onProcessingChange={setImageProcessing} />
        <CompanyPicker companies={companies} defaultCompanyId={initialCompanyId} autoFocus={!initialCompanyId} />
        <label className="field"><span>Contact status *</span><select name="status" required defaultValue="Active">{CONTACT_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>First name *</span><input name="firstName" required minLength={2} maxLength={100} autoFocus={Boolean(initialCompanyId)} /></label>
        <label className="field"><span>Last name</span><input name="lastName" maxLength={100} /></label>
        <label className="field"><span>Position</span><input name="position" maxLength={150} placeholder="External Relations Director" /></label>
        <label className="field"><span>Phone</span><input name="phone" type="tel" maxLength={50} placeholder="+380…" /></label>
        <label className="field"><span>Email</span><input name="email" type="email" maxLength={255} placeholder="name@company.com" /></label>
        <label className="field"><span>LinkedIn</span><input name="linkedin" inputMode="url" maxLength={255} placeholder="linkedin.com/in/..." /></label>
        <label className="field"><span>First contact source</span><select name="source" value={source} onChange={(event) => setSource(event.target.value)}><option value="">Not specified</option>{sourceOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>Initiated by *</span><select name="initiatedByUserEmail" required value={initiatorChoice} onChange={(event) => setInitiatorChoice(event.target.value)} aria-describedby="contact-initiator-help">{initiatorOptions.map((user) => <option key={user.email} value={user.email.toLowerCase()}>{user.name}</option>)}<option value="manual">Enter a name manually</option></select></label>
        {initiatorChoice === "manual" && <label className="field"><span>Initiator name *</span><input name="initiatedBy" required minLength={2} maxLength={120} autoComplete="name" placeholder="Enter the initiator's name" /></label>}
        {["Exhibition / Conference", "Other"].includes(source) && <label className="field field-full"><span>{source === "Other" ? "Source detail" : "Exhibition / event name"}</span><input name="sourceDetail" maxLength={255} /></label>}
        {source === "Referral (word of mouth)" && <label className="field field-full"><span>Referred by</span><input name="referredBy" maxLength={255} /></label>}
        <div className="reminder-note field-full" id="contact-initiator-help"><span>i</span><p><b>Record attribution</b><small>Select an active CRM user or enter a name manually. Manual names are stored as text and do not receive in-app notifications.</small></p></div>
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={imageProcessing}>{imageProcessing ? "Processing image…" : "Create contact"}</button></div>
      </form>
    </Modal>
  );
}

function TaskForm({ companies, contacts, taskStatusOptions, outcomeStatusOptions, reminderLeadOptions, managerOptions, initiatorOptions, currentUserEmail, initialCompanyId, canAddContact, onAddContact, onClose, onSubmit }: { companies: Company[]; contacts: Contact[]; taskStatusOptions: string[]; outcomeStatusOptions: string[]; reminderLeadOptions: string[]; managerOptions: string[]; initiatorOptions: CRMUser[]; currentUserEmail: string; initialCompanyId?: string; canAddContact: boolean; onAddContact: (draft: ContactDraft) => ContactCreationResult; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [companyId, setCompanyId] = useState(initialCompanyId ?? companies[0]?.id ?? "");
  const [contactPersonId, setContactPersonId] = useState("");
  const [quickContactOpen, setQuickContactOpen] = useState(false);
  const [quickContact, setQuickContact] = useState({ firstName: "", lastName: "", position: "", email: "", phone: "" });
  const [quickPhoto, setQuickPhoto] = useState("");
  const [quickPhotoProcessing, setQuickPhotoProcessing] = useState(false);
  const [quickError, setQuickError] = useState("");
  const normalizedCurrentUserEmail = currentUserEmail.toLowerCase();
  const defaultQuickInitiator = initiatorOptions.some((user) => user.email.toLowerCase() === normalizedCurrentUserEmail) ? normalizedCurrentUserEmail : "manual";
  const [quickInitiatorChoice, setQuickInitiatorChoice] = useState(defaultQuickInitiator);
  const [quickInitiatorName, setQuickInitiatorName] = useState("");
  const companyContacts = contacts.filter((contact) => contact.companyId === companyId && contact.status === "Active");

  function resetQuickContact() {
    setQuickContact({ firstName: "", lastName: "", position: "", email: "", phone: "" });
    setQuickPhoto("");
    setQuickPhotoProcessing(false);
    setQuickError("");
    setQuickInitiatorChoice(defaultQuickInitiator);
    setQuickInitiatorName("");
    setQuickContactOpen(false);
  }

  function saveQuickContact() {
    if (quickPhotoProcessing) return void setQuickError("Wait until the photo finishes processing.");
    const result = onAddContact({
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
    <Modal title="New task" eyebrow="Activity" onClose={onClose}>
      <form onSubmit={(event) => { if (quickContactOpen) { event.preventDefault(); setQuickError("Save or cancel the quick contact before creating the task."); } else onSubmit(event); }} className="entity-form">
        <label className="field field-full"><span>Task title *</span><input name="title" required minLength={3} maxLength={255} autoFocus placeholder="What needs to be done?" /></label>
        <label className="field"><span>Company *</span><select name="companyId" required value={companyId} onChange={(event) => { setCompanyId(event.target.value); setContactPersonId(""); resetQuickContact(); }}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <div className="contact-field-with-action">
          <label className="field"><span>Contact person</span><select name="contactPersonId" value={contactPersonId} onChange={(event) => setContactPersonId(event.target.value)}><option value="">Not specified</option>{companyContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>
          {canAddContact && <button className="secondary-button" type="button" aria-expanded={quickContactOpen} aria-controls="quick-contact-panel" onClick={() => { setQuickContactOpen((open) => !open); setQuickError(""); }}>＋ Add contact</button>}
        </div>
        {quickContactOpen && <section className="quick-contact-panel field-full" id="quick-contact-panel" aria-label="Add a contact to this task">
          <div className="quick-contact-head"><div><b>Add contact without leaving this task</b><small>The new contact will be linked to {companyName(companies, companyId)} and selected above.</small></div><button className="icon-button" type="button" aria-label="Close quick contact form" onClick={resetQuickContact}>×</button></div>
          <div className="quick-contact-grid">
            <label><span>First name *</span><input value={quickContact.firstName} onChange={(event) => setQuickContact((current) => ({ ...current, firstName: event.target.value }))} required minLength={2} maxLength={100} /></label>
            <label><span>Last name</span><input value={quickContact.lastName} onChange={(event) => setQuickContact((current) => ({ ...current, lastName: event.target.value }))} maxLength={100} /></label>
            <label><span>Position</span><input value={quickContact.position} onChange={(event) => setQuickContact((current) => ({ ...current, position: event.target.value }))} maxLength={150} /></label>
            <label><span>Email</span><input type="email" value={quickContact.email} onChange={(event) => setQuickContact((current) => ({ ...current, email: event.target.value }))} maxLength={255} /></label>
            <label><span>Phone</span><input type="tel" value={quickContact.phone} onChange={(event) => setQuickContact((current) => ({ ...current, phone: event.target.value }))} maxLength={50} /></label>
            <label><span>Initiated by *</span><select value={quickInitiatorChoice} onChange={(event) => { setQuickInitiatorChoice(event.target.value); setQuickError(""); }}>{initiatorOptions.map((user) => <option key={user.email} value={user.email.toLowerCase()}>{user.name}</option>)}<option value="manual">Enter a name manually</option></select></label>
            {quickInitiatorChoice === "manual" && <label><span>Initiator name *</span><input value={quickInitiatorName} onChange={(event) => setQuickInitiatorName(event.target.value)} required minLength={2} maxLength={120} placeholder="Enter the initiator's name" /></label>}
          </div>
          <ImageField label="Contact photo" name="quickContactPhoto" value={quickPhoto} onChange={setQuickPhoto} onProcessingChange={setQuickPhotoProcessing} />
          {quickError && <div className="form-error" role="alert">{quickError}</div>}
          <div className="quick-contact-actions"><button className="secondary-button" type="button" onClick={resetQuickContact}>Cancel</button><button className="primary-button" type="button" disabled={quickPhotoProcessing} onClick={saveQuickContact}>{quickPhotoProcessing ? "Processing image…" : "Save contact"}</button></div>
        </section>}
        <label className="field"><span>Contact date *</span><input name="contactDate" type="date" required defaultValue={todayKyiv()} /></label>
        <label className="field"><span>Deadline · Europe/Kyiv *</span><input name="deadline" type="datetime-local" required /></label>
        <label className="field"><span>Responsible manager *</span><select name="owner" required>{managerOptions.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
        <label className="field"><span>Status *</span><select name="status" defaultValue="Not Started">{taskStatusOptions.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label className="field"><span>Priority</span><select name="priority"><option>Normal</option><option>Medium</option><option>High</option></select></label>
        <label className="field"><span>Outcome status</span><select name="outcomeStatus"><option value="">Not specified</option>{outcomeStatusOptions.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label className="field field-full"><span>Description</span><textarea name="note" rows={4} maxLength={4000} placeholder="Context, expected result, and links" /></label>
        <label className="field field-full"><span>Outcome notes</span><textarea name="outcomeNotes" rows={3} maxLength={4000} /></label>
        <fieldset className="settings-list field-full"><legend>Reminder advance notice</legend>{reminderLeadOptions.map((lead) => <label key={lead}><input name="reminderLeads" type="checkbox" value={lead} /><span>{lead}</span></label>)}</fieldset>
        <div className="reminder-note field-full"><span>◷</span><p><b>Calendar file available</b><small>The frontend can generate an .ics file. Email delivery requires the production backend, scheduler, and an active User linked to the selected CJN Manager.</small></p></div>
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={quickContactOpen}>Create task</button></div>
      </form>
    </Modal>
  );
}

function UserForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <Modal title="New user" eyebrow="Team access" onClose={onClose}>
      <form className="entity-form" onSubmit={onSubmit}>
        <label className="field field-full"><span>Full name *</span><input name="name" required minLength={2} maxLength={120} autoFocus placeholder="First and last name" /></label>
        <label className="field field-full"><span>Work email *</span><input name="email" type="email" required maxLength={254} placeholder="name@company.com" /></label>
        <label className="field field-full"><span>Role</span><select name="role" defaultValue="Editor"><option>Editor</option><option>Manager</option><option>Read-only</option><option>Admin</option></select></label>
        <div className="role-hint-list field-full">{ROLE_ORDER.map((role) => <div key={role}><StaticStatusBadge value={role} /><span><b>{ROLE_DETAILS[role].summary}</b><small>{ROLE_DETAILS[role].permissions.join(" · ")}</small></span></div>)}</div>
        <label className="field field-full"><span>Temporary password *</span><input name="temporaryPassword" type="password" required minLength={8} maxLength={128} defaultValue={TEST_PASSWORD} autoComplete="new-password" /></label>
        <div className="reminder-note field-full"><span>＋</span><p><b>Manual account setup</b><small>The active user can sign in immediately with this temporary password. Production should require a password change on first sign-in.</small></p></div>
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Add user</button></div>
      </form>
    </Modal>
  );
}

function ProfileModal({ identity, onClose, onSave }: { identity: AuthIdentity; onClose: () => void; onSave: (identity: AuthIdentity, currentPassword: string, newPassword: string) => string | null }) {
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
    if (saveError) setError(saveError);
  }

  return (
    <Modal title="My profile" eyebrow="Personal details" onClose={onClose}>
      <form className="entity-form" onSubmit={submit}>
        <ImageField label="Profile photo" name="profilePhoto" value={photoDataUrl} onChange={setPhotoDataUrl} onProcessingChange={setImageProcessing} />
        <label className="field field-full"><span>Full name</span><input name="name" defaultValue={identity.name} required minLength={2} maxLength={120} autoFocus /></label>
        <label className="field field-full"><span>Work email</span><input name="email" type="email" defaultValue={identity.email} required maxLength={254} /></label>
        <label className="field field-full"><span>Phone</span><input name="phone" type="tel" maxLength={24} defaultValue={identity.phone ?? ""} /></label>
        <div className="form-divider field-full"><span>Password and login confirmation</span></div>
        <label className="field field-full"><span>Current password</span><input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} placeholder="Required for email or password changes" /></label>
        <label className="field"><span>New password</span><input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} placeholder="Leave blank to keep current" /></label>
        <label className="field"><span>Confirm new password</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} /></label>
        {error && <div className="form-error field-full" role="alert">{error}</div>}
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={imageProcessing}>{imageProcessing ? "Processing image…" : "Save profile"}</button></div>
      </form>
    </Modal>
  );
}

function SettingsModal({ preferences, onClose, onSave }: { preferences: Preferences; onClose: () => void; onSave: (preferences: Preferences) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave({
      deadlineReminders: data.get("deadlineReminders") === "on",
      overdueNotifications: data.get("overdueNotifications") === "on",
      workspaceSummary: data.get("workspaceSummary") === "on",
    });
  }

  return (
    <Modal title="Settings" eyebrow="Workspace preferences" onClose={onClose}>
      <form className="entity-form" onSubmit={submit}>
        <label className="field"><span>Interface language</span><input value="English" readOnly /></label>
        <label className="field"><span>Timezone</span><input value="Europe/Kyiv" readOnly /></label>
        <fieldset className="settings-list field-full"><legend>Notifications</legend><label><input name="deadlineReminders" type="checkbox" defaultChecked={preferences.deadlineReminders} /> <span>My upcoming deadlines</span></label><label><input name="overdueNotifications" type="checkbox" defaultChecked={preferences.overdueNotifications} /> <span>My overdue tasks</span></label><label><input name="workspaceSummary" type="checkbox" defaultChecked={preferences.workspaceSummary} /> <span>My activity summary</span></label></fieldset>
        <div className="modal-actions field-full"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Save settings</button></div>
      </form>
    </Modal>
  );
}
