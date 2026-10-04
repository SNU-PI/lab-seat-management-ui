'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('private Blob storage initializes once and retries concurrent writes', async (t) => {
  const blobPath = require.resolve('@vercel/blob');
  const originalBlob = require(blobPath);
  const previous = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  const storePath = require.resolve('../store');
  delete require.cache[storePath];
  t.after(() => {
    delete require.cache[storePath];
    require.cache[blobPath].exports = originalBlob;
    if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previous;
  });

  let value = null;
  let version = 0;
  let conflicts = 0;
  require.cache[blobPath].exports = {
    BlobPreconditionFailedError: originalBlob.BlobPreconditionFailedError,
    get: async (key, options) => {
      assert.equal(key, 'lab-seats/state.json');
      assert.equal(options.access, 'private');
      assert.equal(options.useCache, false);
      if (value === null) return null;
      return {
        statusCode: 200,
        blob: { etag: `v${version}` },
        stream: new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(value));
          controller.close();
        } })
      };
    },
    put: async (key, body, options) => {
      assert.equal(key, 'lab-seats/state.json');
      assert.equal(options.access, 'private');
      if (value !== null && options.ifMatch !== `v${version}`) {
        conflicts++;
        throw new originalBlob.BlobPreconditionFailedError();
      }
      value = body;
      version++;
      return { etag: `v${version}` };
    }
  };

  const store = require('../store');
  await Promise.all(Array.from({ length: 6 }, () => store.update(state => {
    state.counter = (state.counter || 0) + 1;
  })));
  assert.equal((await store.read()).counter, 6);
  assert.ok(conflicts > 0);
});
