// 사용 횟수 제한과 후보 캐시를 저장하는 곳.
// Vercel 서버리스 함수는 요청마다 다른 인스턴스에서 실행될 수 있어서, 메모리에 세면 제한이 새어 나간다.
// 그래서 배포 환경에서는 Upstash Redis(REST API)를 쓴다. 별도 패키지 없이 fetch로 호출.
// 로컬 개발(npm run dev)에서 Redis 설정이 없으면 메모리로 대신한다.

import { createHash } from 'node:crypto';

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const HAS_REDIS = Boolean(URL_ && TOKEN);

export const PER_IP_LIMIT = Number(process.env.KNAME_DAILY_LIMIT_PER_IP || 10);
// 전체 방문자 합산 하루 상한 (API 비용 안전장치)
export const GLOBAL_LIMIT = Number(process.env.KNAME_DAILY_LIMIT_TOTAL || 100);

const TWO_DAYS = 60 * 60 * 48;
const memory = new Map();

export function storeReady() {
  // 배포 환경(Vercel)인데 Redis가 없으면, 제한이 제대로 걸리지 않으므로 서비스를 막는다.
  return HAS_REDIS || process.env.VERCEL !== '1';
}

async function redis(commands) {
  const res = await fetch(`${URL_.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const data = await res.json();
  return data.map((r) => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
}

// 한국 시간 기준 날짜 (자정에 횟수 초기화)
function todayKST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

// IP 원문은 저장하지 않고 해시만 키로 사용
function ipKey(ip) {
  return createHash('sha256').update(`kname:${ip}`).digest('hex').slice(0, 24);
}

function keys(ip) {
  const day = todayKST();
  return { ipK: `kname:rl:${day}:${ipKey(ip)}`, allK: `kname:rl:${day}:all` };
}

// 1회 사용 처리. 한도를 넘었으면 다시 되돌리고 allowed: false
export async function consume(ip) {
  const { ipK, allK } = keys(ip);
  let used, total;

  if (HAS_REDIS) {
    [used, , total] = await redis([
      ['INCR', ipK], ['EXPIRE', ipK, TWO_DAYS],
      ['INCR', allK], ['EXPIRE', allK, TWO_DAYS],
    ]);
  } else {
    used = (memory.get(ipK) || 0) + 1;
    total = (memory.get(allK) || 0) + 1;
    memory.set(ipK, used);
    memory.set(allK, total);
  }

  const allowed = used <= PER_IP_LIMIT && total <= GLOBAL_LIMIT;
  if (!allowed) await refund(ip);
  return {
    allowed,
    reason: used > PER_IP_LIMIT ? 'ip' : total > GLOBAL_LIMIT ? 'total' : null,
    remaining: Math.max(0, PER_IP_LIMIT - (allowed ? used : used - 1)),
  };
}

// 생성에 실패했을 때는 횟수를 돌려준다
export async function refund(ip) {
  const { ipK, allK } = keys(ip);
  if (HAS_REDIS) {
    await redis([['DECR', ipK], ['DECR', allK]]);
  } else {
    memory.set(ipK, Math.max(0, (memory.get(ipK) || 1) - 1));
    memory.set(allK, Math.max(0, (memory.get(allK) || 1) - 1));
  }
}

// 같은 입력에 대해 검증을 통과한 후보를 30일 동안 저장 (API 비용 절약)
export async function cacheGet(key) {
  try {
    if (HAS_REDIS) {
      const [v] = await redis([['GET', key]]);
      return v ? JSON.parse(v) : null;
    }
    return memory.get(key) || null;
  } catch {
    return null;
  }
}

export async function cacheSet(key, value) {
  try {
    if (HAS_REDIS) await redis([['SET', key, JSON.stringify(value), 'EX', 60 * 60 * 24 * 30]]);
    else memory.set(key, value);
  } catch {
    /* 캐시 실패는 무시 */
  }
}
