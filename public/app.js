const cardsEl = document.getElementById('cards');
const connStatusEl = document.getElementById('conn-status');
const cards = new Map();

function statusMeta(status) {
  switch (status) {
    case 'Available':
      return { label: '정상 대기', cls: 'ok' };
    case 'Charging':
      return { label: '충전 중', cls: 'ok' };
    case 'Faulted':
      return { label: '고장', cls: 'fault' };
    case 'Unavailable':
      return { label: '사용 불가', cls: 'fault' };
    case 'Offline':
      return { label: '통신 두절', cls: 'offline' };
    default:
      return { label: '알 수 없음', cls: 'offline' };
  }
}

// 데모 충전기(DEMO-n)는 서버 안에서 만든 가짜라서, 카드의 버튼으로 고장 신호를 보내게 할 수 있습니다.
async function demoCall(path, button) {
  const msgEl = document.getElementById('demo-msg');
  if (button) button.disabled = true;
  try {
    const res = await fetch(path, { method: 'POST' });
    const data = await res.json();
    msgEl.textContent = data.error || '';
  } catch {
    msgEl.textContent = '요청에 실패했어요. 잠시 후 다시 눌러보세요.';
  }
  if (button) button.disabled = false;
}

document.getElementById('demo-add').addEventListener('click', (e) => demoCall('/api/demo/charger', e.currentTarget));

function renderCard(charger) {
  let card = cards.get(charger.id);
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-id"></div>
      <div class="card-status"></div>
      <div class="card-meta"></div>
    `;
    if (charger.id.startsWith('DEMO-')) {
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      actions.innerHTML = `
        <button type="button" class="btn btn-fault">고장으로 전환</button>
        <button type="button" class="btn btn-ok">정상으로 복귀</button>
      `;
      const id = encodeURIComponent(charger.id);
      actions.querySelector('.btn-fault').addEventListener('click', (e) => demoCall(`/api/demo/charger/${id}/fault`, e.currentTarget));
      actions.querySelector('.btn-ok').addEventListener('click', (e) => demoCall(`/api/demo/charger/${id}/ok`, e.currentTarget));
      card.appendChild(actions);
    }
    cardsEl.appendChild(card);
    cards.set(charger.id, card);
  }
  const meta = statusMeta(charger.status);
  card.className = `card ${meta.cls}`;
  card.querySelector('.card-id').textContent = charger.id;
  card.querySelector('.card-status').textContent = meta.label;
  const time = charger.lastSeen ? new Date(charger.lastSeen).toLocaleTimeString('ko-KR') : '-';
  card.querySelector('.card-meta').textContent = `${charger.vendor || '미확인'} · 마지막 신호 ${time}`;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/dashboard`);

  ws.onopen = () => {
    connStatusEl.textContent = '서버 연결됨 — 실시간 반영 중';
  };
  ws.onclose = () => {
    connStatusEl.textContent = '연결 끊김, 재연결 시도 중...';
    setTimeout(connect, 2000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'init') {
      msg.chargers.forEach(renderCard);
    } else if (msg.type === 'update') {
      renderCard(msg.charger);
    } else if (msg.type === 'remove') {
      const card = cards.get(msg.id);
      if (card) card.remove();
      cards.delete(msg.id);
    }
  };
}

connect();
