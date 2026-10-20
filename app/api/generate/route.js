// POST /api/generate — Next.js Route Handler
// 실제 로직은 lib/generate.js 에 있고, 여기서는 요청/응답 변환만 한다.
import { generateNames } from '../../../lib/generate.js';

export const runtime = 'nodejs'; // 스킬 파일을 읽기 위해 Node 런타임 사용
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // 재시도 + 2차 검증까지 고려한 최대 실행 시간(초)

function clientIp(request) {
  const fwd = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return fwd || request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { status, body: data } = await generateNames(body, clientIp(request));
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
