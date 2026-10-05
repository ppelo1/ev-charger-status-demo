// 충전기 ID ↔ 주소 매핑표(charger_registry)로, 신호를 보낸 충전기를 자동으로 그 주소의 지점에 등록합니다.
// 신호 자체에는 위치 정보가 없으므로, 업체가 알려준 "충전기 ID와 설치 주소"를 미리 등록해 두는 것이 전제입니다.
const RECHECK_MS = 30 * 1000; // 매핑표에 없던 충전기는 이 간격으로 다시 찾아봅니다(나중에 매핑이 추가돼도 반영되도록).

const assigned = new Set(); // 지점이 이미 정해진 충전기 id
const lastChecked = new Map(); // id -> 마지막으로 매핑표를 찾아본 시각
const siteLocks = new Map(); // 정규화한 주소 -> 지점 생성 중인 Promise (같은 주소 동시 생성 방지)

function normalize(address) {
  return address.replace(/\s+/g, '').replace('서울특별시', '서울');
}

// 주소의 맨 앞(시/도)과 끝의 "도로명 + 건물번호"로 지점 이름을 짓습니다. 예: "서울 강남구 도산대로 336" → "서울 도산대로 336"
function deriveName(address) {
  const tokens = address.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 2) return tokens.join(' ') || address;
  return `${tokens[0]} ${tokens.slice(-2).join(' ')}`;
}

// 지도에 핀을 찍을 좌표를 OpenStreetMap(Nominatim)에서 찾습니다. 실패하면 좌표 없이 지점만 만듭니다.
async function geocode(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'ev-charger-status-demo/1.0' } });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch {
    return null;
  }
}

async function findOrCreateSite(supabase, address) {
  const key = normalize(address);
  const pending = siteLocks.get(key);
  if (pending) return pending;

  const job = (async () => {
    const { data: sites, error } = await supabase.from('sites').select('id, address');
    if (error) throw error;
    const existing = (sites || []).find((s) => s.address && normalize(s.address) === key);
    if (existing) return existing.id;

    const coords = await geocode(address);
    const { data: created, error: insertError } = await supabase
      .from('sites')
      .insert({ name: deriveName(address), address, lat: coords?.lat ?? null, lng: coords?.lng ?? null })
      .select('id')
      .single();
    if (insertError) throw insertError;
    console.log(`[지점] ${address} 지점 자동 생성${coords ? '' : ' (좌표를 못 찾아 지도 핀 없음)'}`);
    return created.id;
  })();

  siteLocks.set(key, job);
  try {
    return await job;
  } finally {
    siteLocks.delete(key);
  }
}

// 충전기 id로 매핑표를 찾아서, 주소가 있으면 그 지점에 붙입니다. 이미 지점이 있는 충전기는 건드리지 않습니다.
async function ensureSite(supabase, chargerId) {
  if (!supabase || assigned.has(chargerId)) return;
  const now = Date.now();
  if (now - (lastChecked.get(chargerId) || 0) < RECHECK_MS) return;
  lastChecked.set(chargerId, now);

  try {
    const { data: row, error } = await supabase.from('chargers').select('site_id').eq('id', chargerId).maybeSingle();
    if (error) throw error;
    if (row?.site_id) {
      assigned.add(chargerId);
      return;
    }

    const { data: mapping, error: mapError } = await supabase
      .from('charger_registry')
      .select('address')
      .eq('charger_id', chargerId)
      .maybeSingle();
    if (mapError) throw mapError;
    if (!mapping) return; // 매핑표에 없는 충전기는 미등록 상태로 둡니다.

    const siteId = await findOrCreateSite(supabase, mapping.address);
    const { error: updateError } = await supabase
      .from('chargers')
      .update({ site_id: siteId })
      .eq('id', chargerId)
      .is('site_id', null);
    if (updateError) throw updateError;
    assigned.add(chargerId);
    console.log(`[지점] ${chargerId} → ${mapping.address} 에 자동 등록`);
  } catch (err) {
    console.error(`[지점] ${chargerId} 자동 등록 실패: ${err.message || err}`);
  }
}

// 충전기가 삭제되거나 새로 접속할 때 "이미 배정됨/방금 확인함" 기억을 지워서, 다음 신호에서 매핑표를 다시 보게 합니다.
// 이걸 안 지우면 삭제했다가 다시 만든 충전기가 예전 배정 기억 때문에 지점이 안 붙습니다.
function forget(chargerId) {
  assigned.delete(chargerId);
  lastChecked.delete(chargerId);
}

module.exports = { ensureSite, forget };
