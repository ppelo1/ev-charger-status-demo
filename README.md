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

`https://ppelo1.github.io/ev-charger-status-demo/` 페이지를 열면 충전기 카드가 보이고,
**각 카드의 "고장으로 전환" / "정상으로 복귀" 버튼을 누르면 그 자리에서 바로 상태가 바뀝니다.**
git clone도, npm도, 터미널도 필요 없습니다 — 브라우저만 있으면 됩니다.

테이블 자체는 계속 읽기 전용으로 잠겨 있고, 실제 쓰기는 `supabase/functions/set-charger-status`
라는 서버 쪽 함수 안에서만 일어납니다(브라우저에 쓰기 권한을 열어주지 않는 방식). 이 함수를
Supabase에 한 번 배포해야 버튼이 동작합니다.

**Edge Function 배포 방법 (대시보드에서, 터미널 없이)**
1. Supabase 대시보드 왼쪽 메뉴 **Edge Functions** → **Deploy a new function**
2. 함수 이름: `set-charger-status`
3. `supabase/functions/set-charger-status/index.ts` 파일 내용을 그대로 복사해서 에디터에 붙여넣기
4. **Deploy** 클릭

(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 함수 실행 환경에 자동으로 넣어주므로
별도로 설정할 필요가 없습니다.)

GitHub Pages 활성화 방법: 저장소 **Settings → Pages → Source: Deploy from a branch →
Branch: main, Folder: /docs → Save**.

### 지도에 위치 표시하기

카드 목록 위에 지도가 뜨고, 충전기 위치에 상태별 색깔로 핀이 찍힙니다. 이걸 켜려면
Supabase SQL Editor에서 아래를 한 번 실행해서 위치 컬럼을 추가하고 데모용 좌표를 넣어주세요.

```sql
alter table chargers add column if not exists site_name text;
alter table chargers add column if not exists lat double precision;
alter table chargers add column if not exists lng double precision;

update chargers set site_name = '강남역 충전소', lat = 37.4979, lng = 127.0276 where id = 'CP-1';
update chargers set site_name = '홍대입구 충전소', lat = 37.5563, lng = 126.9236 where id = 'CP-2';
update chargers set site_name = '여의도 충전소', lat = 37.5219, lng = 126.9245 where id = 'CP-3';
```

지도는 별도 API 키 없이 쓸 수 있는 OpenStreetMap 기반이라 추가 가입 없이 바로 동작합니다.

### 한 지점에 충전기가 여러 대거나, 지점이 여러 곳으로 가까이 있을 때

충전기를 사이트(지점) 단위로 묶어서 핀 하나로 보여주고(그 안에 몇 대가 있는지, 그중 고장이
있는지 배지로 표시), 지점끼리 가까우면 지도를 축소했을 때 핀들을 숫자 배지 하나로 뭉쳐서
보여주는 **마커 클러스터링**이 이미 코드에 들어가 있습니다. 이걸 실제로 확인해보려면
충전기 2대를 더 추가해서 "한 지점에 2대", "서로 가까운 두 지점" 상황을 만들어보세요.

```sql
insert into chargers (id, vendor, model, status, error_code, connector_id, connected, last_seen)
values
  ('CP-4', 'DemoVendor', 'DC-50kW', 'Available', 'NoError', 1, true, now()),
  ('CP-5', 'DemoVendor', 'DC-50kW', 'Available', 'NoError', 1, true, now())
on conflict (id) do nothing;

-- CP-4는 CP-1과 같은 강남역 충전소 → 핀 하나에 2대가 묶여서 보임
update chargers set site_name = '강남역 충전소', lat = 37.4979, lng = 127.0276 where id = 'CP-4';

-- CP-5는 홍대입구 바로 옆 신촌 충전소 → 지도를 축소하면 두 지점 핀이 하나로 뭉쳐짐
update chargers set site_name = '신촌 충전소', lat = 37.5596, lng = 126.9427 where id = 'CP-5';
```

CP-4, CP-5도 버튼으로 상태를 바꿀 수 있게 하려면, `supabase/functions/set-charger-status/index.ts`의
`ALLOWED_IDS` 목록이 이미 `CP-4`, `CP-5`까지 포함해서 갱신되어 있으니, Supabase 대시보드에서
**Edge Functions → set-charger-status → 코드 편집 → 새 내용 붙여넣기 → Deploy**로 다시 배포해주세요.

### (선택) 터미널로 자동 시뮬레이션

버튼 클릭 대신, 충전기가 스스로 주기적으로 상태를 보고하는 모습까지 보여주고 싶다면
`simulator-supabase.js`로 자동 시뮬레이션도 가능합니다:

```bash
npm install
cp .env.example .env   # SUPABASE_SERVICE_ROLE_KEY 채우기
npm run simulate:web
```

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
