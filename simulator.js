const WebSocket = require('ws');
const readline = require('readline');

const HOST = process.env.HOST || 'ws://localhost:3000';
const CHARGER_IDS = (process.env.CHARGERS || 'CP-1,CP-2,CP-3').split(',').map((s) => s.trim());

const connections = new Map(); // id -> { ws, forced: null|'Faulted', msgId }

function nextId(state) {
  state.msgId += 1;
  return String(state.msgId);
}

function sendStatus(id, status, errorCode = 'NoError') {
  const state = connections.get(id);
  if (!state || state.ws.readyState !== WebSocket.OPEN) return;
  const uid = nextId(state);
  state.ws.send(JSON.stringify([2, uid, 'StatusNotification', { connectorId: 1, status, errorCode }]));
  console.log(`[${id}] StatusNotification → ${status}${errorCode !== 'NoError' ? ` (${errorCode})` : ''}`);
}

function startHeartbeat(id) {
  setInterval(() => {
    const state = connections.get(id);
    if (!state) return;
    const status = state.forced || 'Available';
    const errorCode = state.forced === 'Faulted' ? 'GroundFailure' : 'NoError';
    sendStatus(id, status, errorCode);
  }, 8000);
}

function connectCharger(id) {
  const ws = new WebSocket(`${HOST}/ocpp/${encodeURIComponent(id)}`);
  const state = { ws, forced: null, msgId: 0 };
  connections.set(id, state);

  ws.on('open', () => {
    console.log(`[${id}] 서버에 연결됨, BootNotification 전송`);
    const uid = nextId(state);
    ws.send(JSON.stringify([2, uid, 'BootNotification', { chargePointVendor: 'DemoVendor', chargePointModel: 'DC-50kW' }]));
    startHeartbeat(id);
  });

  ws.on('close', () => {
    console.log(`[${id}] 연결 끊김. 5초 후 재연결 시도`);
    setTimeout(() => connectCharger(id), 5000);
  });

  ws.on('error', () => {});
}

CHARGER_IDS.forEach(connectCharger);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('\n명령어: "CP-1 fault"(고장 처리) / "CP-1 ok"(정상 복귀) / "list"(목록) / "exit"\n');
rl.setPrompt('> ');
rl.prompt();

rl.on('line', (line) => {
  const [rawId, cmd] = line.trim().split(/\s+/);
  if (rawId === 'list') {
    console.log([...connections.keys()].join(', '));
  } else if (rawId === 'exit') {
    process.exit(0);
  } else if (rawId && cmd) {
    const state = connections.get(rawId);
    if (!state) {
      console.log(`알 수 없는 충전기: ${rawId}`);
    } else if (cmd === 'fault') {
      state.forced = 'Faulted';
      sendStatus(rawId, 'Faulted', 'GroundFailure');
    } else if (cmd === 'ok') {
      state.forced = null;
      sendStatus(rawId, 'Available');
    } else {
      console.log('알 수 없는 명령입니다. fault 또는 ok를 사용하세요.');
    }
  }
  rl.prompt();
});
