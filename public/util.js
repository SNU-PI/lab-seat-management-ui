'use strict';
// 여러 페이지(index/room/admin)가 공유하는 유틸 — 좌석 그리드 렌더 + 이용시간 판정

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function parseHM(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// schedule = { days:[0..6], start:"HH:MM"|null, end:"HH:MM"|null }  (없으면 항상 이용가능)
function hasSchedule(s) {
  if (!s) return false;
  const dayR = Array.isArray(s.days) && s.days.length > 0 && s.days.length < 7;
  return dayR || parseHM(s.start) != null || parseHM(s.end) != null;
}

function isWithinSchedule(s, now) {
  if (!hasSchedule(s)) return true;
  now = now || new Date();
  // The hosted service uses Korea time for seat schedules, regardless of viewer location.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  if (Array.isArray(s.days) && s.days.length > 0 && s.days.length < 7 && !s.days.includes(day)) return false;
  const st = parseHM(s.start), en = parseHM(s.end);
  if (st == null && en == null) return true;
  const hm = Number(parts.hour) * 60 + Number(parts.minute);
  const a = st == null ? 0 : st;
  const b = en == null ? 1440 : en;
  if (a === b) return true;            // 같으면 종일
  if (a < b) return hm >= a && hm < b; // 일반
  return hm >= a || hm < b;            // 자정 넘김
}

function scheduleLabel(s) {
  if (!hasSchedule(s)) return '';
  const parts = [];
  if (Array.isArray(s.days) && s.days.length > 0 && s.days.length < 7) {
    parts.push([...s.days].sort((a, b) => a - b).map(d => DAY_NAMES[d]).join('·'));
  }
  if (parseHM(s.start) != null || parseHM(s.end) != null) {
    parts.push((s.start || '00:00') + '~' + (s.end || '24:00'));
  }
  return parts.join(' ');
}

// 공유 그리드 렌더러. opts = { interactive, onSeatClick }
// 반환: { total, used, free, closedNow }
function renderRoomGrid(gridEl, room, opts) {
  opts = opts || {};
  gridEl.style.setProperty('--cols', room.cols);
  gridEl.style.setProperty('--rows', room.rows);
  gridEl.innerHTML = '';
  const now = new Date();
  let total = 0, used = 0, free = 0, closedNow = 0;

  for (let r = 0; r < room.rows; r++) {
    for (let c = 0; c < room.cols; c++) {
      const cell = room.cells[r + ',' + c];
      const div = document.createElement('div');

      if (!cell) {
        div.className = 'cell empty';
      } else if (cell.type === 'seat') {
        if (cell.disabled) {
          div.className = 'cell seat disabled';
          div.innerHTML = `<span>${escapeHtml(cell.number)}</span><span class="who">사용불가</span>`;
          div.title = `${cell.number}번 — 사용불가 좌석`;
        } else {
          total++;
          const sched = cell.schedule;
          const scheduled = hasSchedule(sched);
          const open = isWithinSchedule(sched, now);
          const clock = scheduled ? `<span class="clock">🕒</span>` : '';
          const schedTxt = scheduled ? ` · 이용시간 ${scheduleLabel(sched)}` : '';

          if (cell.occupied) {
            used++;
            div.className = 'cell seat occupied';
            div.innerHTML = `<span>${escapeHtml(cell.number)}</span>${clock}` +
              (cell.occupant ? `<span class="who">${escapeHtml(cell.occupant)}</span>` : '');
            div.title = `${cell.number}번 — 사용 중${schedTxt}`;
          } else if (scheduled && !open) {
            closedNow++;
            div.className = 'cell seat closed';
            div.innerHTML = `<span>${escapeHtml(cell.number)}</span>${clock}<span class="who">시간외</span>`;
            div.title = `${cell.number}번 — 현재 이용 불가 (이용시간 ${scheduleLabel(sched)})`;
          } else {
            free++;
            div.className = 'cell seat vacant';
            div.innerHTML = `<span>${escapeHtml(cell.number)}</span>${clock}`;
            div.title = `${cell.number}번 — 공석${schedTxt}`;
          }
          if (opts.interactive) {
            div.style.cursor = 'pointer';
            div.addEventListener('click', () => opts.onSeatClick && opts.onSeatClick(cell.number));
          }
        }
      } else if (cell.type === 'furniture') {
        div.className = 'cell furniture';
        div.innerHTML = `<span class="lbl">${escapeHtml(cell.label || '가구')}</span>`;
      } else if (cell.type === 'door') {
        div.className = 'cell door';
        div.innerHTML = `<span class="lbl">문</span>`;
      } else if (cell.type === 'window') {
        div.className = 'cell window';
        div.innerHTML = `<span class="lbl">창문</span>`;
      } else if (cell.type === 'blocked') {
        div.className = 'cell blocked';
      } else {
        div.className = 'cell empty';
      }
      gridEl.appendChild(div);
    }
  }
  return { total, used, free, closedNow };
}
