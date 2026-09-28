# 충전기 상태 모니터링 데모

전기차 충전기가 표준 프로토콜(OCPP)로 보내는 "지금 이런 상태야" 신호를 서버가 받아서,
실시간 대시보드에 정상/고장 상태로 보여주는 최소 데모입니다.

실제 충전기 대신 가짜 충전기(시뮬레이터)를 여러 대 띄워서 동작을 재현합니다.

## 구성

두 가지 버전이 있습니다. 원리는 같고, 실행 장소만 다릅니다.

- **로컬 OCPP 버전** (`server.js` + `simulator.js` + `public/`) — 실제 OCPP 메시지(BootNotification,
  StatusNotification)를 주고받는 완전한 형태. 로컬에서만 실행됩니다.
- **웹 공유 버전** (`simulator-supabase.js` + `docs/`) — 자체 서버 대신 Supabase를 상태 저장소로
  써서, GitHub Pages에 올려 URL로 공유할 수 있게 만든 버전. OCPP 메시지 자체는 안 나오고,
  "충전기 상태가 바뀌면 화면에 바로 반영된다"는 핵심 동작만 재현합니다.

## 실행 방법 (로컬 OCPP 버전)

```bash
npm install

# 터미널 1: 서버 실행
npm start

# 터미널 2: 가짜 충전기 3대 실행
npm run simulate
```

브라우저에서 http://localhost:3000 접속하면 충전기 3대(CP-1, CP-2, CP-3) 카드가 보입니다.

## 라이브 데모 시나리오

`npm run simulate`를 실행한 터미널에 다음처럼 입력하면 그 즉시 대시보드에 반영됩니다.

```
> CP-2 fault
> CP-2 ok
```

- `CP-2 fault` — CP-2를 고장 상태로 전환 (카드가 빨간색으로 바뀜)
- `CP-2 ok` — CP-2를 정상 상태로 복귀

미팅 자리에서 "지금 이 충전기가 고장났다고 신호를 보내면" 하고 직접 입력해서 보여주면 됩니다.

## 웹 공유 버전 (URL로 보여주기)

Supabase 프로젝트를 만들고 `.env.example`을 참고해 `.env` 파일에 키 값을 채운 뒤:

```bash
npm install
npm run simulate:web
```

이렇게 하면 이 컴퓨터에서 Supabase로 상태를 계속 보내고, GitHub Pages에 올라간
`docs/index.html`을 누구든 열어보면 실시간으로 같이 반영됩니다. 로컬 OCPP 버전과 마찬가지로
`CP-1 fault` / `CP-1 ok` 명령으로 라이브 시연이 가능합니다.

GitHub Pages 활성화 방법: 저장소 **Settings → Pages → Source: Deploy from a branch →
Branch: main, Folder: /docs → Save**.

## 이 데모가 보여주는 것 / 보여주지 않는 것

**보여주는 것**: 충전기가 표준 프로토콜(OCPP)로 상태 신호를 보내면, 그걸 받아서 대시보드에
실시간으로 반영하는 핵심 동작 원리.

**보여주지 않는 것(다음 단계에서 채울 부분)**:
- 여러 업체/여러 지점을 구분해서 관리하는 기능
- 사용자 로그인, 권한 관리
- 정부 공공데이터 API로 상태를 자동 제출하는 연동
- 실제 충전기 하드웨어와의 연결 (지금은 시뮬레이터로 대체)

즉 이건 "이런 방식으로 작동합니다"를 보여주는 개념 증명(PoC)이고,
실제 서비스로 가려면 위 항목들을 채워 넣는 작업이 추가로 필요합니다.
