const encoder = new TextEncoder();

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...securityHeaders(), ...extraHeaders }
  });
}

export function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cache-control": "no-store"
  };
}

export function errorResponse(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

export function randomId() {
  return crypto.randomUUID();
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bearer(request) {
  const value = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1] || "";
}

export function validEmail(value) {
  if (typeof value !== "string" || value.length > 254) return false;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

export function safeDomainList(value) {
  return String(value || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

export async function readJson(request, maxBytes = 64 * 1024) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("Request body too large");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error("Request body too large");
  try { return JSON.parse(raw || "{}"); } catch { throw new Error("Invalid JSON"); }
}
