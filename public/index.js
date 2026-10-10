'use strict';

const boards = document.getElementById('boards');
const refreshBtn = document.getElementById('refreshBtn');
let lastFetch = 0;
let loading = false;

async function init() {
  const response = await fetch('/api/rooms', { cache: 'no-store' });
  if (!response.ok) throw new Error('방 목록을 가져올 수 없습니다');
  const rooms = await response.json();
  lastFetch = Date.now();
  boards.innerHTML = '';
  for (const id of Object.keys(rooms)) {
    const board = document.createElement('div');
    board.className = 'board';
    board.innerHTML = `
      <div class="board-head">
        <a class="board-title" href="/room/${id}"><span class="rname">연구실</span> →</a>
        <div class="chips">
          <span class="chip total">좌석 <b>0</b></span>
          <span class="chip used">사용 <b>0</b></span>
          <span class="chip free">공석 <b>0</b></span>
          <span class="chip closed" style="display:none">시간외 <b>0</b></span>
        </div>
      </div>
      <div class="gridbox"><div class="seatgrid mini"></div></div>`;
    boards.appendChild(board);
    board.dataset.roomId = id;
    render(board, rooms[id]);
  }
}

function render(board, room) {
  const gridEl = board.querySelector('.seatgrid');
  board.querySelector('.rname').textContent = room.name;
  const st = renderRoomGrid(gridEl, room, { interactive: false });
  board.querySelector('.chip.total b').textContent = st.total;
  board.querySelector('.chip.used b').textContent = st.used;
  board.querySelector('.chip.free b').textContent = st.free;
  const cl = board.querySelector('.chip.closed');
  if (st.closedNow > 0) { cl.style.display = ''; cl.querySelector('b').textContent = st.closedNow; }
  else cl.style.display = 'none';
}

async function refresh() {
  if (loading) return;
  if (!boards.querySelector('[data-room-id]')) return init();
  loading = true;
  try {
    const response = await fetch('/api/rooms', { cache: 'no-store' });
    if (!response.ok) throw new Error('방 목록을 가져올 수 없습니다');
    const rooms = await response.json();
    lastFetch = Date.now();
    for (const board of boards.querySelectorAll('[data-room-id]')) {
      if (rooms[board.dataset.roomId]) render(board, rooms[board.dataset.roomId]);
    }
  } catch (error) {
    console.error(error);
  } finally {
    loading = false;
  }
}

init().catch(error => { boards.textContent = error.message; });
refreshBtn.addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastFetch >= 60000) refresh();
});
setInterval(() => {
  if (!document.hidden && Date.now() - lastFetch >= 60000) refresh();
}, 60000);
