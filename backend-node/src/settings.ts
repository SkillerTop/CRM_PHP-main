import { ApiError, db, first, now, rows } from "./core.js";
import { requireRole, type Identity } from "./auth.js";
import { logAudit } from "./audit.js";

async function setting(
  key: string,
  fallback: string | null = null,
): Promise<string | null> {
  const row = await first(
    "SELECT setting_value FROM settings WHERE setting_key = ?",
    [key],
  );
  return row ? String(row.setting_value ?? "") : fallback;
}

function truth(value: string | null, fallback: boolean): boolean {
  if (value === null || value === "") return fallback;
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

export async function settingsPayload(): Promise<Record<string, unknown>> {
  let email = (
    (await setting(
      "system_notification_email",
      process.env.SYSTEM_NOTIFICATION_EMAIL ?? "",
    )) ?? ""
  ).trim();
  if (!email)
    email = String(
      (
        await first(
          "SELECT email FROM users WHERE role='admin' AND is_active=1 AND pending_approval=0 ORDER BY id LIMIT 1",
        )
      )?.email ?? "",
    );
  const notify = truth(
    await setting("notify_new_registrations"),
    truth(process.env.NOTIFY_NEW_REGISTRATIONS ?? null, true),
  );
  let domains = (
    await rows(
      "SELECT domain FROM registration_domains WHERE is_active=1 ORDER BY domain",
    )
  ).map((x) => String(x.domain).toLowerCase());
  if (
    !domains.length &&
    !truth(await setting("registration_domains_managed"), false)
  )
    domains = (process.env.REGISTRATION_ALLOWED_DOMAINS ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  return {
    system_notification_email: email,
    notify_new_registrations: notify,
    registration_allowed_domains: domains,
  };
}

export async function getSettings(
  identity: Identity,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin");
  return settingsPayload();
}

export async function putSettings(
  identity: Identity,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requireRole(identity, "admin");
  const email =
    input.system_notification_email == null
      ? ""
      : String(input.system_notification_email).trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ApiError(400, "validation_error", "Проверьте заполнение полей.", {
      fields: { system_notification_email: "Некорректный email." },
    });
  const notify =
    input.notify_new_registrations === undefined
      ? true
      : truth(String(input.notify_new_registrations), false);
  const requestedDomains = input.registration_allowed_domains ?? [];
  if (!Array.isArray(requestedDomains))
    throw new ApiError(
      400,
      "validation_error",
      "registration_allowed_domains должен быть массивом.",
    );
  const domains = [
    ...new Set(requestedDomains.map((x) => String(x).trim().toLowerCase())),
  ].sort();
  for (const domain of domains)
    if (
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
        domain,
      )
    )
      throw new ApiError(
        400,
        "validation_error",
        "Некорректный домен регистрации.",
        { fields: { registration_allowed_domains: domain } },
      );
  const before = await settingsPayload();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const [key, value] of Object.entries({
      system_notification_email: email,
      notify_new_registrations: notify ? "true" : "false",
      registration_domains_managed: "true",
    }))
      await conn.execute(
        `INSERT INTO settings (setting_key,setting_value,updated_by,updated_at) VALUES (?,?,?,?)
        ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)`,
        [key, value, identity.user.id, now()],
      );
    await conn.execute("UPDATE registration_domains SET is_active = 0");
    for (const domain of domains)
      await conn.execute(
        `INSERT INTO registration_domains
      (domain,is_active,created_by,updated_by,created_at,updated_at) VALUES (?,1,?,?,?,?)
      ON DUPLICATE KEY UPDATE is_active=1,updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)`,
        [domain, identity.user.id, identity.user.id, now(), now()],
      );
    const fallbackEmail = email
      ? email
      : String(
          (
            await first(
              "SELECT email FROM users WHERE role='admin' AND is_active=1 AND pending_approval=0 ORDER BY id LIMIT 1",
            )
          )?.email ?? "",
        );
    const after: Record<string, unknown> = {
      system_notification_email: fallbackEmail,
      notify_new_registrations: notify,
      registration_allowed_domains: domains,
    };
    for (const [field, label] of Object.entries({
      system_notification_email: "System notification email",
      notify_new_registrations: "Notify new registrations",
      registration_allowed_domains: "Registration allowed domains",
    })) {
      const oldValue = String(before[field] ?? ""),
        newValue = String(after[field] ?? "");
      if (oldValue !== newValue)
        await logAudit(conn, identity, {
          action: "FIELD CHANGE",
          entityType: "Setting",
          entityId: null,
          entityLabel: "Registration settings",
          field: label,
          from: oldValue || "—",
          to: newValue || "—",
        });
    }
    await conn.commit();
    return await settingsPayload();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
