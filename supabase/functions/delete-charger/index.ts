import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// 충전기 하나를 삭제합니다(상태 이력은 함께 지워짐). 되돌릴 수 없습니다.
//   { chargerId, deleteMapping? }  deleteMapping이 false가 아니면 매핑표(charger_registry)의 항목도 지웁니다.
// 그 지점에 충전기가 하나도 안 남으면 지점도 같이 지웁니다.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { chargerId, deleteMapping } = await req.json();
    if (!chargerId || typeof chargerId !== 'string' || chargerId.length > 40) {
      return json({ error: '충전기 ID를 확인해주세요.' }, 400);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: charger, error: findError } = await supabase
      .from('chargers')
      .select('id, site_id')
      .eq('id', chargerId)
      .maybeSingle();
    if (findError) throw findError;
    if (!charger) return json({ error: '이미 없는 충전기예요.' }, 404);

    const { error: deleteError } = await supabase.from('chargers').delete().eq('id', chargerId);
    if (deleteError) throw deleteError;

    let mappingDeleted = false;
    if (deleteMapping !== false) {
      const { error } = await supabase.from('charger_registry').delete().eq('charger_id', chargerId);
      if (error) throw error;
      mappingDeleted = true;
    }

    let siteDeleted = false;
    if (charger.site_id) {
      const { count, error: countError } = await supabase
        .from('chargers')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', charger.site_id);
      if (countError) throw countError;
      if (count === 0) {
        const { error } = await supabase.from('sites').delete().eq('id', charger.site_id);
        if (error) throw error;
        siteDeleted = true;
      }
    }

    return json({ ok: true, mappingDeleted, siteDeleted });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
