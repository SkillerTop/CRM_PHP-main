import { db, first, now, rows, utc } from "./core.js";
import { type Identity } from "./auth.js";
import { allLookups } from "./lookups.js";
import { mapAudit } from "./audit.js";

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
}

export async function ensureManagerForUser(
  identity: Identity,
): Promise<{ id: number; value: string } | null> {
  return ensureManagerForId(identity.user.id);
}

export async function ensureManagerForId(
  id: number,
): Promise<{ id: number; value: string } | null> {
  const linked = await rows(
    "SELECT id,value,is_active FROM lookups WHERE type='cjn_manager' AND user_id=? ORDER BY id",
    [id],
  );
  if (linked.length)
    return linked.length === 1 && linked[0]?.is_active
      ? { id: Number(linked[0].id), value: String(linked[0].value) }
      : null;
  const current = await first(
    "SELECT id,full_name FROM users WHERE id=? AND is_active=1 AND pending_approval=0 LIMIT 1",
    [id],
  );
  if (!current) return null;
  const name = normalizeName(String(current.full_name));
  if (!name) return null;
  const users = await rows(
    "SELECT id,full_name FROM users WHERE is_active=1 AND pending_approval=0",
  );
  if (
    users.filter((user) => normalizeName(String(user.full_name)) === name)
      .length !== 1
  )
    return null;
  const managers = await rows(
    "SELECT id,value,user_id FROM lookups WHERE type='cjn_manager' AND is_active=1 ORDER BY id",
  );
  const matches = managers.filter(
    (manager) => normalizeName(String(manager.value)) === name,
  );
  const manager = matches[0];
  if (matches.length !== 1 || !manager || manager.user_id !== null) return null;
  const [result] = await db.execute(
    `UPDATE lookups SET user_id=?,updated_by=?,updated_at=?
    WHERE id=? AND type='cjn_manager' AND user_id IS NULL`,
    [id, id, now(), manager.id],
  );
  return "affectedRows" in result && result.affectedRows === 1
    ? { id: Number(manager.id), value: String(manager.value) }
    : null;
}

export async function appBootstrap(
  identity: Identity,
): Promise<Record<string, unknown>> {
  const admin = identity.user.role === "admin";
  const canWrite = ["admin", "manager", "editor"].includes(identity.user.role);
  const currentManager = await ensureManagerForUser(identity);
  const lookups = await allLookups(
    new URL(
      admin
        ? "http://localhost/api/lookups?include_inactive=1"
        : "http://localhost/api/lookups",
    ),
    identity,
  );
  const countries = (
    await rows("SELECT name FROM countries ORDER BY sort_order,name")
  ).map((row) => String(row.name));
  let users: Record<string, unknown>[] = [];
  if (admin) {
    users = (
      await rows(`SELECT id,full_name,email,role,is_active,pending_approval,last_login_at,updated_at,
      (photo_data_url IS NOT NULL) AS has_photo FROM users ORDER BY pending_approval DESC,is_active DESC,full_name`)
    ).map((row) => ({
      id: Number(row.id),
      full_name: row.full_name,
      email: row.email,
      role: row.role,
      is_active: Boolean(row.is_active),
      pending_approval: Boolean(row.pending_approval),
      last_login_at: utc(row.last_login_at),
      updated_at: utc(row.updated_at),
      photo_data_url: row.has_photo ? `/api/users/${row.id}/photo` : null,
    }));
  } else if (canWrite) {
    users = (
      await rows(`SELECT m.user_id,m.value,m.updated_at,
      CASE WHEN m.user_id IS NOT NULL AND u.is_active=1 AND u.pending_approval=0 THEN u.email
        WHEN m.user_id IS NULL THEN m.email ELSE NULL END AS delivery_email
      FROM lookups m LEFT JOIN users u ON u.id=m.user_id
      WHERE m.type='cjn_manager' AND m.is_active=1 ORDER BY m.sort_order,m.id`)
    )
      .filter((row) => row.delivery_email)
      .map((row) => ({
        id: row.user_id,
        full_name: row.value,
        email: row.delivery_email,
        role: "editor",
        is_active: true,
        pending_approval: false,
        last_login_at: null,
        updated_at: utc(row.updated_at),
      }));
  }
  const audit = admin
    ? (
        await rows(
          "SELECT * FROM change_events ORDER BY created_at DESC,id DESC LIMIT 500",
        )
      ).map((row) => {
        const { detail: _, ...event } = mapAudit(row);
        return event;
      })
    : [];
  return {
    identity: identity.user,
    current_manager: currentManager,
    csrf_token: identity.csrf,
    companies: [],
    contacts: [],
    tasks: [],
    comments: [],
    attachments: [],
    lookups,
    countries,
    users,
    audit,
  };
}
