import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// anon 키는 공개되어도 안전하도록 설계된 키입니다(RLS로 접근 범위를 제한).
const SUPABASE_URL = 'https://aopqdrdzpeguxwyzvssp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvcHFkcmR6cGVndXh3eXp2c3NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NzQ5NDcsImV4cCI6MjEwNjE1MDk0N30.gqzc7dwTEGbn1SLoWd4ZVQ72V865GvDJK1LMXZnl57Q';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const cardsEl = document.getElementById('cards');
const connStatusEl = document.getElementById('conn-status');

const chargersById = new Map(); // id -> row
const siteGroupEls = new Map(); // siteName -> { section, title, badge, cardsWrap }
const cardEls = new Map(); // id -> card element
const siteMarkers = new Map(); // siteName -> marker

const map = L.map('map', { scrollWheelZoom: false }).setView([37.52, 127.0], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);
const markerCluster = L.markerClusterGroup({ maxClusterRadius: 50 });
map.addLayer(markerCluster);

function statusMeta(status) {
  switch (status) {
    case 'Available':
      return { label: '정상 대기', cls: 'ok', color: '#2f8f5b' };
    case 'Charging':
      return { label: '충전 중', cls: 'ok', color: '#2f8f5b' };
    case 'Faulted':
      return { label: '고장', cls: 'fault', color: '#c0392b' };
    case 'Unavailable':
      return { label: '사용 불가', cls: 'fault', color: '#c0392b' };
    case 'Offline':
      return { label: '통신 두절', cls: 'offline', color: '#9a9a90' };
    default:
      return { label: '알 수 없음', cls: 'offline', color: '#9a9a90' };
  }
}

function siteKey(charger) {
  return charger.site_name || '위치 미등록';
}

function getChargersForSite(site) {
  return [...chargersById.values()].filter((c) => siteKey(c) === site);
}

// 사이트 안에 고장이 하나라도 있으면 고장, 아니면 통신 두절이 하나라도 있으면 그걸로,
// 전부 정상이면 정상으로 — 한 지점의 대표 상태를 정한다.
function aggregateMeta(chargersInSite) {
  if (chargersInSite.some((c) => statusMeta(c.status).cls === 'fault')) {
    return { label: '고장 있음', cls: 'fault', color: '#c0392b' };
  }
  if (chargersInSite.some((c) => statusMeta(c.status).cls === 'offline')) {
    return { label: '통신 두절 있음', cls: 'offline', color: '#9a9a90' };
  }
  return { label: '전체 정상', cls: 'ok', color: '#2f8f5b' };
}

function getOrCreateSiteGroup(site) {
  let group = siteGroupEls.get(site);
  if (!group) {
    const section = document.createElement('section');
    section.className = 'site-group';
    section.innerHTML = `
      <div class="site-header">
        <h3 class="site-title"></h3>
        <span class="site-badge"></span>
      </div>
      <div class="site-cards"></div>
    `;
    cardsEl.appendChild(section);
    group = {
      section,
      title: section.querySelector('.site-title'),
      badge: section.querySelector('.site-badge'),
      cardsWrap: section.querySelector('.site-cards'),
    };
    siteGroupEls.set(site, group);
  }
  return group;
}

async function setStatus(id, status, button) {
  button.disabled = true;
  // 테이블에 직접 쓰지 않고, 서버 쪽 Edge Function을 통해서만 상태를 바꿉니다.
  const { error } = await supabase.functions.invoke('set-charger-status', { body: { id, status } });
  button.disabled = false;
  if (error) alert(`상태 변경 실패: ${error.message}`);
}

function renderCard(charger) {
  const group = getOrCreateSiteGroup(siteKey(charger));
  group.title.textContent = siteKey(charger);

  let card = cardEls.get(charger.id);
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
    group.cardsWrap.appendChild(card);
    cardEls.set(charger.id, card);

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

function renderSiteMarker(site) {
  const chargersInSite = getChargersForSite(site);
  const withLoc = chargersInSite.find((c) => c.lat != null && c.lng != null);
  if (!withLoc) return;

  const meta = aggregateMeta(chargersInSite);
  const group = siteGroupEls.get(site);
  if (group) {
    group.badge.textContent = `${meta.label} · ${chargersInSite.length}대`;
    group.badge.className = `site-badge ${meta.cls}`;
  }

  const popupRows = chargersInSite.map((c) => `${c.id} · ${statusMeta(c.status).label}`).join('<br>');

  let marker = siteMarkers.get(site);
  if (!marker) {
    marker = L.circleMarker([withLoc.lat, withLoc.lng], {
      radius: 12,
      weight: 2,
      color: '#fff',
      fillOpacity: 1,
    });
    siteMarkers.set(site, marker);
    markerCluster.addLayer(marker);
  }
  marker.setStyle({ fillColor: meta.color });
  marker.bindPopup(`<b>${site}</b><br>${popupRows}`);
}

function upsertChargerLocal(charger) {
  chargersById.set(charger.id, charger);
  renderCard(charger);
  renderSiteMarker(siteKey(charger));
}

async function loadInitial() {
  const { data, error } = await supabase.from('chargers').select('*').order('id');
  if (error) {
    connStatusEl.textContent = `데이터를 불러오지 못했습니다: ${error.message}`;
    return;
  }
  data.forEach(upsertChargerLocal);

  const withLocation = data.filter((c) => c.lat != null && c.lng != null);
  if (withLocation.length) {
    map.fitBounds(withLocation.map((c) => [c.lat, c.lng]), { padding: [40, 40], maxZoom: 13 });
  }
  connStatusEl.textContent = `실시간 연결됨 — 충전기 ${data.length}대 표시 중. 카드의 버튼으로 직접 상태를 바꿔보세요.`;
}

function subscribeRealtime() {
  supabase
    .channel('chargers-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chargers' }, (payload) => {
      if (payload.new) upsertChargerLocal(payload.new);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        connStatusEl.textContent = '실시간 연결됨 — 카드의 버튼으로 직접 상태를 바꿔보세요.';
      }
    });
}

loadInitial();
subscribeRealtime();
