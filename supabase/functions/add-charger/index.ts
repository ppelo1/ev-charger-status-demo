import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 페이지 소스만 보면 누구나 호출은 할 수 있으니, 진짜 접근 제어는 서버 쪽 비밀값(PIN)으로 합니다.
// Supabase 대시보드 Project Settings → Edge Functions → Secrets 에서 ADMIN_PIN을 설정해야 합니다.

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
    const { pin, chargerId, vendor, model, siteId, newSite } = body;

    const adminPin = Deno.env.get('ADMIN_PIN');
    if (!adminPin || pin !== adminPin) {
      return new Response(JSON.stringify({ error: 'PIN이 올바르지 않습니다.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!chargerId || typeof chargerId !== 'string' || chargerId.length > 40) {
      return new Response(JSON.stringify({ error: '충전기 ID를 확인해주세요.' }), {
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

    return new Response(JSON.stringify({ ok: true, siteId: finalSiteId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
