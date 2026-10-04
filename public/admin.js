'use strict';

// ── 상태 ──
let roomId = '1';
let model = { name: '연구실 1', cols: 12, rows: 8, cells: {} }; // 편집 중인 로컬 모델
let tool = 'seat';
let painting = false;
let furnitureLabel = '가구';
let loaded = false; // 첫 로드 완료 전 저장 방지 (빈 모델로 덮어쓰기 방지)

const grid = document.getElementById('grid');
const toast = document.getElementById('toast');
const keyInput = document.getElementById('adminKey');
keyInput.value = localStorage.getItem('adminKey') || '';
keyInput.addEventListener('change', () => localStorage.setItem('adminKey', keyInput.value));

// ── 방 탭 ──
async function buildTabs() {
  const rooms = await (await fetch('/api/rooms')).json();
  const tabs = document.getElementById('roomTabs');
  tabs.innerHTML = '';
  for (const id of Object.keys(rooms)) {
    const b = document.createElement('button');
    b.className = 'btn' + (id === roomId ? ' active' : '');
    b.textContent = rooms[id].name;
    b.onclick = () => { roomId = id; loadRoom(); buildTabs(); };
    tabs.appendChild(b);
  }
}

// ── 도구 선택 ──
document.getElementById('tools').addEventListener('click', (e) => {
  const t = e.target.closest('.tool');
  if (!t) return;
  if (t.dataset.tool === 'furniture') {
    const lbl = prompt('가구 이름 (예: 책상, 사물함, 프린터)', furnitureLabel);
    if (lbl !== null && lbl.trim()) furnitureLabel = lbl.trim().slice(0, 24);
  }
  tool = t.dataset.tool;
  document.querySelectorAll('.tool').forEach(x => x.classList.toggle('active', x === t));
});

// ── 데이터 로드 ──
async function loadRoom() {
  loaded = false;
  document.getElementById('saveBtn').disabled = true;
  const r = await (await fetch('/api/rooms/' + roomId)).json();
  model = { name: r.name, cols: r.cols, rows: r.rows, cells: JSON.parse(JSON.stringify(r.cells || {})) };
  document.getElementById('roomNameInput').value = model.name;
  document.getElementById('colsInput').value = model.cols;
  document.getElementById('rowsInput').value = model.rows;
  renderGrid();
  renderLinks();
  loaded = true;
  document.getElementById('saveBtn').disabled = false;
}

