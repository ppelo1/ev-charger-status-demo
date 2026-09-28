import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// anon 키는 공개되어도 안전하도록 설계된 키입니다(RLS로 접근 범위를 제한).
const SUPABASE_URL = 'https://aopqdrdzpeguxwyzvssp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvcHFkcmR6cGVndXh3eXp2c3NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NzQ5NDcsImV4cCI6MjEwNjE1MDk0N30.gqzc7dwTEGbn1SLoWd4ZVQ72V865GvDJK1LMXZnl57Q';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

async function setStatus(id, status, button) {
  button.disabled = true;
  // 테이블에 직접 쓰지 않고, 서버 쪽 Edge Function을 통해서만 상태를 바꿉니다.
  const { error } = await supabase.functions.invoke('set-charger-status', { body: { id, status } });
  button.disabled = false;
  if (error) alert(`상태 변경 실패: ${error.message}`);
}

function renderCard(charger) {
  let card = cards.get(charger.id);
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-id"></div>
      <div class="card-status"></div>
      <div class="card-meta"></div>
      <div class="card-actions">
        <button type="button" class="btn btn-fault">고장으로 전환</button>
        <button type="button" class="btn btn-ok">정상으로 복귀</button>
      </div>
    `;
    cardsEl.appendChild(card);
    cards.set(charger.id, card);

    card.querySelector('.btn-fault').addEventListener('click', (e) => setStatus(charger.id, 'Faulted', e.currentTarget));
    card.querySelector('.btn-ok').addEventListener('click', (e) => setStatus(charger.id, 'Available', e.currentTarget));
  }
  const meta = statusMeta(charger.status);
  card.className = `card ${meta.cls}`;
  card.querySelector('.card-id').textContent = charger.id;
  card.querySelector('.card-status').textContent = meta.label;
  const time = charger.last_seen ? new Date(charger.last_seen).toLocaleTimeString('ko-KR') : '-';
  card.querySelector('.card-meta').textContent = `${charger.vendor || '미확인'} · 마지막 신호 ${time}`;
}

async function loadInitial() {
  const { data, error } = await supabase.from('chargers').select('*').order('id');
  if (error) {
    connStatusEl.textContent = `데이터를 불러오지 못했습니다: ${error.message}`;
    return;
  }
  data.forEach(renderCard);
  connStatusEl.textContent = `실시간 연결됨 — 충전기 ${data.length}대 표시 중. 카드의 버튼으로 직접 상태를 바꿔보세요.`;
}

function subscribeRealtime() {
  supabase
    .channel('chargers-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chargers' }, (payload) => {
      if (payload.new) renderCard(payload.new);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        connStatusEl.textContent = '실시간 연결됨 — 카드의 버튼으로 직접 상태를 바꿔보세요.';
      }
    });
}

loadInitial();
subscribeRealtime();
