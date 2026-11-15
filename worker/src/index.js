import PostalMime from "postal-mime";
import { bearer, constantTimeEqual, errorResponse, json, randomId, readJson, safeDomainList, sha256, validEmail } from "./security.js";

const MAX_RAW_BYTES = 20 * 1024 * 1024;
const MAX_BODY_BYTES = 64 * 1024;

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { "access-control-allow-origin": origin, "vary": "Origin", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS" };
}

async function admin(request, env) {
  const token = bearer(request);
  return Boolean(env.ADMIN_API_KEY && token && constantTimeEqual(token, env.ADMIN_API_KEY));
}

async function mailboxAuth(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const hash = await sha256(token);
  return env.DB.prepare("SELECT id,email,label FROM mailboxes WHERE api_key_hash=? AND enabled=1").bind(hash).first();
}

async function storeMessage(env, message) {
  const id = message.id || randomId();
  await env.DB.prepare(`INSERT INTO messages
    (id,mailbox_id,direction,sender,recipients,subject,text_body,html_body,message_id,size_bytes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, message.mailboxId, message.direction, message.sender || "",
      JSON.stringify(message.recipients || []), message.subject || "",
      message.text || "", message.html || "", message.messageId || null,
      message.sizeBytes || 0).run();
  return id;
}

async function handleInbound(message, env) {
  if (!env.DB) throw new Error("D1 binding DB is missing");
  const raw = await new Response(message.raw).arrayBuffer();
  if (raw.byteLength > MAX_RAW_BYTES) {
    message.setReject("Message too large");
    return;
  }
  const recipient = String(message.to || "").trim().toLowerCase();
  const domains = safeDomainList(env.MAIL_DOMAINS);
  const domain = recipient.split("@")[1] || "";
  if (!validEmail(recipient) || (domains.length && !domains.includes(domain))) {
    message.setReject("Recipient domain not configured");
    return;
  }
  const mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE email=? COLLATE NOCASE AND enabled=1").bind(recipient).first();
  if (!mailbox) {
    message.setReject("Mailbox not found");
    return;
  }
  const parsed = await PostalMime.parse(raw);
  const recipients = (parsed.to || []).map(x => x.address).filter(Boolean);
  const id = randomId();
  let objectKey = null;
  if (env.MAIL_FILES) {
    objectKey = `raw/${mailbox.id}/${id}.eml`;
    await env.MAIL_FILES.put(objectKey, raw, { httpMetadata: { contentType: "message/rfc822" } });
  }
  await storeMessage(env, {
    id, mailboxId: mailbox.id, direction: "inbound",
    sender: parsed.from?.address || message.from || "",
    recipients: recipients.length ? recipients : [recipient],
    subject: parsed.subject || "(no subject)",
    text: parsed.text || "", html: typeof parsed.html === "string" ? parsed.html : "",
    messageId: parsed.messageId || "", sizeBytes: raw.byteLength
  });
  if (objectKey) await env.DB.prepare("UPDATE messages SET raw_object_key=? WHERE id=?").bind(objectKey, id).run();

  for (const attachment of (parsed.attachments || [])) {
    const attachmentId = randomId();
    const filename = String(attachment.filename || "attachment").replace(/[\\/\\r\\n"]/g, "_").slice(0, 180);
    const bytes = attachment.content instanceof ArrayBuffer
      ? attachment.content
      : attachment.content?.buffer
        ? attachment.content.buffer.slice(attachment.content.byteOffset, attachment.content.byteOffset + attachment.content.byteLength)
        : null;
    let key = null;
    if (env.MAIL_FILES && bytes) {
      key = `attachments/${mailbox.id}/${id}/${attachmentId}`;
      await env.MAIL_FILES.put(key, bytes, { httpMetadata: { contentType: attachment.mimeType || "application/octet-stream" } });
    }
    await env.DB.prepare("INSERT INTO attachments(id,message_id,mailbox_id,filename,content_type,size_bytes,object_key,content_id) VALUES(?,?,?,?,?,?,?,?)")
      .bind(attachmentId, id, mailbox.id, filename, attachment.mimeType || "application/octet-stream",
        attachment.content?.byteLength || attachment.content?.length || 0, key, attachment.contentId || null).run();
  }
}

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/v1/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (path === "/health" && request.method === "GET") return json({ ok: true, service: "cloud-mail", version: "2.0.0" });

  if (path.startsWith("/admin/")) {
    if (!(await admin(request, env))) return errorResponse("Unauthorized", 401);
    if (!env.DB) return errorResponse("D1 binding DB is missing", 503);

    if (path === "/admin/mailboxes" && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT id,email,label,enabled,created_at FROM mailboxes ORDER BY created_at DESC LIMIT 500").all();
      return json({ ok: true, data: results });
    }
    if (path === "/admin/mailboxes" && request.method === "POST") {
      const body = await readJson(request, MAX_BODY_BYTES);
      const email = String(body.email || "").trim().toLowerCase();
      const domains = safeDomainList(env.MAIL_DOMAINS);
      if (!validEmail(email)) return errorResponse("A valid email address is required");
      if (domains.length && !domains.includes(email.split("@")[1])) return errorResponse("Email domain is not configured");
      const id = randomId();
      const apiKey = `cm_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
      try {
        await env.DB.prepare("INSERT INTO mailboxes(id,email,label,api_key_hash) VALUES(?,?,?,?)")
          .bind(id, email, String(body.label || "").slice(0, 100), await sha256(apiKey)).run();
      } catch (error) {
        if (String(error).includes("UNIQUE")) return errorResponse("Mailbox already exists", 409);
        throw error;
      }
      return json({ ok: true, data: { id, email, apiKey } }, 201);
    }
    const match = /^\/admin\/mailboxes\/([\w-]+)(?:\/(rotate-key))?$/.exec(path);
    if (match && request.method === "POST" && match[2] === "rotate-key") {
      const apiKey = `cm_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
      const result = await env.DB.prepare("UPDATE mailboxes SET api_key_hash=? WHERE id=?")
        .bind(await sha256(apiKey), match[1]).run();
      if (!result.meta.changes) return errorResponse("Mailbox not found", 404);
      return json({ ok: true, data: { apiKey } });
    }
    if (match && request.method === "DELETE" && !match[2]) {
      await env.DB.prepare("DELETE FROM mailboxes WHERE id=?").bind(match[1]).run();
      return json({ ok: true });
    }
    return errorResponse("Not found", 404);
  }

  const mailbox = await mailboxAuth(request, env);
  if (!mailbox) return errorResponse("Unauthorized", 401);
  if (!env.DB) return errorResponse("D1 binding DB is missing", 503);

  if (path === "/me" && request.method === "GET") return json({ ok: true, data: mailbox });

  if (path === "/mail" && request.method === "GET") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 25)));
    const before = url.searchParams.get("before");
    let query = "SELECT id,direction,sender,recipients,subject,text_body,received_at,is_read,size_bytes FROM messages WHERE mailbox_id=?";
    const args = [mailbox.id];
    if (before) { query += " AND received_at < (SELECT received_at FROM messages WHERE id=? AND mailbox_id=?)"; args.push(before, mailbox.id); }
    query += " ORDER BY received_at DESC LIMIT ?";
    args.push(limit);
    const { results } = await env.DB.prepare(query).bind(...args).all();
    return json({ ok: true, data: results });
  }
  const attachmentListMatch = /^\/mail\/([\w-]+)\/attachments$/.exec(path);
  if (attachmentListMatch && request.method === "GET") {
    const owned = await env.DB.prepare("SELECT id FROM messages WHERE id=? AND mailbox_id=?").bind(attachmentListMatch[1], mailbox.id).first();
    if (!owned) return errorResponse("Message not found", 404);
    const { results } = await env.DB.prepare("SELECT id,filename,content_type,size_bytes,content_id FROM attachments WHERE message_id=? AND mailbox_id=? ORDER BY rowid")
      .bind(attachmentListMatch[1], mailbox.id).all();
    return json({ ok: true, data: results });
  }
  const attachmentMatch = /^\/attachments\/([\w-]+)$/.exec(path);
  if (attachmentMatch && request.method === "GET") {
    const item = await env.DB.prepare("SELECT id,filename,content_type,object_key FROM attachments WHERE id=? AND mailbox_id=?")
      .bind(attachmentMatch[1], mailbox.id).first();
    if (!item) return errorResponse("Attachment not found", 404);
    if (!item.object_key || !env.MAIL_FILES) return errorResponse("Attachment storage is not configured", 503);
    const object = await env.MAIL_FILES.get(item.object_key);
    if (!object) return errorResponse("Attachment content not found", 404);
    return new Response(object.body, { headers: {
      "content-type": item.content_type || "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(item.filename)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store"
    }});
  }

  const messageMatch = /^\/mail\/([\w-]+)$/.exec(path);
  if (messageMatch && request.method === "GET") {
    const row = await env.DB.prepare("SELECT * FROM messages WHERE id=? AND mailbox_id=?").bind(messageMatch[1], mailbox.id).first();
    if (!row) return errorResponse("Message not found", 404);
    await env.DB.prepare("UPDATE messages SET is_read=1 WHERE id=? AND mailbox_id=?").bind(row.id, mailbox.id).run();
    return json({ ok: true, data: row });
  }
  if (messageMatch && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM messages WHERE id=? AND mailbox_id=?").bind(messageMatch[1], mailbox.id).run();
    return json({ ok: true });
  }
  if (path === "/send" && request.method === "POST") {
    if (!env.RESEND_API_KEY) return errorResponse("Outbound email provider is not configured", 503);
    const body = await readJson(request, MAX_BODY_BYTES);
    const to = Array.isArray(body.to) ? body.to : [body.to];
    if (!to.length || to.length > 20 || to.some(x => !validEmail(x))) return errorResponse("Invalid recipient list");
    const subject = String(body.subject || "").slice(0, 998);
    const textBody = String(body.text || "").slice(0, 50000);
    const htmlBody = String(body.html || "").slice(0, 100000);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text: textBody || undefined, html: htmlBody || undefined })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return json({ ok: false, error: "Outbound provider rejected the message", providerStatus: response.status }, 502);
    const id = await storeMessage(env, { mailboxId: mailbox.id, direction: "outbound", sender: mailbox.email, recipients: to, subject, text: textBody, html: htmlBody, messageId: payload.id || "", sizeBytes: textBody.length + htmlBody.length });
    return json({ ok: true, data: { id, providerId: payload.id || null } }, 202);
  }
  return errorResponse("Not found", 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/v1/")) {
        const response = await api(request, env);
        const cors = corsHeaders(request, env);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      if (url.pathname === "/health") return json({ ok: true, service: "cloud-mail", version: "2.0.0" });
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("request failed", error);
      return errorResponse(error.message === "Request body too large" ? error.message : "Internal server error", error.message === "Request body too large" ? 413 : 500);
    }
  },
  async email(message, env) {
    try { await handleInbound(message, env); }
    catch (error) {
      console.error("inbound email failed", error);
      message.setReject("Temporary processing failure");
      throw error;
    }
  }
};

export { handleInbound, api };
