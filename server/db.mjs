import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS banks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bank TEXT NOT NULL, holder TEXT NOT NULL, number TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS banks_owner ON banks(user_id);
    CREATE TABLE IF NOT EXISTS qris_assets (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, provider TEXT NOT NULL, name TEXT NOT NULL, city TEXT NOT NULL,
      mode TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS qris_owner ON qris_assets(user_id);
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL, amount INTEGER NOT NULL, unique_code INTEGER NOT NULL,
      qris_id TEXT NOT NULL REFERENCES qris_assets(id), status TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      UNIQUE(user_id, order_id));
    CREATE INDEX IF NOT EXISTS transactions_owner ON transactions(user_id, created_at);
    CREATE TABLE IF NOT EXISTS provider_orders (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      external_order_id TEXT NOT NULL UNIQUE, provider_transaction_id TEXT NOT NULL UNIQUE,
      base_amount INTEGER NOT NULL, unique_code INTEGER NOT NULL, total_amount INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','paid','expired','cancelled')),
      created_at TEXT NOT NULL, paid_at TEXT);
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      delivery_id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES provider_orders(id),
      event TEXT NOT NULL, body_hash TEXT NOT NULL, received_at TEXT NOT NULL);
  `);
  if (!db.prepare("PRAGMA table_info(webhook_deliveries)").all().some(column => column.name === 'body_hash')) {
    db.exec("ALTER TABLE webhook_deliveries ADD COLUMN body_hash TEXT NOT NULL DEFAULT ''");
  }
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'merchant' CHECK(role IN ('merchant','admin'))");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS topup_intents (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 999999999),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','admin_confirmed')),
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
      confirmed_by TEXT REFERENCES users(id), confirmed_at TEXT,
      proof_reference TEXT UNIQUE, note TEXT,
      CHECK((status='pending' AND confirmed_by IS NULL AND confirmed_at IS NULL AND proof_reference IS NULL)
         OR (status='admin_confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND proof_reference IS NOT NULL)));
    CREATE INDEX IF NOT EXISTS topup_owner ON topup_intents(user_id,created_at);
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL CHECK(amount != 0),
      kind TEXT NOT NULL CHECK(kind IN ('admin_topup','paid_order_fee')),
      source_id TEXT NOT NULL, actor_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(kind,source_id));
    CREATE INDEX IF NOT EXISTS ledger_owner ON ledger_entries(user_id,created_at,id);
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_api_keys (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
    webhook_url TEXT, qris_id TEXT REFERENCES qris_assets(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT);
    CREATE INDEX IF NOT EXISTS merchant_keys_owner ON merchant_api_keys(user_id,created_at);
    CREATE TABLE IF NOT EXISTS merchant_webhook_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    url TEXT, secret_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS shopee_listener_devices (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen_at TEXT);
    CREATE TABLE IF NOT EXISTS shopee_listener_events (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL, amount INTEGER NOT NULL, occurred_at TEXT NOT NULL,
    issuer TEXT NOT NULL, received_at TEXT NOT NULL,
    UNIQUE(user_id,event_id));
    CREATE INDEX IF NOT EXISTS shopee_listener_events_owner ON shopee_listener_events(user_id,received_at);
    CREATE TABLE IF NOT EXISTS android_mutation_signals (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT, source_app TEXT NOT NULL, title TEXT NOT NULL,
      text_hash TEXT NOT NULL, amount INTEGER, received_at TEXT NOT NULL,
      UNIQUE(user_id,event_id));
    CREATE INDEX IF NOT EXISTS android_mutation_owner ON android_mutation_signals(user_id,received_at);
  `);
  db.transaction = (operation) => () => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  return db;
}

export function balanceOf(db, userId) {
  return db.prepare('SELECT COALESCE(SUM(amount),0) AS balance FROM ledger_entries WHERE user_id=?').get(userId).balance;
}
