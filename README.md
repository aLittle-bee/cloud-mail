# Cloud Mail 2

A clean-room rewrite of Cloud Mail for Cloudflare Workers. It provides a small, auditable email platform with a web inbox, mailbox administration, inbound email processing, a JSON API, D1 persistence, and optional R2 attachment storage.

## Features

- Cloudflare Worker API and static web application.
- D1-backed mailbox and message storage with SQL migrations.
- Inbound email via the Workers Email handler.
- Optional outbound email through Resend.
- Admin API protected by a secret stored as a Worker secret.
- Per-mailbox API keys stored only as SHA-256 hashes.
- Cursor pagination, mailbox ownership checks, bounded request sizes, and security headers.
- Optional R2 storage for raw message source and attachments.
- No secrets, database IDs, or account-specific settings committed to this repository.

## Requirements

- Cloudflare account with Workers, D1 and (optionally) R2.
- Node.js 20+ and npm.
- A domain configured for Cloudflare Email Routing if you want inbound mail.
- A Resend account and verified sending domain if you want outbound mail.

## Local setup

```sh
cd worker
npm install
npx wrangler d1 create cloud-mail
npx wrangler d1 migrations apply cloud-mail --local
npx wrangler dev
```

Copy `.dev.vars.example` to `.dev.vars` and set a long random `ADMIN_API_KEY`. Never commit `.dev.vars`.

## Production setup

1. Create the D1 database and copy its ID into `worker/wrangler.toml`.
2. Optionally create an R2 bucket and configure its binding.
3. Apply migrations: `cd worker && npx wrangler d1 migrations apply cloud-mail --remote`.
4. Set secrets:
   ```sh
   npx wrangler secret put ADMIN_API_KEY
   npx wrangler secret put RESEND_API_KEY # optional
   ```
5. Configure `MAIL_DOMAINS` in Worker variables as a comma-separated list, e.g. `example.com,mail.example.com`.
6. Deploy: `npx wrangler deploy`.
7. In Cloudflare Email Routing, route the desired domain's inbound messages to this Worker.

## API

All API paths are prefixed by `/api/v1`. Admin endpoints require `Authorization: Bearer <ADMIN_API_KEY>`.

- `GET /api/v1/health`
- `GET /api/v1/admin/mailboxes`
- `POST /api/v1/admin/mailboxes` — `{"email":"person@example.com","label":"Personal"}`
- `DELETE /api/v1/admin/mailboxes/:id`
- `POST /api/v1/admin/mailboxes/:id/rotate-key`
- `GET /api/v1/mail` — mailbox API key required; supports `?limit=25&before=<id>`
- `GET /api/v1/mail/:id`
- `DELETE /api/v1/mail/:id`
- `POST /api/v1/send` — mailbox API key and configured Resend API key required.

Mailbox endpoints use `Authorization: Bearer <mailbox-api-key>`. The raw mailbox key is shown only once when a mailbox is created or its key is rotated.

## Important boundaries

This project is a Worker-based mail application, not an IMAP/POP3 server. Receiving depends on Cloudflare Email Routing. Sending depends on the configured outbound provider. DNS, domain verification, provider limits, and Cloudflare account capabilities remain external prerequisites.

## Security

- Keep `ADMIN_API_KEY` and `RESEND_API_KEY` in Worker secrets.
- Rotate any credential that was ever committed to Git history.
- Restrict admin API access at the Cloudflare layer where possible.
- Set a custom domain and HTTPS before production use.
- Configure retention and R2 lifecycle policies to match your privacy requirements.
- Do not expose raw inbound message content through public endpoints.

## Development

```sh
cd worker
npm test
npm run dev
```

MIT License. See [LICENSE](LICENSE).
