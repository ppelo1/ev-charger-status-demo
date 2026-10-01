import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 지점 이름을 따로 안 받았으면 주소 맨 앞(시/도)과 끝의 "도로명 + 건물번호"로 자동으로
// 짓습니다. 가운데 구/군은 뺍니다. 예: "서울 강남구 강남대로 396" → "서울 강남대로 396"
function deriveNameFromAddress(address: string): string {
  const tokens = address.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 2) return tokens.join(' ') || address;
  return `${tokens[0]} ${tokens.slice(-2).join(' ')}`;
}

// 공백을 없애고 "서울특별시"를 "서울"로 맞춰서 주소 표기 차이를 줄입니다.
function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, '').replace('서울특별시', '서울');
}

type PresetCharger = { id: string; vendor?: string; model?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { chargerId, chargerIds, vendor, model, siteId, newSite, preview } = body;

    // chargerIds: 단말이 먼저 접속해서 이미 chargers에 올라와 있는(지점 미배정) 충전기들.
    // chargerId: 아직 접속한 적 없는 충전기를 손으로 미리 등록할 때.
    const claimIds: string[] = Array.isArray(chargerIds)
      ? chargerIds.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 40).slice(0, 50)
      : [];
    const hasManualId = chargerId !== undefined && chargerId !== null && chargerId !== '';

    if (hasManualId && (typeof chargerId !== 'string' || chargerId.length > 40)) {
      return new Response(JSON.stringify({ error: '충전기 ID를 확인해주세요.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 새 지점 주소가 address_presets의 도로명+번호와 맞으면, 그 주소에 있는 충전기들을 같이 추가합니다.
    // (데모용 목록입니다. 실제 서비스에서는 공공데이터 API 등으로 대체할 자리입니다.)
    let presetChargers: PresetCharger[] = [];
    if (!siteId && newSite?.address) {
      const normalized = normalizeAddress(String(newSite.address));
      const { data: presets, error: presetError } = await supabase.from('address_presets').select('road_key, chargers');
      if (presetError) throw presetError;
      // "도산대로336"이 "도산대로3360"에 잘못 맞지 않도록 뒤에 숫자가 이어지지 않을 때만 일치로 봅니다.
      const match = (presets ?? []).find((p: { road_key: string }) => {
        const idx = normalized.indexOf(p.road_key);
        return idx >= 0 && !/\d/.test(normalized[idx + p.road_key.length] ?? '');
      });
      if (match) presetChargers = match.chargers as PresetCharger[];
    }

    if (!hasManualId && claimIds.length === 0 && presetChargers.length === 0) {
      return new Response(
        JSON.stringify({ error: '이 주소에 등록된 충전기 정보가 없어요. 단말을 선택하거나 충전기 ID를 입력해주세요.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // preview: 아무것도 쓰지 않고, 이 주소로 추가될 충전기만 알려줍니다(확인 팝업용).
    if (preview) {
      const ids = presetChargers.map((c) => c.id);
      const { data: existingRows, error: existingError } = ids.length
        ? await supabase.from('chargers').select('id').in('id', ids)
        : { data: [], error: null };
      if (existingError) throw existingError;
      const existing = new Set((existingRows ?? []).map((r: { id: string }) => r.id));
      return new Response(
        JSON.stringify({
          ok: true,
          preview: true,
          chargers: presetChargers.map((c) => ({ ...c, exists: existing.has(c.id) })),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let finalSiteId = siteId || null;

    // 기존 지점을 고르지 않았고 새 지점 정보가 왔으면, 지점부터 만듭니다.
    if (!finalSiteId && newSite?.address) {
      const address = String(newSite.address).slice(0, 200);
      const name = newSite.name ? String(newSite.name).slice(0, 100) : deriveNameFromAddress(address);
      const { data: siteRow, error: siteError } = await supabase
        .from('sites')
        .insert({
          name,
          address,
          lat: Number.isFinite(newSite.lat) ? newSite.lat : null,
          lng: Number.isFinite(newSite.lng) ? newSite.lng : null,
        })
        .select('id')
        .single();
      if (siteError) throw siteError;
      finalSiteId = siteRow.id;
    }

    // 접속해 있는 미배정 단말은 새로 만들지 않고 지점만 연결합니다. 이미 다른 지점에 배정된
    // 충전기를 덮어쓰지 않도록 site_id가 비어 있는 것만 대상으로 합니다.
    let claimed: string[] = [];
    if (claimIds.length > 0) {
      const { data: claimedRows, error: claimError } = await supabase
        .from('chargers')
        .update({ site_id: finalSiteId })
        .in('id', claimIds)
        .is('site_id', null)
        .select('id');
      if (claimError) throw claimError;
      claimed = (claimedRows ?? []).map((r: { id: string }) => r.id);
    }

    // 주소에 맞는 충전기들을 지점에 연결해서 만듭니다. 이미 있는 ID는 건드리지 않습니다.
    let added: string[] = [];
    if (presetChargers.length > 0) {
      const now = new Date().toISOString();
      const { data: addedRows, error: presetInsertError } = await supabase
        .from('chargers')
        .upsert(
          presetChargers.map((c) => ({
            id: c.id,
            vendor: c.vendor ?? 'DemoVendor',
            model: c.model ?? 'DC-50kW',
            status: 'Available',
            error_code: 'NoError',
            connector_id: 1,
            connected: true,
            last_seen: now,
            site_id: finalSiteId,
          })),
          { onConflict: 'id', ignoreDuplicates: true }
        )
        .select('id');
      if (presetInsertError) throw presetInsertError;
      added = (addedRows ?? []).map((r: { id: string }) => r.id);
    }

    if (!hasManualId) {
      return new Response(JSON.stringify({ ok: true, siteId: finalSiteId, claimed, added }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: chargerError } = await supabase.from('chargers').insert({
      id: chargerId,
      vendor: vendor ? String(vendor).slice(0, 60) : 'DemoVendor',
      model: model ? String(model).slice(0, 60) : 'DC-50kW',
      status: 'Available',
      error_code: 'NoError',
      connector_id: 1,
      connected: true,
      last_seen: new Date().toISOString(),
      site_id: finalSiteId,
    });
    if (chargerError) throw chargerError;

    return new Response(JSON.stringify({ ok: true, siteId: finalSiteId, claimed, added }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
