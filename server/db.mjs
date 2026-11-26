import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SIGNUP_BONUS = 3000;
export const TX_FEE = 100;

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
      unique_code INTEGER NOT NULL DEFAULT 0,
      total_amount INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','admin_confirmed','rejected')),
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
      confirmed_by TEXT REFERENCES users(id), confirmed_at TEXT,
      proof_reference TEXT UNIQUE, note TEXT,
      CHECK((status='pending' AND confirmed_by IS NULL AND confirmed_at IS NULL AND proof_reference IS NULL)
         OR (status='admin_confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND proof_reference IS NOT NULL)
         OR (status='rejected' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)));
   CREATE INDEX IF NOT EXISTS topup_owner ON topup_intents(user_id,created_at);
   CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL CHECK(amount != 0),
      kind TEXT NOT NULL CHECK(kind IN ('signup_bonus','admin_topup','admin_adjustment','tx_hold','tx_refund','paid_order_fee')),
      source_id TEXT NOT NULL, actor_id TEXT REFERENCES users(id),
      note TEXT,
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
   CREATE TABLE IF NOT EXISTS shopee_portal_connections (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     store_id TEXT NOT NULL,
     merchant_id TEXT NOT NULL,
     token_enc TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','session_broken')),
     last_checked_at TEXT,
     last_error TEXT,
     transaction_count INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
  `);
  // Support tickets & messages
  db.exec(`CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_id TEXT, subject TEXT NOT NULL, description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS tickets_owner ON support_tickets(user_id,created_at);
   CREATE INDEX IF NOT EXISTS tickets_status ON support_tickets(status,created_at);
   CREATE TABLE IF NOT EXISTS ticket_messages (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('merchant','admin')),
    message TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS ticket_msg_owner ON ticket_messages(ticket_id,created_at);
   CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS subscription_orders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    months INTEGER NOT NULL CHECK(months IN (1,2,3,5)),
    base_amount INTEGER NOT NULL, unique_code INTEGER NOT NULL, total_amount INTEGER NOT NULL,
    qris_payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired')),
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, paid_at TEXT, confirmed_by TEXT REFERENCES users(id));
   CREATE INDEX IF NOT EXISTS sub_orders_owner ON subscription_orders(user_id,created_at);
  `);
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'subscription_expires_at')) {
    db.exec('ALTER TABLE users ADD COLUMN subscription_expires_at TEXT');
  }
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'is_active')) {
    db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  }
  const ledgerSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledger_entries'").get()?.sql ?? '';
  if (!ledgerSchema.includes("'signup_bonus'")) {
    const ledgerCols = db.prepare('PRAGMA table_info(ledger_entries)').all().map(c => c.name);
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE ledger_entries RENAME TO ledger_entries_legacy;
      CREATE TABLE ledger_entries (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        amount INTEGER NOT NULL CHECK(amount != 0),
        kind TEXT NOT NULL CHECK(kind IN ('signup_bonus','admin_topup','admin_adjustment','tx_hold','tx_refund','paid_order_fee')),
        source_id TEXT NOT NULL, actor_id TEXT REFERENCES users(id),
        note TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(kind,source_id));
      INSERT INTO ledger_entries (id,user_id,amount,kind,source_id,actor_id,note,created_at)
      SELECT id,user_id,amount,kind,source_id,actor_id,${ledgerCols.includes('note') ? 'note' : 'NULL'},created_at FROM ledger_entries_legacy;
      DROP TABLE ledger_entries_legacy;
      CREATE INDEX IF NOT EXISTS ledger_owner ON ledger_entries(user_id,created_at,id);
      COMMIT;`);
  } else if (!db.prepare('PRAGMA table_info(ledger_entries)').all().some(c => c.name === 'note')) {
    db.exec('ALTER TABLE ledger_entries ADD COLUMN note TEXT');
  }
  const topupSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='topup_intents'").get()?.sql ?? '';
  if (!topupSchema.includes("'rejected'")) {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE topup_intents RENAME TO topup_intents_legacy;
      CREATE TABLE topup_intents (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 999999999),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','admin_confirmed','rejected')),
        created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
        confirmed_by TEXT REFERENCES users(id), confirmed_at TEXT,
        proof_reference TEXT UNIQUE, note TEXT,
        CHECK((status='pending' AND confirmed_by IS NULL AND confirmed_at IS NULL AND proof_reference IS NULL)
           OR (status='admin_confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND proof_reference IS NOT NULL)
           OR (status='rejected' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)));
      INSERT INTO topup_intents (id,user_id,amount,status,created_by,created_at,confirmed_by,confirmed_at,proof_reference,note)
      SELECT id,user_id,amount,status,created_by,created_at,confirmed_by,confirmed_at,proof_reference,note FROM topup_intents_legacy;
      DROP TABLE topup_intents_legacy;
      CREATE INDEX IF NOT EXISTS topup_owner ON topup_intents(user_id,created_at);
      COMMIT;`);
  }
  const topupCols = db.prepare('PRAGMA table_info(topup_intents)').all().map(c => c.name);
  if (!topupCols.includes('unique_code')) db.exec('ALTER TABLE topup_intents ADD COLUMN unique_code INTEGER NOT NULL DEFAULT 0');
  if (!topupCols.includes('total_amount')) {
    db.exec('ALTER TABLE topup_intents ADD COLUMN total_amount INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE topup_intents SET total_amount = amount + unique_code WHERE total_amount = 0');
  }
  if (!topupCols.includes('expires_at')) db.exec('ALTER TABLE topup_intents ADD COLUMN expires_at TEXT');
  const portalCols = db.prepare('PRAGMA table_info(shopee_portal_connections)').all().map(c => c.name);
  const portalSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='shopee_portal_connections'").get()?.sql ?? '';
  if (portalSchema.includes("'disconnected'")) {
    // SQLite cannot alter a CHECK constraint. Preserve encrypted rows while upgrading the legacy table.
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE shopee_portal_connections RENAME TO shopee_portal_connections_legacy;
      CREATE TABLE shopee_portal_connections (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        store_id TEXT NOT NULL, merchant_id TEXT NOT NULL, token_enc TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','session_broken')),
        last_checked_at TEXT, last_error TEXT, transaction_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO shopee_portal_connections
        (user_id,store_id,merchant_id,token_enc,status,last_checked_at,last_error,transaction_count,created_at,updated_at)
      SELECT user_id,store_id,merchant_id,token_enc,
        'session_broken', -- Legacy rows must pass the new merchant/store probe before reporting connected.
        ${portalCols.includes('last_checked_at') ? 'last_checked_at' : 'NULL'},
        ${portalCols.includes('last_error') ? 'last_error' : 'NULL'},
        ${portalCols.includes('transaction_count') ? 'transaction_count' : '0'},
        created_at,updated_at FROM shopee_portal_connections_legacy;
      DROP TABLE shopee_portal_connections_legacy;
      COMMIT;`);
  } else {
    if (!portalCols.includes('status')) db.exec("ALTER TABLE shopee_portal_connections ADD COLUMN status TEXT NOT NULL DEFAULT 'session_broken'");
    if (!portalCols.includes('last_checked_at')) db.exec('ALTER TABLE shopee_portal_connections ADD COLUMN last_checked_at TEXT');
    if (!portalCols.includes('last_error')) db.exec('ALTER TABLE shopee_portal_connections ADD COLUMN last_error TEXT');
    if (!portalCols.includes('transaction_count')) db.exec('ALTER TABLE shopee_portal_connections ADD COLUMN transaction_count INTEGER NOT NULL DEFAULT 0');
  }
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

