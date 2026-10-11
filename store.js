'use strict';

const fs = require('fs');
const path = require('path');
const { resetDate } = require('./time');

const key = 'lab-seats:state';
const seed = require('./seed/rooms.json');
const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const remote = Boolean(url && token);
const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'rooms.json');

if (Boolean(url) !== Boolean(token)) {
  throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together');
}
if (process.env.VERCEL && !remote) {
  throw new Error('Connect an Upstash Redis database before deploying');
}

function freshState() {
  return JSON.parse(JSON.stringify(seed));
}

async function command(args) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Redis request failed (${response.status})`);
  const body = await response.json();
  if (body.error) throw new Error(`Redis command failed: ${body.error}`);
  return body.result;
}

async function readRaw() {
  if (remote) {
    let raw = await command(['GET', key]);
    if (raw === null) {
      await command(['SETNX', key, JSON.stringify(freshState())]);
      raw = await command(['GET', key]);
    }
    if (typeof raw !== 'string') throw new Error('Invalid Redis room data');
    return raw;
  }
  if (!fs.existsSync(dataFile)) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(freshState(), null, 2), { flag: 'wx' });
  }
  return fs.readFileSync(dataFile, 'utf8');
}

async function writeIfUnchanged(before, after) {
  if (remote) {
    return await command([
      'EVAL',
      "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]); return 1 else return 0 end",
      '1', key, before, after
    ]) === 1;
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
    const before = await readRaw();
    const state = JSON.parse(before);
    if (!state || !state.rooms) throw new Error('Invalid saved room data');
    const today = resetDate(new Date(), resetHour);
    if (state.lastResetDate !== today) {
      clearOccupancy(state);
      state.lastResetDate = today;
    }
    const result = change(state);
    const after = JSON.stringify(state);
    if (after === before || await writeIfUnchanged(before, after)) return { state, result };
  }
  throw new Error('Too many concurrent updates; please retry');
}

async function read(resetHour = 2) {
  const raw = await readRaw();
  const state = JSON.parse(raw);
  if (!state || !state.rooms) throw new Error('Invalid saved room data');
  if (state.lastResetDate === resetDate(new Date(), resetHour)) return state;
  return (await update(() => undefined, resetHour)).state;
}

module.exports = { read, update, clearOccupancy, resetDate };
