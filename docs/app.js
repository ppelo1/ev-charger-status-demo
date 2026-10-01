import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// anon 키는 공개되어도 안전하도록 설계된 키입니다(RLS로 접근 범위를 제한).
const SUPABASE_URL = 'https://aopqdrdzpeguxwyzvssp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvcHFkcmR6cGVndXh3eXp2c3NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NzQ5NDcsImV4cCI6MjEwNjE1MDk0N30.gqzc7dwTEGbn1SLoWd4ZVQ72V865GvDJK1LMXZnl57Q';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const cardsEl = document.getElementById('cards');
const connStatusEl = document.getElementById('conn-status');
const searchInput = document.getElementById('search-input');

const chargersById = new Map(); // id -> row
const siteGroupEls = new Map(); // siteName -> { section, title, badge, cardsWrap }
const cardEls = new Map(); // id -> card element
const siteMarkers = new Map(); // siteName -> marker
const knownSites = new Map(); // site_id -> site_name (충전기 추가 폼의 지점 목록용)

const adminToggle = document.getElementById('admin-toggle');
const addChargerForm = document.getElementById('add-charger-form');
const afStatus = document.getElementById('af-status');
const afSiteSelect = document.getElementById('af-site-select');
const afNewSiteFields = document.getElementById('af-new-site-fields');

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

// 그룹 짓는 키는 고유 site_id로 한다 — 이름은 사람이 붙이는 라벨이라 서로 다른
// 지점이 우연히 같은 이름을 쓸 수 있어서, 이름 자체를 키로 쓰면 안 된다.
function siteKey(charger) {
  return charger.site_id || charger.id;
}

