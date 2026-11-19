import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';
import { openDatabase } from '../server/db.mjs';

const setup = async () => {
  const db = openDatabase(':memory:');
  const { server } = createApp({ db });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload, token) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return [response.status, await response.json()];
  };
  const register = async (email) => {
    assert.equal((await request('/api/auth/register', 'POST', { email, password: 'long-password-for-test', name: 'Merchant' }))[0], 201);
    return (await request('/api/auth/login', 'POST', { email, password: 'long-password-for-test' }))[1].token;
  };
  return { db, server, request, register, close: async () => { await new Promise(resolve => server.close(resolve)); db.close(); } };
};

const notice = (overrides = {}) => ({ eventId: 'event-001', amount: 50003, occurredAt: new Date().toISOString(), issuer: 'ShopeePay', ...overrides });

test('merchant pairs a listener token; secret appears once and is scoped to that merchant', async () => {
  const x = await setup();
  try {
    const a = await x.register('merchant-a@example.test');
    const b = await x.register('merchant-b@example.test');
    assert.equal((await x.request('/api/v1/shopee-listener', 'GET', undefined, a))[1].data.status, 'unconfigured');
    const [createdStatus, created] = await x.request('/api/v1/shopee-listener', 'POST', {}, a);
    assert.equal(createdStatus, 201);
    assert.match(created.token, /^dt_[A-Za-z0-9_-]{32,}$/);
    assert.equal(created.data.status, 'awaiting_event');
    assert.equal(created.data.providerConnected, false);
    assert.equal((await x.request('/api/v1/shopee-listener', 'GET', undefined, a))[1].token, undefined);
    assert.equal((await x.request('/api/v1/shopee-listener', 'GET', undefined, b))[1].data.status, 'unconfigured');
    assert.equal((await x.request('/api/v1/shopee-listener/events', 'GET', undefined, b))[1].data.length, 0);
    assert.equal((await x.request('/api/v1/shopee-listener', 'POST', {}, b))[0], 201);
    assert.equal((await x.request('/api/v1/shopee-listener', 'POST', {}, a))[0], 409);
  } finally { await x.close(); }
});

test('authorized listener receives idempotent unverified notifications but cannot settle an order', async () => {
  const x = await setup();
  try {
    const merchant = await x.register('merchant@example.test');
    const other = await x.register('other@example.test');
    const deviceToken = (await x.request('/api/v1/shopee-listener', 'POST', {}, merchant))[1].token;
    assert.equal((await x.request('/api/v1/shopee-listener/ingest', 'POST', notice()))[0], 401);
    assert.equal((await x.request('/api/v1/shopee-listener/ingest', 'POST', notice(), merchant))[0], 401);
    assert.equal((await x.request('/api/v1/shopee-listener/ingest', 'POST', notice({ amount: 0 }), deviceToken))[0], 400);
    assert.equal((await x.request('/api/v1/shopee-listener/ingest', 'POST', notice({ issuer: 'DANA' }), deviceToken))[0], 400);
    const signal = notice();
    const [status, result] = await x.request('/api/v1/shopee-listener/ingest', 'POST', signal, deviceToken);
    assert.equal(status, 202);
    assert.equal(result.data.verification, 'unverified_listener_signal');
    assert.equal(result.data.amount, 50003);
    assert.equal((await x.request('/api/v1/shopee-listener/ingest', 'POST', signal, deviceToken))[0], 200);
    assert.equal((await x.request('/api/v1/shopee-listener/ingest', 'POST', notice({ amount: 50004 }), deviceToken))[0], 409);
    assert.equal((await x.request('/api/v1/shopee-listener/events', 'GET', undefined, merchant))[1].data.length, 1);
    assert.equal((await x.request('/api/v1/shopee-listener/events', 'GET', undefined, other))[1].data.length, 0);
    assert.equal((await x.request('/api/v1/shopee-listener', 'GET', undefined, merchant))[1].data.status, 'receiving');
    assert.equal(x.db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE status=?').get('paid').count, 0);
    assert.equal(x.db.prepare('SELECT COUNT(*) AS count FROM provider_orders WHERE status=?').get('paid').count, 0);
    assert.equal((await x.request('/api/v1/shopee-listener', 'DELETE', undefined, other))[0], 404);
    assert.equal((await x.request('/api/v1/shopee-listener', 'DELETE', undefined, merchant))[0], 200);
    assert.equal((await x.request('/api/v1/shopee-listener/ingest', 'POST', notice({ eventId: 'event-002' }), deviceToken))[0], 401);
    assert.equal((await x.request('/api/v1/shopee-listener', 'GET', undefined, merchant))[1].data.status, 'unconfigured');
  } finally { await x.close(); }
});
