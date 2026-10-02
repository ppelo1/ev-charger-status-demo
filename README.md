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

### DB에 상태와 고장 이력 저장하기 (선택)

`.env`에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 넣고 `npm start`를 실행하면, 서버가 OCPP로
받은 충전기 상태를 Supabase `chargers`에 저장하고, 상태가 바뀔 때마다 `charger_events`에 한 줄씩
이력을 남깁니다(고장이 언제 났고 언제 복구됐는지 조회 가능). 연결이 끊기면 Offline으로 기록합니다.
키가 없으면 예전처럼 메모리에만 두는 로컬 모드로 동작합니다.

### 고장·통신 두절 알림 (선택)

`server.js`는 충전기가 **고장**나거나 **통신 두절**(연결이 끊기거나 신호가 일정 시간 없음)이 되면,
그리고 거기서 **복구**되면 관리자 핸드폰으로 알림을 보냅니다. `.env`에 아래 중 하나를 채우면 됩니다
(`.env.example` 참고). 아무것도 없으면 콘솔에만 출력합니다.

- **ntfy** (계정 불필요): 폰에 ntfy 앱을 설치하고 `NTFY_TOPIC`과 같은 토픽을 구독합니다.
  토픽 이름은 길고 무작위로 정하세요(이름을 아는 사람은 누구나 알림을 볼 수 있습니다).
- **Telegram** (무료): BotFather로 봇을 만들고 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`를 넣습니다.

같은 충전기의 같은 종류 알림은 1분 안에 다시 보내지 않아서, 연결이 계속 깜빡여도 폰이 울려대지 않습니다.
실제 서비스 수준의 문자(SMS)나 카카오 알림톡은 업체 가입과 발신번호 등록이 필요해서 데모에는 넣지 않았습니다.

### OCPP 서버를 Render에 올리기 (실제 장비 접속용)

화면(`docs/`)은 GitHub Pages에 있지만, 충전기가 접속하는 OCPP 서버(`server.js`)는 항상 켜져 있는
프로그램이라 Render 같은 호스팅이 필요합니다. 저장소에 `render.yaml`이 들어 있습니다.

1. render.com에 GitHub 계정으로 가입하고 이 저장소 접근을 허용합니다.
2. **New → Blueprint**에서 이 저장소를 고르면 `render.yaml`을 읽어 서버 하나를 만듭니다.
3. 환경 변수 입력 화면에서 `SUPABASE_SERVICE_ROLE_KEY`(필수)와, 폰 알림을 쓰려면 `NTFY_TOPIC` 등을 채웁니다.
   이 값들은 저장소에 올리지 말고 Render 화면에서만 입력하세요.
4. 배포가 끝나면 `https://<서비스이름>.onrender.com`이 생깁니다. 충전기(또는 에뮬레이터)의 OCPP 접속
   주소는 `wss://<서비스이름>.onrender.com/ocpp/<충전기ID>` 입니다. 그 주소로 대시보드(`/`)도 열립니다.

무료 플랜은 일정 시간 접속이 없으면 서버가 잠들 수 있어서, 시연 직전에 대시보드 주소를 한 번 열어 깨워 두세요.

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

### 지점(사이트) 관리 — 지도, 검색, 주소

충전기는 이제 `chargers` 테이블 하나가 아니라 **`sites`(지점) 테이블과 `chargers`(충전기)
테이블 둘로 나뉩니다.** 지점 이름/주소/좌표는 `sites`에 있고, `chargers`는 `site_id`로
자기가 어느 지점 소속인지만 가리킵니다. 지점 ID는 사람이 짓는 이름이 아니라 데이터베이스가
자동으로 만들어주는 고유 값(UUID)이라, 서로 다른 두 지점이 이름이 같아도 안 섞입니다.

이걸 켜면: 카드 목록 위에 지도가 뜨고 충전기 위치에 상태별 색깔 핀이 찍히고, 같은 지점에
충전기가 여러 대면 핀 하나에 묶여서 보이고, 가까운 지점끼리는 지도를 축소했을 때 하나로
뭉쳐 보이는 **마커 클러스터링**이 되고, 검색창에 지점 이름/주소를 치면 그 지점으로 지도가
이동합니다. 지도는 별도 API 키 없이 쓸 수 있는 OpenStreetMap 기반입니다.

Supabase SQL Editor에서 아래를 한 번에 실행해주세요 (`sites` 테이블 생성 + 지점 4곳 등록 +
기존 충전기 5대를 각자 지점에 연결까지 한 번에 처리합니다):

