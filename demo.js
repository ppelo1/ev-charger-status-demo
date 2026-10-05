// 데모용 가짜 충전기를 서버 안에서 만들어, 이 서버의 OCPP 주소로 진짜 WebSocket 접속을 시킵니다.
// 노트북 없이 대시보드의 버튼만으로 "충전기가 접속하고 고장 신호를 보내는" 흐름을 보여주기 위한 것입니다.
// 외부 장비가 접속하는 것이 아니라 서버 내부에서 만든 가짜라는 점에 주의하세요.
const WebSocket = require('ws');

const MAX_DEMO_CHARGERS = 5;
const REPORT_INTERVAL_MS = 8000;

const demos = new Map(); // id -> { ws, forced: null|'Faulted', msgId, timer }

function send(demo, action, payload) {
  if (demo.ws.readyState !== WebSocket.OPEN) return;
  demo.msgId += 1;
  demo.ws.send(JSON.stringify([2, String(demo.msgId), action, payload]));
}

function reportStatus(demo) {
  const faulted = demo.forced === 'Faulted';
  send(demo, 'StatusNotification', {
    connectorId: 1,
    status: faulted ? 'Faulted' : 'Available',
    errorCode: faulted ? 'GroundFailure' : 'NoError',
  });
}

function createDemoCharger(port) {
  if (demos.size >= MAX_DEMO_CHARGERS) return { error: `데모 충전기는 최대 ${MAX_DEMO_CHARGERS}대까지 만들 수 있어요.` };

  let n = 1;
  while (demos.has(`DEMO-${n}`)) n += 1;
  const id = `DEMO-${n}`;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ocpp/${encodeURIComponent(id)}`);
  const demo = { ws, forced: null, msgId: 0, timer: null };
  demos.set(id, demo);

  ws.on('open', () => {
    send(demo, 'BootNotification', { chargePointVendor: 'DemoVendor', chargePointModel: 'DC-50kW (데모)' });
    reportStatus(demo);
    demo.timer = setInterval(() => reportStatus(demo), REPORT_INTERVAL_MS);
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    clearInterval(demo.timer);
    demos.delete(id);
  });
  return { id };
}

function setDemoFault(id, faulted) {
  const demo = demos.get(id);
  if (!demo) return { error: '데모 충전기가 아니거나 이미 종료됐어요.' };
  demo.forced = faulted ? 'Faulted' : null;
  reportStatus(demo); // 8초를 기다리지 않고 바로 신호를 보냅니다.
  return { id };
}

// 삭제된 데모 충전기의 접속을 끊고 더 이상 신호를 보내지 않게 합니다.
function removeDemoCharger(id) {
  const demo = demos.get(id);
  if (!demo) return;
  clearInterval(demo.timer);
  demos.delete(id);
  demo.ws.terminate();
}

module.exports = { createDemoCharger, setDemoFault, removeDemoCharger };
