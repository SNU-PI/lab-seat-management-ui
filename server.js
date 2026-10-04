'use strict';

const express = require('express');
const path = require('path');
const store = require('./store');
const { koreaTime } = require('./time');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin';
const RESET_HOUR = clampInt(process.env.RESET_HOUR, 0, 23, 2); // 매일 한국 시각 기준 전체 공석

if (process.env.VERCEL && (!ADMIN_KEY || ADMIN_KEY === 'admin')) {
  throw new Error('Set a non-default ADMIN_KEY before deploying');
}

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const read = () => store.read(RESET_HOUR);
const update = (change) => store.update(change, RESET_HOUR);

// ──────────────────────────────────────────────────────────────
// 읽기 API
// ──────────────────────────────────────────────────────────────
app.get('/api/rooms', route(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json((await read()).rooms);
}));

app.get('/api/rooms/:id', route(async (req, res) => {
  const room = (await read()).rooms[req.params.id];
  if (!room) return res.status(404).json({ error: 'room not found' });
  res.set('Cache-Control', 'no-store');
  res.json(room);
}));

// ──────────────────────────────────────────────────────────────
// 어드민 API (배치도 저장)
// ──────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const key = req.get('x-admin-key') || '';
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

const SIMPLE_TYPES = ['door', 'window', 'blocked'];

