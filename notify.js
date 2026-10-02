// 관리자 핸드폰으로 알림을 보냅니다. 설정된 채널로만 보내고, 아무것도 없으면 콘솔에만 찍습니다.
//   - ntfy:     NTFY_TOPIC (ntfy 앱을 폰에 설치하고 같은 토픽을 구독하면 푸시 알림이 옴, 계정 불필요)
//   - Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (BotFather로 봇을 만들면 무료)
// 같은 충전기의 같은 종류 알림은 COOLDOWN_MS 안에 다시 보내지 않아서, 연결이 계속 깜빡여도 폰이 울려대지 않습니다.
const COOLDOWN_MS = 60 * 1000;
const lastSent = new Map(); // `${chargerId}:${kind}` -> timestamp

async function send(text) {
  const jobs = [];
  if (process.env.NTFY_TOPIC) {
    const base = process.env.NTFY_SERVER || 'https://ntfy.sh';
    jobs.push(
      fetch(`${base}/${encodeURIComponent(process.env.NTFY_TOPIC)}`, {
        method: 'POST',
        headers: { Title: encodeURIComponent('충전기 알림'), Priority: 'high' },
        body: text,
      })
    );
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
      })
    );
  }
  if (!jobs.length) return;
  const results = await Promise.allSettled(jobs);
  results.forEach((r) => {
    if (r.status === 'rejected') console.error(`[알림] 전송 실패: ${r.reason}`);
    else if (!r.value.ok) console.error(`[알림] 전송 실패: HTTP ${r.value.status}`);
  });
}

// kind: 'fault' | 'offline' | 'recovered'
function notify(chargerId, kind, text) {
  const key = `${chargerId}:${kind}`;
  const now = Date.now();
  if (now - (lastSent.get(key) || 0) < COOLDOWN_MS) return;
  lastSent.set(key, now);
  console.log(`[알림] ${text}`);
  send(text).catch((err) => console.error(`[알림] 전송 실패: ${err}`));
}

module.exports = { notify };
