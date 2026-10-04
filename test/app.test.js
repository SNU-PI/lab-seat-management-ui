'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-seats-test-'));
const file = path.join(dir, 'rooms.json');
process.env.DATA_FILE = file;
process.env.ADMIN_KEY = 'test-secret';
process.env.RESET_HOUR = '2';
const app = require('../server');

test('seed, admin authorization, persistence, toggle, and daily reset', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url, options) => fetch(base + url, options);

  const initial = await (await call('/api/rooms')).json();
  assert.equal(initial['1'].name, '138동 512호');
  assert.equal(initial['2'].name, '302동 319호');
  assert.equal(fs.existsSync(file), true);

  const seat = Object.values(initial['1'].cells).find(c => c.type === 'seat' && !c.disabled);
  assert.ok(seat);
  assert.equal((await call('/api/rooms/1/name', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '새 이름' })
  })).status, 401);

  const renamed = await call('/api/rooms/1/name', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': 'test-secret' },
    body: JSON.stringify({ name: '새 이름' })
  });
  assert.equal(renamed.status, 200);
  assert.equal((await (await call('/api/rooms/1')).json()).name, '새 이름');

  const toggleUrl = `/toggle/1/${encodeURIComponent(seat.number)}`;
  assert.equal((await call(toggleUrl)).status, 200);
  const occupied = await (await call('/api/rooms/1')).json();
  assert.equal(Object.values(occupied.cells).find(c => c.number === seat.number).occupied, true);
  assert.equal((await call(toggleUrl)).status, 200);
  const vacant = await (await call('/api/rooms/1')).json();
  assert.equal(Object.values(vacant.cells).find(c => c.number === seat.number).occupied, false);

  await call(toggleUrl);
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  persisted.lastResetDate = '2000-01-01';
  fs.writeFileSync(file, JSON.stringify(persisted));
  const reset = await (await call('/api/rooms/1')).json();
  assert.equal(Object.values(reset.cells).find(c => c.number === seat.number).occupied, false);
});
