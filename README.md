# Cloud Mail v2

A Cloudflare Workers mailbox application with D1 metadata, private R2 message storage, inbound Email Workers, a browser inbox/admin panel, and an optional IMAP/POP3 TCP gateway.

## Production resources

- Web inbox: https://mail.12310721.xyz/
- Admin console: https://mail.12310721.xyz/admin
- Health endpoint: https://mail.12310721.xyz/health
- Protocol status: https://mail.12310721.xyz/api/v1/protocols
- Worker: `cloud-mail-v2`
- D1 database: `cloud-mail-v2`
- Private R2 bucket: `cloud-mail-data`
- API prefix: `/api/v1`

## R2 storage ceiling

The application enforces a **512 MiB (536,870,912 byte) project R2 object quota**.

- Every raw inbound or outbound message is stored as one RFC 822 object in the private `cloud-mail-data` bucket.
- Attachments remain inside the original MIME message object, so attachment bytes are counted once rather than duplicated as separate R2 objects.
- A D1 quota ledger reserves bytes atomically before an R2 write. Concurrent inbound messages cannot reserve beyond the 512 MiB ceiling.
- Failed writes release their reservation. A scheduled reconciliation runs every 15 minutes to repair stale pending reservations.
- Deleting a message or mailbox deletes its R2 object and releases the quota.
- When the ceiling is reached, new messages are not stored. Configured forwarding destinations are still attempted; the sender is rejected only when no forwarding destination exists.

This is an application-enforced limit, not a Cloudflare account-level R2 hard quota. Keep the bucket private and do not create direct S3 credentials or other writers for this bucket; a direct external write would bypass the D1 quota ledger. D1 metadata and parsed message fields are stored separately from R2 object usage.

## Forwarding

The Admin console has two forwarding levels:

1. **Administrator forwarding address** — every accepted mailbox message is forwarded to this address.
2. **Per-mailbox forwarding** — each mailbox can independently enable forwarding and specify its own destination.

The Worker deduplicates identical destinations. Forwarding uses Cloudflare's Email Worker `message.forward()` API. Destination delivery still depends on Cloudflare Email Service's forwarding eligibility and destination verification rules.

## IMAP and POP3

Cloudflare Workers currently cannot accept direct inbound TCP connections from email clients. Cloudflare documents inbound TCP support as unsupported; Workers can only accept TCP forwarded from another Worker over a service binding. See [Cloudflare TCP Sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).

For that reason, this repository includes a separate Node.js TLS gateway under `protocol-server/`. It proxies IMAP/POP3 commands to the authenticated Cloud Mail HTTP API; it does not store mail locally and cannot bypass the R2 quota.

### Gateway deployment

The TCP gateway must run on a public Linux host (for example, a VPS) with Docker and a TLS certificate whose SAN includes both `imap.12310721.xyz` and `pop.12310721.xyz`.

1. Create DNS-only A records for `imap.12310721.xyz` and `pop.12310721.xyz` pointing to that host. These records must be DNS-only; the ordinary Cloudflare HTTP proxy does not proxy IMAP/POP3 TCP ports.
2. Open inbound TCP ports `993` and `995` on the host firewall.
3. Obtain a TLS certificate for both names and place the certificate and key at `protocol-server/certs/fullchain.pem` and `protocol-server/certs/privkey.pem`.
4. Copy `protocol-server/` to the host and run:

```sh
docker compose up -d --build
```

5. In the Cloud Mail Admin console, enable IMAP and/or POP3. The gateway checks these switches when a client connects.

### Client settings

| Setting | IMAP | POP3 |
|---|---|---|
| Server | `imap.12310721.xyz` | `pop.12310721.xyz` |
| Port | 993 | 995 |
| Security | Implicit TLS | Implicit TLS |
| Username | Full mailbox address | Full mailbox address |
| Password | Mailbox API key | Mailbox API key |

Rotate a mailbox API key from the Admin console to revoke its old IMAP/POP3 password.

### Protocol scope

The gateway implements an IMAP4rev1 subset (LOGIN and SASL PLAIN authentication, INBOX listing/selection, fetch, search, seen/deleted flags, expunge) and POP3 retrieval/listing/deletion commands. It currently exposes a single INBOX and does not implement IMAP APPEND, IDLE, multiple folders, or SMTP submission. Outbound mail continues to use the Worker `/api/v1/send` API and Cloudflare Email Sending.

## API

Administrator requests use `Authorization: Bearer <ADMIN_API_KEY>`.

- `GET /api/v1/admin/settings`
- `PUT /api/v1/admin/settings` — JSON: `{"adminForwardEmail":"admin@example.net","imapEnabled":true,"pop3Enabled":false}`
- `GET /api/v1/admin/mailboxes`
- `POST /api/v1/admin/mailboxes` — JSON: `{"email":"person@12310721.xyz","label":"Personal"}`
- `PUT /api/v1/admin/mailboxes/:id/forward` — JSON: `{"enabled":true,"forwardTo":"forward@example.net"}`
- `POST /api/v1/admin/mailboxes/:id/rotate-key`
- `DELETE /api/v1/admin/mailboxes/:id`

Mailbox requests use `Authorization: Bearer <MAILBOX_API_KEY>`.

- `GET /api/v1/me`
- `GET /api/v1/mail?limit=50&offset=0`
- `GET /api/v1/mail/:id`
- `GET /api/v1/mail/:id/raw`
- `PATCH /api/v1/mail/:id` — set `is_read` or `is_deleted`
- `POST /api/v1/mail/expunge`
- `POST /api/v1/send` — JSON: `{"to":"recipient@example.net","subject":"Hello","text":"Message body"}`

The raw mailbox API key is returned once at creation or rotation. Store it securely.

## Local development

1. Install Node.js 22+.
2. From `worker/`, run `npm install`.
3. Update the D1 database ID and R2 bucket name in `worker/wrangler.toml` for your account.
4. Run `npx wrangler d1 migrations apply cloud-mail-v2 --local` and `npm test`.
5. Run `npm run dev`.

## Security and operations

- The R2 bucket is private and is accessed through the Worker binding only.
- Administrator and mailbox API keys are stored as SHA-256 hashes.
- Keep the administrator key out of source control, browser local storage, and public logs.
- The protocol gateway uses mailbox API keys as IMAP/POP3 passwords and holds them only in connection memory.
- Configure retention and deletion policies before using this for sensitive or long-term mail storage.

## Current external dependency

The IMAP/POP3 gateway source and Docker deployment are in the repository. It requires a public TCP host, DNS-only records, firewall access to ports 993/995, and TLS certificates. The Cloudflare Worker itself cannot host those public TCP listeners. The gateway has not been deployed to a VPS by the Cloudflare/GitHub connection.

MIT License. See [LICENSE](LICENSE).
