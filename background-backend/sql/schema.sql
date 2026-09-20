CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  snapshot JSONB NOT NULL,
  next_due_at BIGINT,
  last_generated_at BIGINT DEFAULT 0,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  subscription JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_messages (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  message JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  acked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_pending_unacked ON pending_messages(acked, created_at);
CREATE INDEX IF NOT EXISTS idx_char_due ON characters(next_due_at);