function nextSeatNumber() {
  let max = 0;
  for (const k in model.cells) {
    if (model.cells[k].type === 'seat') {
      const n = parseInt(model.cells[k].number, 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return String(max + 1);
}

// ── 그리드 렌더 ──
function renderGrid() {
  grid.style.setProperty('--cols', model.cols);
  grid.style.setProperty('--rows', model.rows);
  grid.innerHTML = '';
  for (let r = 0; r < model.rows; r++) {
    for (let c = 0; c < model.cols; c++) {
      const key = r + ',' + c;
      const cell = model.cells[key];
      const div = document.createElement('div');
      div.className = 'cell ' + classFor(cell);
      div.dataset.key = key;
      div.innerHTML = contentFor(cell);
      grid.appendChild(div);
    }
  }
}

function classFor(cell) {
  if (!cell) return 'empty';
  if (cell.type === 'seat') return cell.disabled ? 'seat disabled' : 'seat ' + (cell.occupied ? 'occupied' : 'vacant');
  return cell.type;
}
function contentFor(cell) {
  if (!cell) return '';
  if (cell.type === 'seat') {
    const clock = (!cell.disabled && hasSchedule(cell.schedule)) ? `<span class="clock">🕒</span>` : '';
    return `<span>${escapeHtml(cell.number)}</span>${clock}` + (cell.disabled ? `<span class="who">사용불가</span>` : '');
  }
  if (cell.type === 'furniture') return `<span class="lbl">${escapeHtml(cell.label || '가구')}</span>`;
  if (cell.type === 'door') return `<span class="lbl">문</span>`;
  if (cell.type === 'window') return `<span class="lbl">창문</span>`;
  return '';
}

// ── 칸 칠하기 ──
function applyTool(key) {
  const cell = model.cells[key];

  if (tool === 'erase') {
    delete model.cells[key];
  } else if (tool === 'edit') {
    if (!cell) return;
    if (cell.type === 'seat') {
      openSeatEditor(key);
      return; // 팝오버에서 처리
    } else if (cell.type === 'furniture') {
      const v = prompt('가구 이름', cell.label || '가구');
      if (v !== null) cell.label = v.trim().slice(0, 24);
    }
  } else if (tool === 'seat') {
    if (cell && cell.type === 'seat') return; // 이미 좌석이면 번호 유지
    model.cells[key] = { type: 'seat', number: nextSeatNumber(), occupied: false, occupant: null, since: null, disabled: false, schedule: null };
  } else if (tool === 'furniture') {
    model.cells[key] = { type: 'furniture', label: furnitureLabel };
  } else if (tool === 'door' || tool === 'window' || tool === 'blocked') {
    model.cells[key] = { type: tool };
  }

  updateCell(key);
}

function updateCell(key) {
  const div = grid.querySelector(`[data-key="${key}"]`);
  if (!div) return;
  const cell = model.cells[key];
  div.className = 'cell ' + classFor(cell);
  div.innerHTML = contentFor(cell);
}

// ── 좌석 편집 모달 (번호 · 사용불가 · 이용시간/요일 제한) ──
function closeSeatEditor() {
  const p = document.getElementById('seatPop');
  if (p) p.remove();
}
function openSeatEditor(key) {
  closeSeatEditor();
  const cell = model.cells[key];
  if (!cell || cell.type !== 'seat') return;

  const sched = cell.schedule || null;
  const selDays = new Set(Array.isArray(sched && sched.days) ? sched.days : []);
  const schedOn = hasSchedule(sched);

  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.id = 'seatPop';
  back.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="pop-title">자리 수정</div>
      <label class="fld">좌석 번호
        <input type="text" id="popNum" maxlength="8" value="${escapeHtml(cell.number)}">
      </label>
      <label class="pop-check">
        <input type="checkbox" id="popDisabled" ${cell.disabled ? 'checked' : ''}>
        사용불가(회색) 좌석 — 착석 불가
      </label>
      <hr class="sep">
      <label class="pop-check">
        <input type="checkbox" id="popSchedEnable" ${schedOn ? 'checked' : ''}>
        ⏰ 이용 시간/요일 제한
      </label>
      <div id="schedBox" class="sched-box" style="${schedOn ? '' : 'display:none'}">
        <div class="sched-label">이용 가능 요일 <span class="muted">(아무것도 안 고르면 매일)</span></div>
        <div class="days" id="popDays">
          ${DAY_NAMES.map((d, i) => `<button type="button" class="day ${selDays.has(i) ? 'on' : ''}" data-d="${i}">${d}</button>`).join('')}
        </div>
        <div class="sched-times">
          <label class="fld">시작 <input type="time" id="popStart" value="${(sched && sched.start) || ''}"></label>
          <label class="fld">종료 <input type="time" id="popEnd" value="${(sched && sched.end) || ''}"></label>
        </div>
        <div class="muted small">예: <b>월~금 09:00~18:00</b> 만 착석 허용. 시간을 비우면 종일. 이 시간 외에는 그 자리에 접속해도 착석되지 않습니다.</div>
      </div>
      <div class="pop-actions">
        <button class="btn" id="popCancel">취소</button>
        <button class="btn primary" id="popOk">확인</button>
      </div>
    </div>`;
  document.body.appendChild(back);

  back.querySelectorAll('#popDays .day').forEach(b => {
    b.onclick = () => {
      const d = +b.dataset.d;
      if (selDays.has(d)) { selDays.delete(d); b.classList.remove('on'); }
      else { selDays.add(d); b.classList.add('on'); }
    };
  });
  const schedEnable = back.querySelector('#popSchedEnable');
  schedEnable.onchange = () => { back.querySelector('#schedBox').style.display = schedEnable.checked ? '' : 'none'; };

  const numInput = back.querySelector('#popNum');
  numInput.focus();
  numInput.select();

  const ok = () => {
    const v = numInput.value.trim().slice(0, 8);
    if (v) cell.number = v;
    cell.disabled = back.querySelector('#popDisabled').checked;
    if (cell.disabled) { cell.occupied = false; cell.occupant = null; cell.since = null; }

    if (schedEnable.checked) {
      const days = [...selDays].sort((a, b) => a - b);
      const start = back.querySelector('#popStart').value || null;
      const end = back.querySelector('#popEnd').value || null;
      const dayRestrict = days.length > 0 && days.length < 7;
      cell.schedule = (!dayRestrict && !start && !end) ? null
        : { days: dayRestrict ? days : [], start, end };
    } else {
      cell.schedule = null;
    }
    updateCell(key);
    renderLinks();
    closeSeatEditor();
  };
  back.querySelector('#popOk').onclick = ok;
  back.querySelector('#popCancel').onclick = closeSeatEditor;
  back.addEventListener('mousedown', (e) => { if (e.target === back) closeSeatEditor(); });
  numInput.onkeydown = (e) => { if (e.key === 'Enter') ok(); else if (e.key === 'Escape') closeSeatEditor(); };
}

// 드래그 페인팅
grid.addEventListener('mousedown', (e) => {
  const div = e.target.closest('.cell');
  if (!div) return;
  e.preventDefault();
  painting = true;
  applyTool(div.dataset.key);
  if (tool === 'seat' || tool === 'edit') { renderLinks(); }
});
grid.addEventListener('mouseover', (e) => {
  if (!painting) return;
  if (tool === 'edit') return; // 편집은 드래그 비활성
  const div = e.target.closest('.cell');
  if (div) applyTool(div.dataset.key);
});
window.addEventListener('mouseup', () => {
  if (painting) { painting = false; renderLinks(); }
});

// 터치 지원 (모바일 한 칸씩)
grid.addEventListener('click', (e) => {
  // 마우스 환경에서는 mousedown이 이미 처리하므로 터치만 보강
}, { passive: true });

// ── 크기 적용 ──
document.getElementById('applySize').onclick = () => {
  const cols = clamp(parseInt(document.getElementById('colsInput').value, 10), 1, 40, model.cols);
  const rows = clamp(parseInt(document.getElementById('rowsInput').value, 10), 1, 40, model.rows);
  // 새 범위 밖 셀 제거
  for (const k in model.cells) {
    const [r, c] = k.split(',').map(Number);
    if (r >= rows || c >= cols) delete model.cells[k];
  }
  model.cols = cols; model.rows = rows;
  renderGrid(); renderLinks();
};

// ── 저장 / 되돌리기 ──
document.getElementById('saveBtn').onclick = async () => {
  if (!loaded) return showToast('배치도를 불러오는 중입니다…', true);
  model.name = document.getElementById('roomNameInput').value.trim() || model.name;
  const key = keyInput.value;
  if (!key) return showToast('어드민 키를 입력하세요', true);
  try {
    const res = await fetch('/api/rooms/' + roomId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify(model)
    });
    if (res.status === 401) return showToast('어드민 키가 올바르지 않습니다', true);
    if (!res.ok) return showToast('저장 실패 (' + res.status + ')', true);
    const saved = await res.json();
    model = { name: saved.name, cols: saved.cols, rows: saved.rows, cells: saved.cells };
    renderGrid(); renderLinks(); buildTabs();
    showToast('저장되었습니다 ✓');
  } catch (err) {
    showToast('네트워크 오류', true);
  }
};
document.getElementById('reloadBtn').onclick = loadRoom;

// ── 이 방 전체 공석 ──
document.getElementById('clearBtn').onclick = async () => {
  const key = keyInput.value;
  if (!key) return showToast('어드민 키를 입력하세요', true);
  if (!confirm(`'${model.name}' 의 모든 좌석을 공석으로 만들까요?`)) return;
  try {
    const res = await fetch('/api/rooms/' + roomId + '/clear', { method: 'POST', headers: { 'x-admin-key': key } });
    if (res.status === 401) return showToast('어드민 키가 올바르지 않습니다', true);
    if (!res.ok) return showToast('실패 (' + res.status + ')', true);
    const j = await res.json();
    await loadRoom();
    showToast(`${j.cleared}석을 공석 처리했습니다 ✓`);
  } catch (_) { showToast('네트워크 오류', true); }
};

// ── 백업 내보내기 (오프라인 저장) ──
document.getElementById('exportBtn').onclick = async () => {
  const key = keyInput.value;
  if (!key) return showToast('어드민 키를 입력하세요', true);
  try {
    const res = await fetch('/api/export', { headers: { 'x-admin-key': key } });
    if (res.status === 401) return showToast('어드민 키가 올바르지 않습니다', true);
    if (!res.ok) return showToast('내보내기 실패', true);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lab-seats-backup.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast('백업 파일을 내려받았습니다 ✓');
  } catch (_) { showToast('네트워크 오류', true); }
};

// ── 백업 불러오기 ──
document.getElementById('importBtn').onclick = () => {
  if (!keyInput.value) return showToast('어드민 키를 입력하세요', true);
  document.getElementById('importFile').click();
};
document.getElementById('importFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!confirm('현재 모든 방의 배치도를 이 백업으로 덮어씁니다. 계속할까요?')) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': keyInput.value },
      body: JSON.stringify(json)
    });
    if (res.status === 401) return showToast('어드민 키가 올바르지 않습니다', true);
    if (!res.ok) { const j = await res.json().catch(() => ({})); return showToast('불러오기 실패: ' + (j.error || res.status), true); }
    await buildTabs();
    await loadRoom();
    showToast('백업을 불러왔습니다 ✓');
  } catch (err) { showToast('파일을 읽을 수 없습니다 (JSON 형식 확인)', true); }
};

// ── 자리 링크 표 ──
function renderLinks() {
  const tbody = document.querySelector('#linksTable tbody');
  tbody.innerHTML = '';
  const seats = [];
  for (const k in model.cells) {
    const c = model.cells[k];
    if (c.type === 'seat') seats.push({ num: c.number, disabled: !!c.disabled, schedule: c.schedule });
  }
  seats.sort((a, b) => (parseInt(a.num, 10) || 0) - (parseInt(b.num, 10) || 0));
  document.getElementById('noSeats').style.display = seats.length ? 'none' : 'block';

  for (const s of seats) {
    const tr = document.createElement('tr');
    if (s.disabled) {
      tr.innerHTML = `<td><b>${escapeHtml(s.num)}</b></td>
        <td class="url muted">— 사용불가 좌석</td>
        <td></td>`;
    } else {
      const url = `${location.origin}/toggle/${encodeURIComponent(roomId)}/${encodeURIComponent(s.num)}`;
      const sched = hasSchedule(s.schedule) ? ` <span class="muted" style="font-family:system-ui">🕒 ${escapeHtml(scheduleLabel(s.schedule))}</span>` : '';
      tr.innerHTML = `<td><b>${escapeHtml(s.num)}</b></td>
        <td class="url">${escapeHtml(url)}${sched}</td>
        <td><button class="btn" data-url="${escapeHtml(url)}">복사</button></td>`;
    }
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('button[data-url]').forEach(b => {
    b.onclick = () => navigator.clipboard?.writeText(b.dataset.url).then(
      () => showToast('주소를 복사했습니다'), () => showToast(b.dataset.url));
  });
}

// ── helpers ──
function clamp(n, min, max, dflt) { if (Number.isNaN(n)) return dflt; return Math.max(min, Math.min(max, n)); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let toastTimer = null;
function showToast(msg, isErr) {
  toast.textContent = msg;
  toast.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.className = 'toast'), 2600);
}

// ── 시작 ──
buildTabs();
loadRoom();
