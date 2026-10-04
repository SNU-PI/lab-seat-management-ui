'use strict';

const fs = require('fs');
const path = require('path');
const { get, head, put, BlobPreconditionFailedError } = require('@vercel/blob');
const { resetDate } = require('./time');

const key = 'lab-seats/state.json';
const seed = require('./seed/rooms.json');
const remote = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'rooms.json');

if (process.env.VERCEL && !remote) {
  throw new Error('Connect a private Vercel Blob store before deploying');
}

function freshState() {
  return JSON.parse(JSON.stringify(seed));
}

async function readRaw() {
  if (remote) {
    let blob = await get(key, { access: 'private', useCache: false });
    if (!blob) {
      const initial = JSON.stringify(freshState());
      try {
        const created = await put(key, initial, {
          access: 'private', addRandomSuffix: false, contentType: 'application/json'
        });
        return { raw: initial, etag: created.etag };
      } catch (error) {
        // Another request may have initialized the same blob first.
        blob = await get(key, { access: 'private', useCache: false });
        if (!blob) throw error;
      }
    }
    if (blob.statusCode !== 200) throw new Error('Unexpected Blob response');
    return { raw: await new Response(blob.stream).text(), etag: blob.blob.etag };
  }
  if (!fs.existsSync(dataFile)) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(freshState(), null, 2), { flag: 'wx' });
  }
  return { raw: fs.readFileSync(dataFile, 'utf8') };
}

async function readForUpdate() {
  const first = await readRaw(); // Initialize the blob if this is the first request.
  if (!remote) return first;

  // Blob content responses can have a different ETag from the control-plane
  // version used by conditional put. Bracket the content read with head calls
  // so the body and write precondition refer to the same stored version.
  const before = await head(key);
  const blob = await get(key, { access: 'private', useCache: false });
  const after = await head(key);
  if (!blob || blob.statusCode !== 200 || before.etag !== after.etag) return null;
  return { raw: await new Response(blob.stream).text(), etag: after.etag };
}

async function writeIfUnchanged(before, after, etag) {
  if (remote) {
    try {
      await put(key, after, {
        access: 'private', addRandomSuffix: false, contentType: 'application/json', ifMatch: etag
      });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) return false;
      throw error;
    }
  }
  if (fs.readFileSync(dataFile, 'utf8') !== before) return false;
  const tmp = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, after);
  fs.renameSync(tmp, dataFile);
  return true;
}

function clearOccupancy(state) {
  let count = 0;
  for (const room of Object.values(state.rooms)) {
    for (const cell of Object.values(room.cells || {})) {
      if (cell.type === 'seat' && cell.occupied) {
        cell.occupied = false;
        cell.occupant = null;
        cell.since = null;
        count++;
      }
    }
  }
  return count;
}

async function update(change, resetHour = 2) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const snapshot = await readForUpdate();
    if (!snapshot) continue;
    const { raw: before, etag } = snapshot;
    const state = JSON.parse(before);
    if (!state || !state.rooms) throw new Error('Invalid saved room data');
    const today = resetDate(new Date(), resetHour);
    if (state.lastResetDate !== today) {
      clearOccupancy(state);
      state.lastResetDate = today;
    }
    const result = change(state);
    const after = JSON.stringify(state);
    if (after === before || await writeIfUnchanged(before, after, etag)) return { state, result };
  }
  throw new Error('Too many concurrent updates; please retry');
}

async function read(resetHour = 2) {
  const { raw } = await readRaw();
  const state = JSON.parse(raw);
  if (!state || !state.rooms) throw new Error('Invalid saved room data');
  if (state.lastResetDate === resetDate(new Date(), resetHour)) return state;
  return (await update(() => undefined, resetHour)).state;
}

module.exports = { read, update, clearOccupancy, resetDate };
