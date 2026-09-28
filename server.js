const express = require('express');
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
  console.log(`대시보드: http://localhost:${PORT}`);
  console.log(`OCPP 접속 주소(시뮬레이터용): ws://localhost:${PORT}/ocpp/{충전기ID}`);
});