function validHM(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

// 어드민만 설정하는 이용시간/요일 제한
function sanitizeSchedule(s) {
  if (!s || typeof s !== 'object') return null;
  const days = Array.isArray(s.days)
    ? [...new Set(s.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  const start = validHM(s.start);
  const end = validHM(s.end);
  const dayRestrict = days.length > 0 && days.length < 7;
  if (!dayRestrict && !start && !end) return null;
  return { days: dayRestrict ? days : [], start: start || null, end: end || null };
}

function hmToMin(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; }
function scheduleActive(s) {
  if (!s) return false;
  const dayR = Array.isArray(s.days) && s.days.length > 0 && s.days.length < 7;
  return dayR || hmToMin(s.start) != null || hmToMin(s.end) != null;
}
function isWithinSchedule(s, now) {
  if (!scheduleActive(s)) return true;
  const time = koreaTime(now || new Date());
  if (Array.isArray(s.days) && s.days.length > 0 && s.days.length < 7 && !s.days.includes(time.weekday)) return false;
  const st = hmToMin(s.start), en = hmToMin(s.end);
  if (st == null && en == null) return true;
  const hm = time.hour * 60 + time.minute;
  const a = st == null ? 0 : st, b = en == null ? 1440 : en;
  if (a === b) return true;
  if (a < b) return hm >= a && hm < b;
  return hm >= a || hm < b;
}
function scheduleLabel(s) {
  if (!scheduleActive(s)) return '';
  const D = ['일', '월', '화', '수', '목', '금', '토'];
  const parts = [];
  if (Array.isArray(s.days) && s.days.length > 0 && s.days.length < 7) parts.push(s.days.map(d => D[d]).join('·'));
  if (hmToMin(s.start) != null || hmToMin(s.end) != null) parts.push((s.start || '00:00') + '~' + (s.end || '24:00'));
  return parts.join(' ');
}

// 방 정규화. trustOccupancy=true면 입력의 점유상태를 그대로 사용(백업 복원용),
// false면 같은 번호의 기존 좌석 점유상태를 보존(어드민 배치 저장용).
function normalizeRoom(id, body, prevCells, trustOccupancy) {
  body = body || {};
  const prevByNum = {};
  for (const k in (prevCells || {})) {
    if (prevCells[k].type === 'seat') prevByNum[prevCells[k].number] = prevCells[k];
  }
  const room = {
    name: String(body.name || `연구실 ${id}`).slice(0, 60),
    cols: clampInt(body.cols, 1, 40, 12),
    rows: clampInt(body.rows, 1, 40, 8),
    cells: {}
  };
  const cells = body.cells || {};
  for (const key in cells) {
    const c = cells[key];
    if (!c || !c.type) continue;
    if (c.type === 'seat') {
      const num = String(c.number == null ? '' : c.number).trim();
      if (!num) continue;
      const disabled = !!c.disabled;
      const schedule = sanitizeSchedule(c.schedule);
      const old = prevByNum[num];
      let occupied, occupant, since;
      if (disabled) {
        occupied = false; occupant = null; since = null;
      } else if (trustOccupancy) {
        occupied = !!c.occupied;
        occupant = c.occupant ? String(c.occupant).slice(0, 20) : null;
        since = c.since || null;
      } else {
        occupied = old ? !!old.occupied : false;
        occupant = old ? old.occupant || null : null;
        since = old ? old.since || null : null;
      }
      room.cells[key] = { type: 'seat', number: num, disabled, schedule, occupied, occupant, since };
    } else if (c.type === 'furniture') {
      room.cells[key] = { type: 'furniture', label: String(c.label || '').slice(0, 24) };
    } else if (SIMPLE_TYPES.includes(c.type)) {
      room.cells[key] = { type: c.type };
    }
  }
  return room;
}

app.put('/api/rooms/:id', requireAdmin, route(async (req, res) => {
  const id = req.params.id;
  const { result: room } = await update(data => {
    const prevCells = (data.rooms[id] && data.rooms[id].cells) || {};
    const room = normalizeRoom(id, req.body, prevCells, false);
    data.rooms[id] = room;
    return room;
  });
  res.json(room);
}));

// 전체 백업 내보내기 / 불러오기 (오프라인 저장용)
app.get('/api/export', requireAdmin, route(async (req, res) => {
  res.set('Content-Disposition', 'attachment; filename="lab-seats-backup.json"');
  res.json(await read());
}));
app.post('/api/import', requireAdmin, route(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || !body.rooms || typeof body.rooms !== 'object') {
    return res.status(400).json({ error: '올바른 백업 파일이 아닙니다' });
  }
  const newRooms = {};
  for (const id in body.rooms) newRooms[id] = normalizeRoom(id, body.rooms[id], null, true);
  if (!Object.keys(newRooms).length) return res.status(400).json({ error: '방이 없습니다' });
  await update(data => { data.rooms = newRooms; });
  res.json({ ok: true, rooms: Object.keys(newRooms) });
}));

// 특정 방 전체 공석 처리 (어드민 버튼)
app.post('/api/rooms/:id/clear', requireAdmin, route(async (req, res) => {
  const { result: n } = await update(data => {
    const room = data.rooms[req.params.id];
    if (!room) return null;
    let cleared = 0;
    for (const cell of Object.values(room.cells || {})) {
      if (cell.type === 'seat' && cell.occupied) {
        cell.occupied = false; cell.occupant = null; cell.since = null; cleared++;
      }
    }
    return cleared;
  });
  if (n === null) return res.status(404).json({ error: 'room not found' });
  res.json({ ok: true, cleared: n });
}));

app.put('/api/rooms/:id/name', requireAdmin, route(async (req, res) => {
  const { result: room } = await update(data => {
    const room = data.rooms[req.params.id];
    if (!room) return null;
    room.name = String((req.body || {}).name || room.name).slice(0, 60);
    return room;
  });
  if (!room) return res.status(404).json({ error: 'room not found' });
  res.json(room);
}));

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

// ──────────────────────────────────────────────────────────────
// 좌석 토글 — "특정 주소" 접속 시 착석/공석 전환
//   GET /toggle/:room/:number        (선택: ?name=홍길동)
// ──────────────────────────────────────────────────────────────
app.get('/toggle/:id/:number', route(async (req, res) => {
  const id = req.params.id;
  const num = String(req.params.number);
  let room, seat;
  const { result } = await update(data => {
    room = data.rooms[id];
    if (!room) return 'room-missing';

    seat = Object.values(room.cells).find(c => c.type === 'seat' && c.number === num);
    if (!seat) return 'seat-missing';
    if (seat.disabled) return 'disabled';
    if (!seat.occupied && !isWithinSchedule(seat.schedule, new Date())) return 'closed';

    seat.occupied = !seat.occupied;
    if (seat.occupied) {
      seat.occupant = req.query.name ? String(req.query.name).slice(0, 20) : null;
      seat.since = new Date().toISOString();
    } else {
      seat.occupant = null;
      seat.since = null;
    }
    return 'ok';
  });
  res.set('Cache-Control', 'no-store');
  if (!room) return res.status(404).send(htmlPage('없는 연구실', `<p class="sub">'${esc(id)}' 연구실을 찾을 수 없습니다.</p>`));

  if (result === 'seat-missing') {
    return res.status(404).send(htmlPage('없는 좌석',
      `<p class="sub">${esc(room.name)} 에 ${esc(num)}번 좌석이 없습니다.</p>
       <a class="btn" href="/room/${esc(id)}">현황 보기</a>`));
  }

  if (result === 'disabled') {
    return res.status(403).send(htmlPage('🔒 사용불가 좌석',
      `<p class="sub">${esc(room.name)} · ${esc(num)}번 좌석은 <b>사용불가</b>로 지정되어 있어 착석할 수 없습니다.</p>
       <a class="btn" href="/room/${esc(id)}">현황 보기</a>`));
  }
  // 착석(공석→사용중)만 이용시간 제한 적용. 퇴실(반납)은 언제나 허용.
  if (result === 'closed') {
    return res.status(403).send(htmlPage('🕒 이용 시간이 아닙니다',
      `<p class="sub">${esc(room.name)} · ${esc(num)}번 좌석은 지정된 시간에만 착석할 수 있습니다.</p>
       <p class="sub">이용 가능: <b>${esc(scheduleLabel(seat.schedule))}</b></p>
       <a class="btn" href="/room/${esc(id)}">현황 보기</a>`));
  }
  const state = seat.occupied ? 'occupied' : 'vacant';
  const title = seat.occupied ? '착석 완료' : '퇴실 완료';
  const emoji = seat.occupied ? '🟥' : '🟩';
  const desc = seat.occupied
    ? `${esc(room.name)} · ${esc(num)}번 좌석이 <b>사용 중</b>으로 표시되었습니다.`
    : `${esc(room.name)} · ${esc(num)}번 좌석이 <b>공석</b>으로 표시되었습니다.`;
  const who = seat.occupant ? `<p class="sub">사용자: ${esc(seat.occupant)}</p>` : '';

  res.send(htmlPage(`${emoji} ${title}`,
    `<div class="bignum ${state}">${esc(num)}</div>
     <p class="sub">${desc}</p>
     ${who}
     <p class="hint">같은 주소를 한 번 더 열면 다시 전환됩니다.</p>
     <a class="btn" href="/room/${esc(id)}">📋 ${esc(room.name)} 현황 보기</a>`));
}));

// ──────────────────────────────────────────────────────────────
// 페이지 라우트
// ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/room/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'room.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ──────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function htmlPage(title, inner) {
  return `<!doctype html><html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background:#0f172a; color:#e2e8f0; padding:24px; box-sizing:border-box; }
  .card { background:#1e293b; border:1px solid #334155; border-radius:18px;
    padding:36px 32px; max-width:420px; width:100%; text-align:center;
    box-shadow:0 20px 60px rgba(0,0,0,.45); }
  h1 { margin:0 0 12px; font-size:1.6rem; }
  .sub { color:#cbd5e1; line-height:1.55; margin:8px 0; }
  .hint { color:#94a3b8; font-size:.85rem; margin-top:16px; }
  .bignum { font-size:3.2rem; font-weight:800; width:96px; height:96px; line-height:96px;
    margin:8px auto 16px; border-radius:20px; }
  .bignum.occupied { background:#7f1d1d; color:#fecaca; }
  .bignum.vacant { background:#14532d; color:#bbf7d0; }
  .btn { display:inline-block; margin-top:18px; padding:12px 20px; border-radius:12px;
    background:#3b82f6; color:#fff; text-decoration:none; font-weight:600; }
  .btn:hover { background:#2563eb; }
</style></head>
<body><div class="card"><h1>${title}</h1>${inner}</div></body></html>`;
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(503).json({ error: '데이터 저장소에 연결할 수 없습니다' });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`연구실 자리 관리 시스템: http://${HOST}:${PORT}`);
    console.log('이용시간 및 공석 초기화 기준: Asia/Seoul');
  });
}

module.exports = app;