```sql
create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  lat double precision,
  lng double precision
);

alter table sites enable row level security;
drop policy if exists sites_public_read on sites;
create policy sites_public_read on sites for select using (true);

alter table chargers drop column if exists site_id;
alter table chargers drop column if exists site_name;
alter table chargers drop column if exists address;
alter table chargers drop column if exists lat;
alter table chargers drop column if exists lng;
alter table chargers add column site_id uuid references sites(id);

with s as (
  insert into sites (name, address, lat, lng) values
    ('강남역 충전소', '서울 강남구 강남대로 396', 37.4979, 127.0276),
    ('홍대입구 충전소', '서울 마포구 양화로 160', 37.5563, 126.9236),
    ('여의도 충전소', '서울 영등포구 여의공원로 68', 37.5219, 126.9245),
    ('신촌 충전소', '서울 서대문구 신촌로 83', 37.5596, 126.9427)
  returning id, name
)
update chargers c set site_id = s.id
from s
where (c.id in ('CP-1', 'CP-4') and s.name = '강남역 충전소')
   or (c.id = 'CP-2' and s.name = '홍대입구 충전소')
   or (c.id = 'CP-3' and s.name = '여의도 충전소')
   or (c.id = 'CP-5' and s.name = '신촌 충전소');
```

(CP-4, CP-5가 아직 없다면 "한 지점에 여러 대" 상황을 보려면 먼저 만들어야 합니다:

```sql
insert into chargers (id, vendor, model, status, error_code, connector_id, connected, last_seen)
values
  ('CP-4', 'DemoVendor', 'DC-50kW', 'Available', 'NoError', 1, true, now()),
  ('CP-5', 'DemoVendor', 'DC-50kW', 'Available', 'NoError', 1, true, now())
on conflict (id) do nothing;
```

이 두 대도 버튼으로 상태를 바꿀 수 있습니다 — `set-charger-status` 함수는 이제 하드코딩된
ID 목록이 아니라 "그 충전기가 실제로 존재하는지"만 확인하기 때문에, 새 충전기를 추가해도
이 함수를 다시 배포할 필요가 없습니다.)

### SQL 없이 브라우저에서 충전기/지점 추가하기

페이지의 **"+ 충전기 추가"** 버튼을 누르면 폼이 열리고, 여기서 충전기 ID와 (기존 지점 선택
또는 새 지점 주소)를 입력해서 추가할 수 있습니다. 새 지점의 이름은 따로 입력받지 않고
주소 맨 앞(시/도)과 끝의 "도로명 + 건물번호"로 자동으로 짓고, 가운데 구/군은 뺍니다
(예: "서울 강남구 강남대로 396" → "서울 강남대로 396"), 위도·경도도 그 주소를 OpenStreetMap의
무료 지오코딩(Nominatim)으로 자동 변환합니다.
SQL Editor나 Table Editor를 열 필요가 없습니다.

이건 `add-charger`라는 새 Edge Function이 처리합니다. 지금은 이 데모 전용이라 PIN 같은
접근 제어 없이 누구나 쓸 수 있게 열어뒀습니다. 나중에 진짜 여러 사람이 쓰는 서비스로 가면
로그인/권한 체계가 이 역할을 대신하게 됩니다.

**함수 배포**: **Edge Functions → Deploy a new function** → 이름 `add-charger` →
`supabase/functions/add-charger/index.ts` 내용을 그대로 붙여넣고 **Deploy**.

기존에 만들어둔 지점 5곳("강남역 충전소" 등)은 이 규칙 이전에 만든 거라 이름이 다릅니다.
같은 방식으로 맞추려면 SQL Editor에서:

```sql
update sites set name = '서울 강남대로 396' where name in ('강남역 충전소', '강남대로 396');
update sites set name = '서울 양화로 160' where name in ('홍대입구 충전소', '양화로 160');
update sites set name = '서울 여의공원로 68' where name in ('여의도 충전소', '여의공원로 68');
update sites set name = '서울 신촌로 83' where name in ('신촌 충전소', '신촌로 83');
update sites set name = '서울 학동로 426' where name in ('강남구청 충전소', '학동로 426');
```

이후 페이지에서 "+ 충전기 추가"를 눌러 PIN과 정보를 입력하면 바로 등록됩니다.

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
- 사용자 로그인, 권한 관리
- 정부 공공데이터 API로 상태를 자동 제출하는 연동
- 실제 충전기 하드웨어와의 연결 (지금은 시뮬레이터로 대체)
- 여러 업체를 구분해서 관리하는 기능(멀티테난트)

즉 이건 "이런 방식으로 작동합니다"를 보여주는 개념 증명(PoC)이고,
실제 서비스로 가려면 위 항목들을 채워 넣는 작업이 추가로 필요합니다.
