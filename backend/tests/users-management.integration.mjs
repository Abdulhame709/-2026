import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import express from 'express';
import pg from 'pg';
import { usersRoutes } from '../dist/api/routes/users.routes.js';
import { errorHandler } from '../dist/api/middleware/error.js';
import { AuthService } from '../dist/application/auth.service.js';
import { UsersRepository, hashPassword } from '../dist/infrastructure/repositories/users.repository.js';
import { AuthSessionsRepository } from '../dist/infrastructure/repositories/sessions.repository.js';
import { AuditRepository } from '../dist/infrastructure/repositories/audit.repository.js';

const databaseName = `reconciliation_users_test_${randomBytes(6).toString('hex')}`;
const connection = { host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD };
const admin = new pg.Client({ ...connection, database: 'postgres' });
let pool;
let server;
let created = false;

try {
  if (!process.env.PGPASSWORD) throw new Error('اضبط PGPASSWORD للاختبار المعزول فقط');
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  pool = new pg.Pool({ ...connection, database: databaseName });
  const migrations = join(process.cwd(), 'src', 'infrastructure', 'db', 'migrations');
  for (const name of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort()) {
    await pool.query((await readFile(join(migrations, name))).toString('utf8'));
  }
  const passwordHash = await hashPassword(`A1${randomBytes(24).toString('hex')}`);
  const actor = await pool.query(
    'INSERT INTO users (username,password_hash,full_name,role) VALUES ($1,$2,$3,$4) RETURNING id',
    ['manager', passwordHash, 'Test Manager', 'admin'],
  );
  const target = await pool.query(
    'INSERT INTO users (username,password_hash,full_name,role) VALUES ($1,$2,$3,$4) RETURNING id',
    ['archived_user', passwordHash, 'Test User', 'viewer'],
  );
  const actorId = Number(actor.rows[0].id);
  const targetId = Number(target.rows[0].id);
  await pool.query('INSERT INTO audit_log (actor_id,action) VALUES ($1,$2)', [targetId, 'HISTORICAL_EVENT']);
  await pool.query("INSERT INTO auth_sessions (user_id,expires_at) VALUES ($1,now() + interval '1 day')", [targetId]);

  const service = new AuthService(new UsersRepository(pool), new AuthSessionsRepository(pool), new AuditRepository(pool));
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.user = { id: actorId, username: 'manager', fullName: 'Test Manager', role: request.get('x-test-role') === 'viewer' ? 'viewer' : 'admin', isActive: true, mustChangePassword: false };
    next();
  });
  app.use('/users', usersRoutes(service));
  app.use(errorHandler);
  server = await new Promise((done) => {
    const listening = app.listen(0, '127.0.0.1', () => done(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/users`;
  const patchUser = (id, body, headers = {}) => fetch(`${base}/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const edit = { username: 'archived_user', fullName: 'Updated User', role: 'reconciler' };

  assert.equal((await patchUser(targetId, edit, { 'x-test-role': 'viewer' })).status, 403);
  assert.equal((await fetch(`${base}/${targetId}`, { method: 'DELETE', headers: { 'x-test-role': 'viewer' } })).status, 403);
  assert.equal((await patchUser(actorId, { ...edit, username: 'manager' })).status, 409);
  assert.equal((await fetch(`${base}/${actorId}`, { method: 'DELETE' })).status, 409);
  assert.equal((await patchUser(targetId, { ...edit, username: 'manager' })).status, 409);

  const updated = await patchUser(targetId, edit);
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).user.role, 'reconciler');
  const sessionsAfterEdit = await pool.query('SELECT count(*)::int AS total FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL', [targetId]);
  assert.equal(sessionsAfterEdit.rows[0].total, 0);
  const archived = await fetch(`${base}/${targetId}`, { method: 'DELETE' });
  assert.equal(archived.status, 204);
  const oldUser = await pool.query('SELECT deleted_at,is_active FROM users WHERE id=$1', [targetId]);
  assert.ok(oldUser.rows[0].deleted_at);
  assert.equal(oldUser.rows[0].is_active, false);
  const visible = await (await fetch(base)).json();
  assert.equal(visible.users.some((user) => user.id === targetId), false);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM audit_log WHERE actor_id=$1 AND action='HISTORICAL_EVENT'", [targetId])).rows[0].total, 1);
  assert.equal((await fetch(`${base}/${targetId}/activate`, { method: 'POST' })).status, 404);

  const replacement = await fetch(base, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'archived_user', fullName: 'Replacement User', role: 'viewer', initialPassword: `A1${randomBytes(20).toString('hex')}` }),
  });
  assert.equal(replacement.status, 201);
  assert.notEqual((await replacement.json()).user.id, targetId);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM audit_log WHERE action IN ('USER_UPDATE','USER_ARCHIVE')")).rows[0].total, 2);
  console.log('PASS: isolated admin-only edit/archive, session revocation, audit history and username reuse');
} finally {
  if (server) await new Promise((done) => server.close(done));
  if (pool) await pool.end();
  if (created && /^reconciliation_users_test_[0-9a-f]{12}$/.test(databaseName)) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end().catch(() => undefined);
}
