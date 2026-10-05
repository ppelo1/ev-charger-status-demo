import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// 충전기 ID ↔ 설치 주소 매핑표(charger_registry)를 관리합니다.
// 충전기가 신호를 보내면 OCPP 서버가 이 표로 주소를 찾아 해당 지점에 자동 등록합니다.
//   { mappings: [{ chargerId, address }, ...] }  → 등록/수정(같은 ID는 주소를 덮어씀)
//   { list: true }                               → 지금 등록된 매핑 목록
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (body.list) {
      const { data, error } = await supabase
        .from('charger_registry')
        .select('charger_id, address')
        .order('charger_id');
      if (error) throw error;
      return json({ ok: true, mappings: data });
    }

    const input = Array.isArray(body.mappings) ? body.mappings : [];
    if (input.length === 0 || input.length > 200) {
      return json({ error: '등록할 매핑을 1~200줄 사이로 입력해주세요.' }, 400);
    }

    const rows: { charger_id: string; address: string }[] = [];
    for (const m of input) {
      const chargerId = typeof m?.chargerId === 'string' ? m.chargerId.trim() : '';
      const address = typeof m?.address === 'string' ? m.address.trim() : '';
      if (!chargerId || chargerId.length > 40 || !address || address.length > 200) {
        return json({ error: `형식이 올바르지 않은 줄이 있어요: ${chargerId || '(ID 없음)'}` }, 400);
      }
      rows.push({ charger_id: chargerId, address });
    }

    const { error } = await supabase.from('charger_registry').upsert(rows, { onConflict: 'charger_id' });
    if (error) throw error;
    return json({ ok: true, count: rows.length });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
