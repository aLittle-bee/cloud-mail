# Cloud Mail v2

Cloud Mail is a Cloudflare Workers-based mailbox service. The current production deployment uses a D1 database, a Worker API, a native Cloudflare Email Sending binding, and a small web entry page.

## Production deployment

- Web inbox: https://mail.12310721.xyz/
- Admin endpoint: https://mail.12310721.xyz/admin
- Health: https://mail.12310721.xyz/health
- API prefix: `/api/v1`
- Worker: `cloud-mail-v2`
- D1 database: `cloud-mail-v2` (APAC)
- Inbound handler: Cloudflare Workers Email handler. Configure Email Routing separately to direct messages to this Worker.

## Features

- D1-backed mailbox and message records.
- Separate administrator and mailbox API keys; only SHA-256 hashes are stored.
- Mailbox creation, listing, deletion, and API-key rotation.
- Mail listing and message retrieval, scoped to the authenticated mailbox.
- Outbound sending through Cloudflare's native `send_email` binding.
- Inbound email handler with basic RFC 5322 header/body extraction.
- Responsive inbox entry page and administrator API entry page.
- Request size limits, no-store responses, and basic security headers.

## Requirements

- Cloudflare Workers and D1.
- A domain on Cloudflare DNS.
- Email Sending domain onboarding for outbound delivery.
- Email Routing rule targeting this Worker for inbound delivery.
- R2 is optional and is not currently required by the deployed core.

## Local development

1. Install Node.js 20+.
2. From `worker/`, run `npm install`.
3. Ensure `worker/wrangler.toml` references your own D1 database ID.
4. Create a D1 database and apply migrations:

```sh
cd worker
npx wrangler d1 create cloud-mail-v2
npx wrangler d1 migrations apply cloud-mail-v2 --local
npx wrangler dev
```

5. Configure a strong administrator key. The Worker compares the SHA-256 hash of the presented key with the `settings.admin_api_key_hash` value. Generate a key locally and insert only its hash:

```sh
ADMIN_KEY="$(openssl rand -hex 48)"
ADMIN_HASH="$(printf %s "$ADMIN_KEY" | openssl dgst -sha256 | awk '{print $2}')"
npx wrangler d1 execute cloud-mail-v2 --local --command "INSERT OR REPLACE INTO settings(setting_key,setting_value) VALUES ('admin_api_key_hash','$ADMIN_HASH');"
printf '%s\n' "$ADMIN_KEY"
```

Keep the printed administrator key private. Do not commit it or its plaintext value.

## Production setup

The production D1 database is already provisioned and its schema is applied. For a new account:

1. Create a D1 database and update `database_id` in `worker/wrangler.toml`.
2. Apply migrations with `npx wrangler d1 migrations apply cloud-mail-v2 --remote`.
3. Insert a SHA-256 hash of a high-entropy administrator key into the `settings` table as shown above, using `--remote`.
4. Configure `MAIL_DOMAINS` and `MAIL_FROM`.
5. Onboard the sending domain in Cloudflare Email Service and verify its DNS records.
6. Deploy with `npx wrangler deploy`.
7. Configure Email Routing to deliver inbound messages to the Worker.

## API

Admin requests use `Authorization: Bearer <ADMIN_API_KEY>`.

- `GET /api/v1/health`
- `GET /api/v1/admin/mailboxes`
- `POST /api/v1/admin/mailboxes` — JSON: `{"email":"person@12310721.xyz","label":"Personal"}`
- `POST /api/v1/admin/mailboxes/:id/rotate-key`
- `DELETE /api/v1/admin/mailboxes/:id`

Mailbox requests use `Authorization: Bearer <MAILBOX_API_KEY>`.

- `GET /api/v1/me`
- `GET /api/v1/mail?limit=25`
- `GET /api/v1/mail/:id`
- `POST /api/v1/send` — JSON: `{"to":"recipient@example.net","subject":"Hello","text":"Message body"}`

The raw mailbox API key is returned once at creation or rotation. Store it securely.

## Current limitations

- The current inbound parser extracts basic headers and the raw body text. Full MIME multipart parsing, encoded-word decoding, attachment extraction and HTML sanitization are not yet implemented.
- R2 is not enabled for this Cloudflare account yet, so attachment/raw-source storage is not active.
- Outbound delivery requires Email Sending domain onboarding. The Worker binding is configured, but Cloudflare's Email Domain API is currently unavailable to this account connection.
- The admin page is currently an API entry/help page; mailbox administration is available through the documented authenticated API. A full browser management UI remains future work.
- This is a Worker-based webmail/API service, not an IMAP/POP3 server.

## Security

- Administrator and mailbox credentials are stored as SHA-256 hashes.
- Use high-entropy keys and rotate credentials that have ever appeared in Git history.
- Keep the admin key out of source control, browser local storage, and public logs.
- The administrator key currently provisioned for production must be treated as a private credential.
- Configure retention and deletion policies before using this for sensitive or long-term mail storage.

## Tests

```sh
cd worker
npm test
```

MIT License. See [LICENSE](LICENSE).
