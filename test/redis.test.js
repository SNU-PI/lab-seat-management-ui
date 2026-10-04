'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Redis storage initializes once and retries concurrent writes', async (t) => {
  const previous = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    fetch: global.fetch
  };
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.invalid';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  const modulePath = require.resolve('../store');
  delete require.cache[modulePath];
  t.after(() => {
    delete require.cache[modulePath];
    global.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
  });

  let value = null;
  let casFailures = 0;
  global.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    const args = JSON.parse(options.body);
    let result;
    if (args[0] === 'GET') result = value;
    else if (args[0] === 'SETNX') {
      result = value === null ? 1 : 0;
      if (result) value = args[2];
    } else if (args[0] === 'EVAL') {
      result = value === args[4] ? 1 : 0;
      if (result) value = args[5];
      else casFailures++;
    } else throw new Error(`Unexpected Redis command ${args[0]}`);
    return { ok: true, json: async () => ({ result }) };
  };

  const store = require('../store');
  await Promise.all(Array.from({ length: 6 }, () => store.update(state => {
    state.counter = (state.counter || 0) + 1;
  })));
  assert.equal((await store.read()).counter, 6);
  assert.ok(casFailures > 0);
});
