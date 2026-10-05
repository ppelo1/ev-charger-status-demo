require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { notify } = require('./notify');
const { createDemoCharger, setDemoFault } = require('./demo');
const { ensureSite } = require('./registry');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// 데모용 가짜 충전기 만들기/고장 토글. 시연 기간에만 쓰도록 DEMO_BUTTONS=0이면 끌 수 있습니다.
// 상태를 바꾸는 요청이라 POST만 받습니다.
if (process.env.DEMO_BUTTONS !== '0') {
  const reply = (res, result) => res.status(result.error ? 400 : 200).json(result);
  app.post('/api/demo/charger', (req, res) => reply(res, createDemoCharger(server.address().port)));
  app.post('/api/demo/charger/:id/fault', (req, res) => reply(res, setDemoFault(req.params.id, true)));
  app.post('/api/demo/charger/:id/ok', (req, res) => reply(res, setDemoFault(req.params.id, false)));
}

const server = http.createServer(app);

const chargerWss = new WebSocketServer({ noServer: true });
const dashboardWss = new WebSocketServer({ noServer: true });

// id -> { id, vendor, model, status, errorCode, connectorId, lastSeen, connected }
const chargers = new Map();

// 충전기에게 알려주는 Heartbeat 주기와, 이 주기의 몇 배 동안 아무 신호가 없으면 통신 두절로 볼지.
// 연결(소켓)은 살아 있는데 신호만 멈춘 경우도 잡기 위한 값입니다.
const HEARTBEAT_INTERVAL_SEC = Number(process.env.HEARTBEAT_INTERVAL_SEC) || 30;
const STALE_AFTER_SEC = HEARTBEAT_INTERVAL_SEC * 3;

// Supabase 키가 .env에 있으면 충전기 상태와 상태 변경 이력을 DB에도 저장합니다.
// 없으면 예전처럼 메모리에만 두는 로컬 모드로 동작합니다.
// service_role 키는 RLS를 무시하는 관리자 권한이라 이 서버 밖으로 나가면 안 됩니다.
const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

// 여기서는 site_id를 건드리지 않습니다(접속할 때마다 덮어쓰면 안 됨). 지점은 아래 ensureSite가 매핑표로 정합니다.
async function persistCharger(next, statusChanged) {
  if (!supabase) return;
  const { error } = await supabase.from('chargers').upsert({
    id: next.id,
    vendor: next.vendor,
    model: next.model,
    status: next.status,
    error_code: next.errorCode,
    connector_id: next.connectorId,
    connected: next.connected,
    last_seen: next.lastSeen,
  });
  if (error) {
    console.error(`[DB] ${next.id} 저장 실패: ${error.message}`);
    return;
  }
  // 매핑표에 이 충전기의 설치 주소가 있으면 그 지점에 자동 등록합니다(이미 지점이 있으면 아무것도 안 함).
  ensureSite(supabase, next.id);
  if (statusChanged) {
    const { error: eventError } = await supabase
      .from('charger_events')
      .insert({ charger_id: next.id, status: next.status, error_code: next.errorCode });
    if (eventError) console.error(`[DB] ${next.id} 이력 저장 실패: ${eventError.message}`);
  }
}

