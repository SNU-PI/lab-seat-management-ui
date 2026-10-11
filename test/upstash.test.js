'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Upstash initializes from seed, reads once per refresh, and preserves concurrent changes', async (t) => {
  const previous = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    fetch: global.fetch
  };
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  const storePath = require.resolve('../store');
  delete require.cache[storePath];
  t.after(() => {
    delete require.cache[storePath];
    global.fetch = previous.fetch;
    for (const [key, name] of [['url', 'UPSTASH_REDIS_REST_URL'], ['token', 'UPSTASH_REDIS_REST_TOKEN']]) {
      if (previous[key] === undefined) delete process.env[name];
      else process.env[name] = previous[key];
    }
  });

  let value = null;
  let conflicts = 0;
  const calls = [];
  global.fetch = async (url, options) => {
    if (url !== 'https://example.upstash.io') return previous.fetch(url, options);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    const args = JSON.parse(options.body);
    calls.push(args[0]);
    assert.equal(args[1] === 'lab-seats:state' || args[0] === 'EVAL', true);
    if (args[0] === 'GET') return Response.json({ result: value });
    if (args[0] === 'SETNX') {
      if (value === null) {
        value = args[2];
        return Response.json({ result: 1 });
      }
      return Response.json({ result: 0 });
    }
    if (args[0] === 'EVAL') {
      assert.equal(args[2], '1');
      assert.equal(args[3], 'lab-seats:state');
      if (value !== args[4]) {
        conflicts++;
        return Response.json({ result: 0 });
      }
      value = args[5];
      return Response.json({ result: 1 });
    }
    throw new Error(`Unexpected command: ${args[0]}`);
  };

  const store = require('../store');
  const seeded = await store.read();
  assert.equal(seeded.rooms['1'].name, '138동 512호');
  assert.equal(calls.filter(command => command === 'SETNX').length, 1);
  calls.length = 0;
  await store.read();
  assert.deepEqual(calls, ['GET']);

  await Promise.all(Array.from({ length: 6 }, () => store.update(state => {
    state.counter = (state.counter || 0) + 1;
  })));
  assert.equal((await store.read()).counter, 6);
  assert.ok(conflicts > 0);

  // A new request to the deployed app uses the same persisted Redis value.
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/toggle/1/18')).status, 200);
  const room = await (await fetch(base + '/api/rooms/1')).json();
  assert.equal(Object.values(room.cells).find(cell => cell.number === '18').occupied, true);
});
