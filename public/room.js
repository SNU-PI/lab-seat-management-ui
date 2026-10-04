'use strict';

const roomId = decodeURIComponent(location.pathname.split('/').pop());
const grid = document.getElementById('grid');
const toast = document.getElementById('toast');

document.getElementById('otherRoom').href = '/room/' + (roomId === '1' ? '2' : '1');

function render(room) {
  document.getElementById('roomName').textContent = room.name;
  document.title = room.name + ' 현황';

  const st = renderRoomGrid(grid, room, { interactive: true, onSeatClick: copySeatLink });

  document.getElementById('sTotal').textContent = st.total;
  document.getElementById('sUsed').textContent = st.used;
  document.getElementById('sFree').textContent = st.free;
  const closedStat = document.getElementById('statClosed');
  if (st.closedNow > 0) {
    closedStat.style.display = '';
    document.getElementById('sClosed').textContent = st.closedNow;
  } else {
    closedStat.style.display = 'none';
  }
}

function copySeatLink(num) {
  const url = `${location.origin}/toggle/${encodeURIComponent(roomId)}/${encodeURIComponent(num)}`;
  navigator.clipboard?.writeText(url).then(
    () => showToast(`${num}번 좌석 접속 주소를 복사했습니다`),
    () => showToast(url)
  );
}

let toastTimer = null;
function showToast(msg, isErr) {
  toast.textContent = msg;
  toast.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.className = 'toast'), 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function refresh() {
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('연구실 정보를 가져올 수 없습니다');
    render(await response.json());
    document.getElementById('livePill').textContent = '● 5초마다 갱신';
    document.getElementById('livePill').style.color = '';
  } catch (error) {
    document.getElementById('livePill').textContent = '○ 재연결 중…';
    document.getElementById('livePill').style.color = 'var(--muted)';
  }
}
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
