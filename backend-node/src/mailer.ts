import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import nodemailer from "nodemailer";
import { backendRoot } from "./paths.js";

export type Attachment = {
  filename: string;
  content: Buffer | string;
  contentType: string;
};

export async function sendMail(
  to: string,
  subject: string,
  text: string,
  attachments: Attachment[] = [],
): Promise<void> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
    throw new Error("Invalid recipient email.");
  const transport = (process.env.MAIL_TRANSPORT ?? "log").toLowerCase();
  const from = {
    name: process.env.MAIL_FROM_NAME ?? "Client Data CRM",
    address: process.env.MAIL_FROM_ADDRESS ?? "crm@example.com",
  };
  const message = { from, to, subject, text, attachments };
  if (transport === "log") {
    const path = join(backendRoot, "storage", "logs", "mail.log");
    await mkdir(dirname(path), { recursive: true });
    const digest = createHash("sha256")
      .update(JSON.stringify({ to, subject, text }))
      .digest("hex");
    await appendFile(
      path,
      `\n==== ${new Date().toISOString()} ====\nMail delivery suppressed in log transport; digest=${digest}\n`,
    );
    throw new Error("Mail delivery is suppressed by MAIL_TRANSPORT=log.");
  }
  if (transport === "smtp") {
    const encryption = (process.env.SMTP_ENCRYPTION ?? "tls").toLowerCase();
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "",
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: encryption === "ssl",
      requireTLS: encryption === "tls",
      auth: process.env.SMTP_USERNAME
        ? {
            user: process.env.SMTP_USERNAME,
            pass: process.env.SMTP_PASSWORD ?? "",
          }
        : undefined,
      connectionTimeout: 15000,
    });
    await transporter.sendMail(message);
    return;
  }
  if (transport === "mail") {
    await nodemailer.createTransport({ sendmail: true }).sendMail(message);
    return;
  }
  throw new Error("Unsupported MAIL_TRANSPORT value.");
}