function broadcastDashboard(payload) {
  const msg = JSON.stringify(payload);
  for (const client of dashboardWss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

const FAULT_STATUSES = ['Faulted', 'Unavailable'];

// 고장이 나거나 통신이 끊기면, 그리고 거기서 복구되면 관리자에게 알립니다.
// 처음 접속할 때(Unknown → Available)는 알리지 않습니다.
function alertOnChange(prev, next) {
  const wasBad = FAULT_STATUSES.includes(prev.status) || prev.status === 'Offline';
  if (FAULT_STATUSES.includes(next.status)) {
    const code = next.errorCode && next.errorCode !== 'NoError' ? ` (${next.errorCode})` : '';
    notify(next.id, 'fault', `🔴 ${next.id} 고장${code}`);
  } else if (next.status === 'Offline') {
    notify(next.id, 'offline', `⚪ ${next.id} 통신 두절`);
  } else if (wasBad) {
    notify(next.id, 'recovered', `🟢 ${next.id} 복구됨 (${next.status})`);
  }
}

// 연결은 살아 있는데 STALE_AFTER_SEC 동안 아무 메시지도 안 온 충전기를 통신 두절로 바꿉니다.
setInterval(() => {
  const now = Date.now();
  for (const c of chargers.values()) {
    if (c.connected && c.status !== 'Offline' && now - new Date(c.lastSeen).getTime() > STALE_AFTER_SEC * 1000) {
      console.log(`[OCPP] ${c.id} ${STALE_AFTER_SEC}초 동안 신호 없음 → 통신 두절 처리`);
      // 신호가 다시 오면 원래 상태로 되돌릴 수 있게 직전 상태를 기억해 둡니다.
      upsertCharger(c.id, { status: 'Offline', resumeStatus: c.status });
    }
  }
}, 5000).unref();

function upsertCharger(id, patch) {
  const prev = chargers.get(id) || {
    id,
    vendor: null,
    model: null,
    status: 'Unknown',
    errorCode: 'NoError',
    connectorId: 1,
    lastSeen: null,
    connected: false,
  };
  const next = { ...prev, ...patch, lastSeen: new Date().toISOString() };
  chargers.set(id, next);
  broadcastDashboard({ type: 'update', charger: next });
  // 상태나 에러 코드가 바뀐 때만 이력에 한 줄 남깁니다(8초마다 오는 같은 상태는 기록하지 않음).
  const statusChanged = prev.status !== next.status || prev.errorCode !== next.errorCode;
  persistCharger(next, statusChanged);
  if (statusChanged) alertOnChange(prev, next);
  return next;
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/ocpp/')) {
    const id = decodeURIComponent(url.pathname.slice('/ocpp/'.length));
    chargerWss.handleUpgrade(req, socket, head, (ws) => {
      chargerWss.emit('connection', ws, req, id);
    });
  } else if (url.pathname === '/dashboard') {
    dashboardWss.handleUpgrade(req, socket, head, (ws) => {
      dashboardWss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// 충전기(OCPP-J 1.6 최소 구현): BootNotification, StatusNotification, Heartbeat만 처리
chargerWss.on('connection', (ws, req, id) => {
  upsertCharger(id, { connected: true, status: chargers.get(id)?.status || 'Unknown' });
  console.log(`[OCPP] ${id} 연결됨`);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const [messageTypeId, uniqueId, action, payload] = msg;
    if (messageTypeId !== 2) return; // CALL 메시지만 처리

    if (action === 'BootNotification') {
      upsertCharger(id, {
        vendor: payload?.chargePointVendor,
        model: payload?.chargePointModel,
        status: 'Available',
      });
      ws.send(JSON.stringify([3, uniqueId, { status: 'Accepted', currentTime: new Date().toISOString(), interval: HEARTBEAT_INTERVAL_SEC }]));
    } else if (action === 'StatusNotification') {
      upsertCharger(id, {
        status: payload?.status || 'Unknown',
        errorCode: payload?.errorCode || 'NoError',
        connectorId: payload?.connectorId ?? 1,
      });
      ws.send(JSON.stringify([3, uniqueId, {}]));
    } else if (action === 'Heartbeat') {
      // Heartbeat도 "살아 있다"는 신호라 마지막 수신 시각을 갱신하고, 통신 두절이었다면 원래 상태로 되돌립니다.
      const cur = chargers.get(id);
      upsertCharger(id, cur?.status === 'Offline' && cur.resumeStatus ? { status: cur.resumeStatus, resumeStatus: null } : {});
      ws.send(JSON.stringify([3, uniqueId, { currentTime: new Date().toISOString() }]));
    } else {
      ws.send(JSON.stringify([3, uniqueId, {}]));
    }
  });

  ws.on('close', () => {
    upsertCharger(id, { connected: false, status: 'Offline' });
    console.log(`[OCPP] ${id} 연결 끊김 → Offline 처리`);
  });
});

dashboardWss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', chargers: Array.from(chargers.values()) }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(supabase ? 'Supabase 저장: 켜짐 (상태와 이력을 DB에 기록)' : 'Supabase 저장: 꺼짐 (.env에 키가 없어 메모리만 사용)');
  console.log(`대시보드: http://localhost:${PORT}`);
  console.log(`OCPP 접속 주소(시뮬레이터용): ws://localhost:${PORT}/ocpp/{충전기ID}`);
});
