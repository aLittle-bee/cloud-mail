# Cloud Mail IMAP/POP3 Gateway

This Node.js service exposes IMAP4rev1 (TLS/993) and POP3 (TLS/995) to standard mail clients. It does not keep a local mail store: all authentication, message metadata, raw MIME retrieval, flags and deletion operations go through the Cloud Mail Worker API. This keeps the R2 512 MiB quota enforced by the Worker.

## Requirements

- Public Linux VPS with Docker Compose.
- DNS-only A records for `imap.12310721.xyz` and `pop.12310721.xyz` pointing to the VPS.
- Firewall allows inbound TCP 993 and 995.
- TLS certificate with both names in its SAN.

Cloudflare Workers cannot accept direct inbound TCP connections from clients. The TCP gateway must therefore run outside the Worker runtime. Do not orange-cloud the IMAP/POP3 DNS records; the standard HTTP proxy does not carry these protocols.

## Deploy

1. Put `fullchain.pem` and `privkey.pem` in `certs/`.
2. Start the service:

```sh
docker compose up -d --build
docker compose logs -f
```

3. In the Cloud Mail Admin page, enable IMAP and/or POP3.
4. Configure clients:

| | IMAP | POP3 |
|---|---|---|
| Host | imap.12310721.xyz | pop.12310721.xyz |
| Port | 993 | 995 |
| Encryption | TLS | TLS |
| Username | Full mailbox email | Full mailbox email |
| Password | Mailbox API key | Mailbox API key |

The mailbox API key is the protocol password. Rotate it from the Admin console to revoke old sessions/credentials.

## Supported protocol features

- IMAP: LOGIN, SASL PLAIN, CAPABILITY, LIST, NAMESPACE, STATUS, SELECT/EXAMINE, FETCH, UID FETCH, SEARCH, UID SEARCH, STORE, UID STORE, EXPUNGE, CLOSE, NOOP and LOGOUT.
- POP3: USER, PASS, CAPA, STAT, LIST, UIDL, RETR, TOP, DELE, RSET, NOOP and QUIT.
- Only the INBOX is exposed. APPEND, IDLE, multiple folders and SMTP submission are not implemented.
- Maximum messages exposed per connection: 500. Increase `MAX_MESSAGES` only after testing memory and latency.

The gateway fetches the global protocol switches at connection time. Turning a protocol off in Admin prevents new connections; existing client sessions close when the client disconnects.
