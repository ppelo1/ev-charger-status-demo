require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 .env 파일에 설정하세요 (.env.example 참고).');
  process.exit(1);
}

// service_role 키는 RLS를 무시하는 관리자 권한입니다. 이 스크립트 밖으로 유출되면 안 됩니다.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CHARGER_IDS = (process.env.CHARGERS || 'CP-1,CP-2,CP-3').split(',').map((s) => s.trim());
const forced = new Map(); // id -> 'Faulted' | undefined

async function upsertStatus(id, status, errorCode = 'NoError') {
  const { error } = await supabase.from('chargers').upsert({
    id,
    vendor: 'DemoVendor',
    model: 'DC-50kW',
    status,
    error_code: errorCode,
    connector_id: 1,
    connected: true,
    last_seen: new Date().toISOString(),
  });
  if (error) console.error(`[${id}] 업데이트 실패:`, error.message);
  else console.log(`[${id}] 상태 → ${status}${errorCode !== 'NoError' ? ` (${errorCode})` : ''}`);
}

async function heartbeatTick() {
  for (const id of CHARGER_IDS) {
    const status = forced.get(id) || 'Available';
    const errorCode = status === 'Faulted' ? 'GroundFailure' : 'NoError';
    await upsertStatus(id, status, errorCode);
  }
}

(async () => {
  console.log(`Supabase(${SUPABASE_URL})로 충전기 ${CHARGER_IDS.length}대 상태를 전송합니다.`);
  await heartbeatTick();
  setInterval(heartbeatTick, 8000);
})();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('\n명령어: "CP-1 fault"(고장 처리) / "CP-1 ok"(정상 복귀) / "list"(목록) / "exit"\n');
rl.setPrompt('> ');
rl.prompt();

rl.on('line', async (line) => {
  const [rawId, cmd] = line.trim().split(/\s+/);
  if (rawId === 'list') {
    console.log(CHARGER_IDS.join(', '));
  } else if (rawId === 'exit') {
    process.exit(0);
  } else if (rawId && cmd) {
    if (!CHARGER_IDS.includes(rawId)) {
      console.log(`알 수 없는 충전기: ${rawId}`);
    } else if (cmd === 'fault') {
      forced.set(rawId, 'Faulted');
      await upsertStatus(rawId, 'Faulted', 'GroundFailure');
    } else if (cmd === 'ok') {
      forced.delete(rawId);
      await upsertStatus(rawId, 'Available');
    } else {
      console.log('알 수 없는 명령입니다. fault 또는 ok를 사용하세요.');
    }
  }
  rl.prompt();
});
