# HAZZYS 나만의 한글 이름 · 포트폴리오 재현 데모

> 포트폴리오용 재현 데모이며, 실제 이벤트와 무관합니다.

(주)네오엠씨에서 워드프레스로 제작한 헤지스 한글 이름 추천 이벤트 페이지를 Next.js(App Router) + Vercel 구조로 다시 만든 데모입니다.
외국 이름을 입력하면 Claude API가 발음이 비슷한 한글 이름 후보를 만들고, 서버에서 검증한 3개를 추천합니다. 고른 이름은 카드 이미지로 저장할 수 있습니다.

## 원본(워드프레스)과 달라진 점

| 원본 | 이 데모 |
|---|---|
| 코드 스니펫의 REST 엔드포인트 | `app/api/generate/route.js` (Route Handler) + `lib/generate.js` |
| 스킬 파일 `korean-name-generator_v7.md` (후보 6개) | `skill/korean-name-generator.md` (후보 3개, 데모용으로 축약) |
| PHP 검증·로마자 변환 | `lib/kname.js` (원본 PHP와 결과 동일, 6,744개 이름 조합으로 비교 확인) |
| transient 후보 캐시 | Upstash Redis 30일 캐시 |
| nonce | IP당 하루 10회 제한 + 전체 하루 상한 |
| Polylang 언어별 페이지 | 한 페이지에서 언어 탭 전환 (`?lang=zh` 처럼 주소로도 지정 가능) |
| Formidable 폼 이메일 발송 | 카드 이미지 저장 (개인정보 수집 없음) |

## 폴더 구조

```
app/page.js                  페이지 (서버 컴포넌트)
app/KnameApp.js              3단계 화면 ('use client')
app/globals.css              스타일
app/api/generate/route.js    POST /api/generate — 요청/응답 변환만
lib/generate.js              이름 생성 로직 (Claude 호출, 재시도, 2차 검증, 캐시)
lib/kname.js                 검증·로마자 변환·후보 고르기 (서버와 화면이 같이 씀)
lib/store.js                 IP별 횟수 제한, 후보 캐시 (Upstash Redis)
lib/i18n.js                  영어·중국어·일본어 문구
skill/                       프롬프트 지침 파일 (next.config.mjs 에서 배포 번들에 포함)
public/images/               카드 배경, 하트·별 아이콘
tests/                       로직 테스트
```

## Vercel 배포

1. 이 폴더를 새 GitHub 저장소로 올립니다.
2. Vercel에서 **Add New → Project**로 저장소를 가져옵니다. Framework는 Next.js로 자동 인식됩니다.
3. 프로젝트의 **Storage** 탭(또는 Marketplace)에서 **Upstash Redis**를 만들어 이 프로젝트에 연결합니다.
   연결하면 Redis 주소·토큰 환경변수가 자동으로 들어갑니다. (`KV_REST_API_URL` 또는 `UPSTASH_REDIS_REST_URL`, 둘 다 지원)
4. **Settings → Environment Variables**에 `ANTHROPIC_API_KEY`를 추가합니다.
5. **Deployments**에서 Redeploy 합니다.

> 배포 환경에서 Redis가 연결되어 있지 않으면, 횟수 제한이 제대로 걸리지 않기 때문에 API가 동작하지 않도록 막아 두었습니다.

### 비용 안전장치

- IP당 하루 10회 (`KNAME_DAILY_LIMIT_PER_IP`), 한국 시간 자정에 초기화
- 전체 방문자 합산 하루 100회 (`KNAME_DAILY_LIMIT_TOTAL`)
- 한 번 호출로 후보 3개만 받고, 스킬 파일(프롬프트)을 짧게 줄여 입력 토큰을 절약
- 검증된 후보는 30일간 캐시 → 같은 이름을 다른 사람이 넣으면 API 호출 없이 보여줌
- 2차 검증(원본의 judge 호출)은 기본 꺼짐 (`KNAME_JUDGE=1`로 켤 수 있음)
- 유효한 후보가 3개 미만일 때만 1번 더 호출 (최대 2회, `KNAME_MAX_ATTEMPTS`)
- 생성에 실패한 요청은 횟수에서 빼줌
- Anthropic Console에서 월 사용 한도(Spend limit)도 함께 설정해 두는 것을 권장합니다.

## 로컬에서 실행

```bash
npm install
cp .env.example .env    # ANTHROPIC_API_KEY 입력
npm run dev
```

`npm run dev`로 화면과 `/api/generate`가 함께 동작합니다. Redis 설정이 없으면 로컬에서는 메모리로 횟수를 셉니다.
API 비용 없이 화면만 보려면 `.env`에 `KNAME_MOCK=1`을 넣으세요.

```bash
npm test   # 로직·API 테스트
```
