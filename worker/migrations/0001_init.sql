PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  label TEXT NOT NULL DEFAULT '',
  api_key_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender TEXT NOT NULL DEFAULT '',
  recipients TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  message_id TEXT,
  raw_object_key TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1))
);

CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received
  ON messages(mailbox_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_message_id
  ON messages(message_id);