function siteLabel(charger) {
  return charger?.site_name || '위치 미등록';
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
        <div>
          <h3 class="site-title"></h3>
          <p class="site-address"></p>
        </div>
        <span class="site-badge"></span>
      </div>
      <div class="site-cards"></div>
    `;
    cardsEl.appendChild(section);
    group = {
      section,
      title: section.querySelector('.site-title'),
      address: section.querySelector('.site-address'),
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
  group.title.textContent = siteLabel(charger);
  if (charger.address) group.address.textContent = charger.address;

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

  const label = siteLabel(chargersInSite[0]);
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
  marker.bindPopup(`<b>${label}</b><br>${popupRows}`);
}

// Realtime으로 오는 건 chargers 테이블 원본 행뿐이라 site_name/address/lat/lng처럼
// sites 테이블에서 join해온 값은 안 들어있습니다. 기존에 캐시해둔 값 위에 덮어써서
// (없는 필드는 그대로 유지되도록) 합칩니다.
function upsertChargerLocal(partial) {
  const prev = chargersById.get(partial.id) || {};
  const charger = { ...prev, ...partial };
  chargersById.set(charger.id, charger);
  if (charger.site_id) {
    knownSites.set(charger.site_id, siteLabel(charger));
    refreshSiteOptions();
  }
  renderCard(charger);
  renderSiteMarker(siteKey(charger));
}

// 지점 이름이나 주소로 검색 — 목록에서 안 맞는 지점은 숨기고, 지도는 맞는 지점들로 이동합니다.
function applySearch(query) {
  const q = query.trim().toLowerCase();
  const matchedCoords = [];

  siteGroupEls.forEach((group, site) => {
    const chargersInSite = getChargersForSite(site);
    const label = siteLabel(chargersInSite[0]).toLowerCase();
    const address = (chargersInSite[0]?.address || '').toLowerCase();
    const matches = !q || label.includes(q) || address.includes(q);
    group.section.style.display = matches ? '' : 'none';
    if (matches) {
      const withLoc = chargersInSite.find((c) => c.lat != null && c.lng != null);
      if (withLoc) matchedCoords.push([withLoc.lat, withLoc.lng]);
    }
  });

  if (matchedCoords.length) {
    map.fitBounds(matchedCoords, { padding: [40, 40], maxZoom: q ? 15 : 13 });
  }
}

searchInput.addEventListener('input', (e) => applySearch(e.target.value));

async function loadInitial() {
  // sites 테이블과 join해서 지점 이름/주소/좌표를 같이 가져옵니다.
  const { data, error } = await supabase
    .from('chargers')
    .select('*, sites(name, address, lat, lng)')
    .order('id');
  if (error) {
    connStatusEl.textContent = `데이터를 불러오지 못했습니다: ${error.message}`;
    return;
  }
  data.forEach((row) => {
    const { sites, ...charger } = row;
    upsertChargerLocal({
      ...charger,
      site_name: sites?.name ?? null,
      address: sites?.address ?? null,
      lat: sites?.lat ?? null,
      lng: sites?.lng ?? null,
    });
  });

  const withLocation = data.filter((c) => c.sites?.lat != null && c.sites?.lng != null);
  if (withLocation.length) {
    map.fitBounds(withLocation.map((c) => [c.sites.lat, c.sites.lng]), { padding: [40, 40], maxZoom: 13 });
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

// 주소 문자열을 위도/경도로 바꿉니다. 지도와 같은 OpenStreetMap 계열(Nominatim)이라
// 별도 API 키가 필요 없습니다.
async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('위치 검색 서버에 연결하지 못했습니다.');
  const results = await res.json();
  if (!results.length) return null;
  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
}

// "+ 충전기 추가" 패널 — SQL Editor 없이 브라우저에서 바로 충전기/지점을 등록합니다.
function refreshSiteOptions() {
  afSiteSelect.innerHTML = '';
  knownSites.forEach((label, id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    afSiteSelect.appendChild(opt);
  });
}

// 단말이 자기가 먼저 접속(BootNotification에 해당)해서 chargers에 올라왔지만 아직 지점이
// 없는 충전기들을 체크박스로 보여줍니다. 실제 설치 때처럼 "단말이 먼저 나타나고, 사람이
// 어느 지점인지 지정"하는 흐름입니다.
const afUnassignedBox = document.getElementById('af-unassigned-box');
const afUnassigned = document.getElementById('af-unassigned');

function refreshUnassigned() {
  const unassigned = [...chargersById.values()].filter((c) => !c.site_id);
  afUnassigned.innerHTML = '';
  afUnassignedBox.hidden = unassigned.length === 0;
  unassigned.forEach((c) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = c.id;
    label.append(cb, ` ${c.id} (${c.vendor || '?'} ${c.model || ''}, ${statusMeta(c.status).label})`);
    afUnassigned.appendChild(label);
  });
}

adminToggle.addEventListener('click', () => {
  if (addChargerForm.hasAttribute('hidden')) {
    refreshSiteOptions();
    refreshUnassigned();
    addChargerForm.removeAttribute('hidden');
  } else {
    addChargerForm.setAttribute('hidden', '');
  }
});

addChargerForm.querySelectorAll('input[name="site-mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const isNew = addChargerForm.querySelector('input[name="site-mode"]:checked').value === 'new';
    afSiteSelect.hidden = isNew;
    afNewSiteFields.hidden = !isNew;
  });
});

addChargerForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const chargerId = document.getElementById('af-id').value.trim();
  const chargerIds = [...afUnassigned.querySelectorAll('input:checked')].map((cb) => cb.value);
  if (!chargerId && chargerIds.length === 0) {
    afStatus.textContent = '지점에 넣을 단말을 선택하거나 충전기 ID를 입력하세요.';
    return;
  }

  const siteMode = addChargerForm.querySelector('input[name="site-mode"]:checked').value;
  const body = {
    chargerId,
    chargerIds,
    vendor: document.getElementById('af-vendor').value.trim(),
    model: document.getElementById('af-model').value.trim(),
  };

  if (siteMode === 'existing') {
    body.siteId = afSiteSelect.value || null;
  } else {
    const address = document.getElementById('af-site-address').value.trim();
    if (!address) {
      afStatus.textContent = '주소를 입력하세요.';
      return;
    }

    afStatus.textContent = '주소로 위치 찾는 중...';
    let coords;
    try {
      coords = await geocodeAddress(address);
    } catch (err) {
      afStatus.textContent = `위치 검색 실패: ${err.message}`;
      return;
    }
    if (!coords) {
      afStatus.textContent = '주소를 찾지 못했습니다. 시/구/도로명까지 더 자세히 입력해보세요.';
      return;
    }

    // name은 안 보내고 서버에서 주소의 도로명+건물번호로 자동으로 짓습니다.
    body.newSite = { address, lat: coords.lat, lng: coords.lng };
  }

  afStatus.textContent = '추가하는 중...';
  const { data, error } = await supabase.functions.invoke('add-charger', { body });

  if (error || data?.error) {
    afStatus.textContent = `실패: ${data?.error || error.message}`;
    return;
  }

  afStatus.textContent = '추가됐습니다.';
  addChargerForm.reset();
  loadInitial();
});

loadInitial();
subscribeRealtime();
