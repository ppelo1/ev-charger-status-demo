import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 버튼에서 바꿀 수 있는 값을 딱 이만큼으로만 제한합니다.
// (테이블 자체는 계속 읽기 전용으로 잠가두고, 쓰기는 이 함수 안에서만 일어납니다.)
const ALLOWED_IDS = ['CP-1', 'CP-2', 'CP-3', 'CP-4', 'CP-5'];
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

    if (!ALLOWED_IDS.includes(id) || !ALLOWED_STATUS.includes(status)) {
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

    const errorCode = status === 'Faulted' ? 'GroundFailure' : 'NoError';
    const { error } = await supabase
      .from('chargers')
      .update({ status, error_code: errorCode, last_seen: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

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
