ALTER TABLE mailboxes ADD COLUMN forward_to TEXT;
ALTER TABLE mailboxes ADD COLUMN forward_enabled INTEGER NOT NULL DEFAULT 0 CHECK (forward_enabled IN (0,1));

ALTER TABLE messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1));
ALTER TABLE messages ADD COLUMN protocol_uid INTEGER;
UPDATE messages SET protocol_uid = rowid WHERE protocol_uid IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_mailbox_protocol_uid
  ON messages(mailbox_id, protocol_uid);

CREATE TABLE IF NOT EXISTS storage_objects (
  object_key TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_storage_objects_created
  ON storage_objects(state, created_at);

INSERT OR IGNORE INTO settings(setting_key,setting_value) VALUES
  ('admin_forward_email',''),
  ('imap_enabled','0'),
  ('pop3_enabled','0'),
  ('storage_limit_bytes','536870912');
