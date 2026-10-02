import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 버튼으로 바꿀 수 있는 상태값을 이 두 가지로만 제한합니다.
// (테이블 자체는 계속 읽기 전용으로 잠가두고, 쓰기는 이 함수 안에서만 일어납니다.)
const ALLOWED_STATUS = ['Available', 'Faulted'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { id, status } = await req.json();

    if (!ALLOWED_STATUS.includes(status)) {
      return new Response(JSON.stringify({ error: '허용되지 않은 값입니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Supabase가 Edge Function 실행 환경에 자동으로 넣어주는 값입니다. 별도 설정이 필요 없습니다.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 새 충전기가 생길 때마다 여기 목록을 손으로 갱신하지 않도록, 하드코딩된 허용
    // 목록 대신 "이미 존재하는 충전기인지"를 직접 확인합니다 — 임의의 id를 새로
    // 만들 수는 없고, 있는 충전기의 상태만 바꿀 수 있다는 보안 범위는 그대로입니다.
    const { data: existing, error: findError } = await supabase
      .from('chargers')
      .select('id, status, error_code')
      .eq('id', id)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing) {
      return new Response(JSON.stringify({ error: '허용되지 않은 값입니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const errorCode = status === 'Faulted' ? 'GroundFailure' : 'NoError';
    const { error } = await supabase
      .from('chargers')
      .update({ status, error_code: errorCode, last_seen: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    // 상태가 실제로 바뀐 경우에만 이력에 한 줄 남깁니다(같은 버튼을 연타해도 중복 기록 안 함).
    if (existing.status !== status || existing.error_code !== errorCode) {
      const { error: eventError } = await supabase
        .from('charger_events')
        .insert({ charger_id: id, status, error_code: errorCode });
      if (eventError) throw eventError;
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