export function heldBalanceOf(db, userId) {
  return db.prepare("SELECT COALESCE(COUNT(*),0) * ? AS held FROM transactions t WHERE t.user_id=? AND t.status='pending' AND EXISTS (SELECT 1 FROM ledger_entries l WHERE l.kind='tx_hold' AND l.source_id=t.id)").get(TX_FEE, userId).held;
}

export function settleTxInTx(db, tx, nextStatus, actorId = null, customNote = '') {
  if (!tx || tx.status !== 'pending') return false;
  if (!['paid', 'failed', 'expired', 'cancelled'].includes(nextStatus)) {
    throw new Error('Invalid transaction settlement status.');
  }
  const updated = db.prepare("UPDATE transactions SET status=? WHERE id=? AND status='pending'").run(nextStatus, tx.id);
  if (!updated.changes) return false;
  if (nextStatus !== 'paid') {
    const held = db.prepare("SELECT 1 FROM ledger_entries WHERE kind='tx_hold' AND source_id=?").get(tx.id);
    const refunded = db.prepare("SELECT 1 FROM ledger_entries WHERE kind='tx_refund' AND source_id=?").get(tx.id);
    if (held && !refunded) {
      db.prepare('INSERT INTO ledger_entries (id,user_id,amount,kind,source_id,actor_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(randomUUID(), tx.user_id, TX_FEE, 'tx_refund', tx.id, actorId, customNote || `Pengembalian saldo ditahan (${nextStatus}) · ${tx.order_id}`, new Date().toISOString());
    }
  }
  return true;
}

export function expireOverdueInTx(db, userId = null) {
  const nowIso = new Date().toISOString();
  const overdue = userId
    ? db.prepare("SELECT * FROM transactions WHERE user_id=? AND status='pending' AND expires_at<=?").all(userId, nowIso)
    : db.prepare("SELECT * FROM transactions WHERE status='pending' AND expires_at<=?").all(nowIso);
  for (const tx of overdue) {
    settleTxInTx(db, tx, 'expired', null, `Pengembalian saldo ditahan (kedaluwarsa) · ${tx.order_id}`);
  }
  return overdue.length;
}

export function expireOverdueTransactions(db, userId = null) {
  return db.transaction(() => expireOverdueInTx(db, userId))();
}

