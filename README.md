# 연구실 자리 관리

연구실 배치도, 좌석 점유 상태, 시간 제한을 관리하는 Express 앱입니다. 기존 배치도는 `seed/rooms.json`에 초기값으로 들어 있습니다. 첫 실행 후 변경된 상태는 로컬에서는 `data/rooms.json`, Vercel에서는 Upstash Redis에 저장됩니다.

## 로컬 실행

Node.js 20 이상을 권장합니다.

```bash
npm ci
ADMIN_KEY='긴-임의의-비밀값' TZ=Asia/Seoul npm start
```

`http://localhost:3000`에서 현황판, `/admin`에서 배치도 편집기를 볼 수 있습니다. `npm test`는 저장·좌석 전환 등 핵심 동작을 확인합니다. 로컬에서 Redis 설정 없이 실행하면 `data/rooms.json`을 사용합니다. 이 파일은 Git에 포함되지 않습니다.

## Vercel 배포

1. 이 저장소를 Vercel에 연결합니다. 루트 디렉터리는 저장소 최상위로 두고 프레임워크는 `Other`를 선택합니다. 별도의 빌드 명령은 필요하지 않습니다.
2. Vercel Marketplace에서 Upstash Redis 데이터베이스를 생성하거나 기존 데이터베이스를 연결합니다.
3. 프로젝트의 Environment Variables에 아래 값을 설정하고 배포합니다.

| 이름 | 설명 |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis의 REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | 같은 데이터베이스의 REST 토큰 |
| `ADMIN_KEY` | 기본값 `admin`이 아닌 긴 임의의 비밀값 |
| `TZ` | `Asia/Seoul` 권장. 요일·이용시간·공석 초기화 시각에 적용 |
| `RESET_HOUR` | 선택 사항. 기본 `2` (현지 시각 02:00) |

Redis URL과 토큰, 어드민 키는 Git에 넣지 마세요. Vercel 환경 변수에 직접 입력하세요. Vercel에서 Redis 설정이나 어드민 키가 없으면 함수가 시작되지 않도록 했습니다. 미리보기와 프로덕션에 서로 다른 Redis를 연결하면 상태가 분리됩니다.

Vercel 배포 뒤 `/api/rooms`에서 JSON 데이터가 보이는지 확인하고, `/admin`에서 키를 입력해 저장한 뒤 새로고침해 변경이 유지되는지 확인하세요. 좌석 링크 `/toggle/<방>/<번호>`를 열면 사용 중과 공석이 전환됩니다.

## 동작과 운영

- `/`는 전체 현황, `/room/1`과 `/room/2`는 각 방의 현황입니다. 화면은 5초마다 최신 상태를 읽습니다.
- `/admin`에서 배치도와 좌석 번호·이용 요일/시간을 수정하고 백업 JSON을 내보내거나 불러올 수 있습니다.
- 같은 좌석 링크를 다시 열면 퇴실 처리됩니다. 좌석 링크를 아는 사람은 누구나 전환할 수 있으므로 링크 공유 범위를 관리하세요.
- 매일 `RESET_HOUR` 이후 첫 요청에서 모든 좌석을 공석으로 돌립니다. 요청이 없는 동안에는 처리하지 않으며 다음 요청에서 적용됩니다.
- Redis의 첫 초기화에만 `seed/rooms.json`을 사용합니다. 배포 후 seed를 수정해도 기존 Redis 데이터는 덮어쓰지 않습니다. 초기 배치도를 다시 적용하려면 `/admin`의 백업 불러오기 기능을 사용하세요.
- 로컬 백업 데이터 `data/rooms.json`과 `data/rooms.backup.json`은 저장소에 포함되지 않았습니다. ZIP에 있던 배치도 중 점유자 정보가 비어 있는 `rooms.json`만 seed로 사용했습니다.
