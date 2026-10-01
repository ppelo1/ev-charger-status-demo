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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { chargerId, chargerIds, vendor, model, siteId, newSite } = body;

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
    if (!hasManualId && claimIds.length === 0) {
      return new Response(JSON.stringify({ error: '추가할 충전기를 선택하거나 ID를 입력해주세요.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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

    if (!hasManualId) {
      return new Response(JSON.stringify({ ok: true, siteId: finalSiteId, claimed }), {
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

    return new Response(JSON.stringify({ ok: true, siteId: finalSiteId, claimed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
