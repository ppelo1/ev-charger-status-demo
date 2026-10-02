require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

const chargerWss = new WebSocketServer({ noServer: true });
const dashboardWss = new WebSocketServer({ noServer: true });

// id -> { id, vendor, model, status, errorCode, connectorId, lastSeen, connected }
const chargers = new Map();

// Supabase 키가 .env에 있으면 충전기 상태와 상태 변경 이력을 DB에도 저장합니다.
// 없으면 예전처럼 메모리에만 두는 로컬 모드로 동작합니다.
// service_role 키는 RLS를 무시하는 관리자 권한이라 이 서버 밖으로 나가면 안 됩니다.
const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

// site_id는 건드리지 않습니다(지점 배정은 사람이 하므로, 접속할 때마다 덮어쓰면 안 됨).
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
      ws.send(JSON.stringify([3, uniqueId, { status: 'Accepted', currentTime: new Date().toISOString(), interval: 300 }]));
    } else if (action === 'StatusNotification') {
      upsertCharger(id, {
        status: payload?.status || 'Unknown',
        errorCode: payload?.errorCode || 'NoError',
        connectorId: payload?.connectorId ?? 1,
      });
      ws.send(JSON.stringify([3, uniqueId, {}]));
    } else if (action === 'Heartbeat') {
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
