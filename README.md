# 연구실 자리 관리

연구실 배치도, 좌석 점유 상태, 시간 제한을 관리하는 Express 앱입니다. `seed/rooms.json`에 기존 방 배치도가 들어 있습니다. 저장소가 비어 있을 때 이 파일로 처음 초기화하며, 이후 변경된 상태는 로컬에서는 `data/rooms.json`, Vercel에서는 Upstash Redis에 저장합니다.

## 로컬 실행

Node.js 20 이상을 권장합니다.

```bash
npm ci
ADMIN_KEY='긴-임의의-비밀값' npm start
npm test
```

`http://localhost:3000`에서 현황판, `/admin`에서 배치도 편집기를 볼 수 있습니다. 로컬에서 Upstash 설정 없이 실행하면 Git에 포함되지 않는 `data/rooms.json`을 사용합니다. 로컬에서도 Upstash를 사용하려면 `.env.example`을 참고해 두 Upstash 변수를 프로세스 환경에 설정하세요.

## Upstash와 Vercel 연결

1. [Upstash Console](https://console.upstash.com/)에서 Redis 데이터베이스를 만듭니다. 무료 플랜을 선택하고 Vercel 배포 위치와 가까운 리전을 고르세요. **REST API** 화면의 `UPSTASH_REDIS_REST_URL`과 `UPSTASH_REDIS_REST_TOKEN`을 복사합니다. Redis TCP 주소와 비밀번호가 아니라 REST 값을 사용합니다.
2. Vercel 프로젝트 **Settings → Environment Variables**에서 다음 값을 추가합니다. 실제 운영에 쓰는 **Production**에 반드시 적용하세요. Preview 배포를 테스트할 경우 Preview에도 적용하되, 운영 좌석 상태를 분리하려면 별도의 Upstash 데이터베이스를 연결하세요.

   | 이름 | 값 |
   | --- | --- |
   | `UPSTASH_REDIS_REST_URL` | Upstash REST URL (`https://...upstash.io`) |
   | `UPSTASH_REDIS_REST_TOKEN` | 같은 데이터베이스의 REST 토큰 |
   | `ADMIN_KEY` | `/admin`에서 사용할 긴 임의의 비밀값 |
   | `RESET_HOUR` | 선택 사항. 기본 `2` (한국 시각 02:00) |

3. 환경 변수를 저장한 다음 새 배포를 실행하거나 Redeploy합니다. 이 코드는 Vercel에서 Upstash 변수 둘 다 없거나 하나만 있으면 시작하지 않습니다. 토큰과 관리자 키는 Git이나 브라우저 코드에 넣지 마세요. `TZ`는 Vercel 예약 변수이므로 설정하지 않습니다.
4. 최신 배포 URL의 `/api/rooms`에서 두 방의 JSON이 보이는지 확인합니다. `/toggle/1/18`을 열어 좌석을 전환하고 `/api/rooms/1`을 다시 열어 `occupied` 값이 유지되는지 확인하세요. 좌석 토글 주소는 **열 때마다** 상태가 바뀝니다. `/admin`에서 방 이름 등을 바꾸고 새로고침해도 유지되는지 확인할 수 있습니다.
5. 새 배포가 정상 작동한 후, 쓰지 않는 `BLOB_READ_WRITE_TOKEN` 환경 변수와 Vercel Blob 연결을 정리할 수 있습니다. 이 앱은 더 이상 Blob을 호출하지 않습니다.

**기존 Blob 데이터는 자동으로 옮기지 않습니다.** 새 Redis는 ZIP에서 가져온 `seed/rooms.json`으로 시작합니다. 방 이름과 배치도, 사용 가능 좌석, 시간표의 원래 값은 들어 있지만 Blob에서 최근 일주일 동안 변경한 배치도나 점유 상태는 반영되지 않습니다. 기존 Blob의 사용량 한도가 풀린 뒤 데이터를 복구하려면 **이전 Blob 버전의 배포**에서 `/admin` 백업을 내보낸 다음 새 배포에서 불러와야 합니다.

`/api/rooms`에서 저장소 오류가 나면 환경 변수 이름과 적용 환경, REST 토큰의 유효성, Upstash 데이터베이스 상태, Vercel Runtime Logs를 확인하세요. 변수를 수정한 뒤에는 새로 배포해야 합니다. 이전 배포 URL은 이전 설정을 계속 사용합니다.

## 동작과 운영

- `/`는 전체 현황, `/room/1`과 `/room/2`는 각 방의 현황입니다. 화면이 보이는 동안 1분마다 갱신되며 상단의 새로고침 버튼으로 바로 확인할 수 있습니다.
- `/admin`에서 배치도와 좌석 번호·이용 요일/시간을 수정하고 백업 JSON을 내보내거나 불러올 수 있습니다.
- 같은 좌석 링크를 다시 열면 퇴실 처리됩니다. 좌석 링크를 아는 사람은 누구나 전환할 수 있으므로 링크 공유 범위를 관리하세요.
- 좌석 이용 요일·시간과 매일 `RESET_HOUR` 초기화는 서버 위치와 관계없이 한국 시각(`Asia/Seoul`) 기준입니다. 초기화 시각 이후 첫 요청에서 모든 좌석을 공석으로 돌립니다.
- Redis 키 `lab-seats:state` 하나에 모든 방과 좌석 상태를 저장합니다. 일반 화면 갱신은 Redis `GET` 1회, 실제 변경은 읽기와 원자적 조건부 쓰기를 사용합니다. 충돌하면 최신 상태로 재시도합니다. 월 명령 사용량은 Upstash 콘솔에서 확인하세요.
- `seed/rooms.json`은 Redis 키가 없을 때만 적용됩니다. 배포 후 seed를 수정해도 기존 Redis 데이터는 덮어쓰지 않습니다.
- 로컬 백업 데이터 `data/rooms.json`과 `data/rooms.backup.json`은 저장소에 포함되지 않았습니다. ZIP에 있던 배치도 중 점유자 정보가 비어 있는 `rooms.json`만 seed로 사용했습니다.
