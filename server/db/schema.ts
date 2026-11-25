import type { Client } from '@libsql/client'

const schemas = new WeakMap<Client, Promise<void>>()

export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (length(email) > 0 AND email = lower(email) AND email = trim(email)),
    CHECK (password_hash LIKE 'scrypt$%' AND length(password_hash) >= 40),
    UNIQUE (email)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
    CHECK (length(expires_at) > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS security_codes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (length(code) = 8 AND code NOT GLOB '*[^0-9]*'),
    CHECK (purpose IN ('login', 'password_change')),
    CHECK (length(expires_at) > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS memos (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (typeof(version) = 'integer' AND version >= 1)
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (length(name) > 0 AND name = trim(name)),
    UNIQUE (account_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS memo_tags (
    memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (memo_id, tag_id)
  )`,
  `CREATE TABLE IF NOT EXISTS memo_commits (
    id TEXT PRIMARY KEY,
    memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    seq INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (memo_id, seq),
    CHECK (typeof(seq) = 'integer' AND seq >= 1),
    CHECK (length(created_at) > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS saved_filters (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    keyword TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (length(name) > 0 AND name = trim(name)),
    UNIQUE (account_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS saved_filter_tags (
    filter_id TEXT NOT NULL REFERENCES saved_filters(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (filter_id, tag_id),
    CHECK (kind IN ('include', 'exclude')),
    CHECK (typeof(position) = 'integer' AND position >= 0)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_security_codes_account ON security_codes(account_id, purpose)`,
  `CREATE TABLE IF NOT EXISTS password_change_grants (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
    CHECK (length(expires_at) > 0)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_password_change_grants_account ON password_change_grants(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memos_account_updated ON memos(account_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tags_account ON tags(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memo_tags_tag ON memo_tags(tag_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memo_commits_memo_seq ON memo_commits(memo_id, seq)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_filters_account ON saved_filters(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_filter_tags_tag ON saved_filter_tags(tag_id)`,
  `CREATE TRIGGER IF NOT EXISTS memo_tags_same_account
   BEFORE INSERT ON memo_tags
   FOR EACH ROW
   WHEN (SELECT account_id FROM memos WHERE id = NEW.memo_id) IS NOT (SELECT account_id FROM tags WHERE id = NEW.tag_id)
   BEGIN
     SELECT RAISE(ABORT, 'memo and tag account mismatch');
   END`,
  `CREATE TRIGGER IF NOT EXISTS saved_filter_tags_same_account
   BEFORE INSERT ON saved_filter_tags
   FOR EACH ROW
   WHEN (SELECT account_id FROM saved_filters WHERE id = NEW.filter_id) IS NOT (SELECT account_id FROM tags WHERE id = NEW.tag_id)
   BEGIN
     SELECT RAISE(ABORT, 'filter and tag account mismatch');
   END`,
]

export function ensureSchema(db: Client): Promise<void> {
  const existing = schemas.get(db)
  if (existing) {
    return existing
  }
  const pending = db.batch(schemaStatements, 'write').then(() => undefined).catch((error: unknown) => {
    schemas.delete(db)
    throw error
  })
  schemas.set(db, pending)
  return pending
}
