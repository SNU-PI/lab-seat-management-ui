'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('browser schedule uses Korea time for viewers in other time zones', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/util.js'), 'utf8');
  const within = vm.runInNewContext(source + '\nisWithinSchedule', { Intl, Date });
  // Sunday 15:30 UTC is Monday 00:30 in Korea.
  const now = new Date('2026-10-04T15:30:00Z');
  assert.equal(within({ days: [1], start: '00:00', end: '01:00' }, now), true);
  assert.equal(within({ days: [0], start: '00:00', end: '01:00' }, now), false);
});
