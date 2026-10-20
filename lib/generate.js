// 이름 생성 핵심 로직 (원본 워드프레스 REST 엔드포인트 kname/v1/generate를 옮긴 것)
// app/api/generate/route.js 에서 호출한다. 서버에서만 실행되며 API 키는 브라우저에 노출되지 않는다.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  LANGS, LANG_LABELS, READING_SCRIPT,
  hasHangul, isValidScript, allowedSyllables, checkCandidate, pickNames, extractJson, shuffle,
} from './kname.js';
import { consume, refund, cacheGet, cacheSet, storeReady, PER_IP_LIMIT } from './store.js';

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
// 비용 절감 설정 (포트폴리오 데모용)
//  - 2차 검증은 요청마다 API를 한 번 더 부르므로 기본 꺼짐 (KNAME_JUDGE=1 이면 켜짐)
//  - 재시도는 최대 2번 (첫 호출 + 후보가 모자랄 때만 1번 더)
const JUDGE = process.env.KNAME_JUDGE === '1';
const MAX_ATTEMPTS = Number(process.env.KNAME_MAX_ATTEMPTS || 2);
const MOCK = process.env.KNAME_MOCK === '1'; // API 없이 화면만 확인할 때

// ── 스킬 파일 (프롬프트 지침) ──
// 코드에 박아두지 않고 skill/ 폴더의 마크다운으로 분리해서 관리한다.
let skillCache = null;
function loadSkill() {
  if (skillCache !== null) return skillCache;
  try {
    // next.config.mjs 의 outputFileTracingIncludes 로 skill 폴더가 함께 배포된다
    const md = readFileSync(join(process.cwd(), 'skill', 'korean-name-generator.md'), 'utf8');
    skillCache = md.replace(/^---[\s\S]*?---\s*/, '').trim(); // 프런트매터 제거
  } catch {
    skillCache = '';
  }
  return skillCache;
}

async function callClaude(system, userMessage, { maxTokens = 400, temperature = 1 } = {}) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const err = new Error(`anthropic ${res.status}`);
    err.code = 'apiError';
    throw err;
  }
  const data = await res.json();
  return data?.content?.[0]?.text || '';
}

// 이름 후보 3개 생성 → 규칙 검증 (탈락이 있으면 호출하는 쪽에서 1번 더 요청)
async function generateCandidates(skill, userMessage, script, allowed) {
  const text = MOCK ? mockReply(script) : await callClaude(skill, userMessage);
  const json = extractJson(text);
  if (!json || !Array.isArray(json.names)) return { names: [], rejected: [], parseFailed: true };

  const names = [];
  const rejected = [];
  for (const raw of json.names) {
    const r = checkCandidate(raw, script, allowed);
    if (r.reject) {
      if (r.ko) rejected.push(r.ko);
    } else names.push(r);
  }
  return { names, rejected, parseFailed: false };
}

// 2차: 규칙은 통과했지만 이름 같지 않은 후보를 AI에게 한 번 더 판정 (실패하면 그냥 통과)
async function judgeNames(koList) {
  if (MOCK || !koList.length) return [];
  const system =
    'You are a strict validator of Korean given names. For each candidate, decide whether it is a real, natural two-syllable Korean given name: one a Korean parent would genuinely give a child, which a Korean reads as an ordinary given name. ' +
    'Mark a candidate BAD if it is (a) a made-up or awkward syllable combination that is not an actual name, (b) a foreign name or word written in Hangul (for example 토마, 케빈), (c) a one-syllable surname plus a one-syllable name that reads like a full name, or (d) an ordinary word that nobody uses as a name. ' +
    'Do not reject common real names, including unisex ones. ' +
    'Reply with JSON only and list only the BAD candidates: {"bad":["..."]}. If all candidates are fine reply {"bad":[]}.';
  try {
    const text = await callClaude(system, `Candidates: ${koList.join(', ')}`, { maxTokens: 200, temperature: 0 });
    const json = extractJson(text);
    if (!json || !Array.isArray(json.bad)) return [];
    const asked = new Set(koList);
    return json.bad.map((b) => String(b).trim()).filter((b) => asked.has(b));
  } catch {
    return [];
  }
}

// 결과는 { status, body } 형태로 돌려주고, HTTP 응답 변환은 route.js 가 맡는다
export async function generateNames(body, ip) {
  body = body || {};

  const lang = LANGS.includes(body.lang) ? body.lang : 'en';
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  const previous = (Array.isArray(body.previous) ? body.previous : [])
    .map((p) => String(p).trim())
    .filter((p) => /^[가-힣]{2}$/.test(p))
    .slice(0, 30);

  // ── 입력 검증 (횟수를 쓰기 전에) ──
  if (!name) return reply(400, { error: 'enterName' });
  if (name.length > 40) return reply(400, { error: 'tooLong' });
  if (hasHangul(name)) return reply(400, { error: 'noKorean' });
  if (!isValidScript(name, lang)) return reply(400, { error: 'wrongScript' });

  if (!MOCK && !API_KEY) return reply(503, { error: 'unavailable' });
  if (!storeReady()) return reply(503, { error: 'unavailable' });

  const skill = loadSkill();
  if (!skill) return reply(500, { error: 'unavailable' });

  // ── IP당 하루 횟수 제한 ──
  let quota;
  try {
    quota = await consume(ip);
  } catch {
    return reply(503, { error: 'unavailable' });
  }
  if (!quota.allowed) {
    return reply(429, { error: quota.reason === 'total' ? 'busy' : 'limitReached', remaining: 0, limit: PER_IP_LIMIT });
  }

  const script = READING_SCRIPT[lang];
  const allowed = allowedSyllables(skill);
  const baseMessage = `Source language: ${LANG_LABELS[lang]}\nName: ${name}\nTarget reading script: ${script}`;

  // ── 후보 캐시: 같은 입력이면 이미 검증된 후보를 재사용 ──
  // 키는 해시라서 사용자가 입력한 이름 원문은 저장되지 않는다.
  const cacheKey = 'kname:pool:' + createHash('md5')
    .update(`${script}|${name.toLowerCase()}|${createHash('md5').update(skill).digest('hex')}|j${JUDGE ? 1 : 0}`)
    .digest('hex');

  let pool = [];
  const seen = new Set();
  const addToPool = (c) => {
    if (seen.has(c.ko)) return false;
    seen.add(c.ko);
    pool.push(c);
    return true;
  };

  const cached = MOCK ? null : await cacheGet(cacheKey);
  if (Array.isArray(cached)) {
    shuffle(cached).forEach((c) => c?.ko && addToPool({ ko: c.ko, ro: c.ro || '' }));
  }

  // 첫 음절이 서로 다른 3개를 우선 고르고, 모자라면 겹치는 후보로 채운다 (추가 호출 없이)
  const pick = () => {
    const distinct = pickNames(pool, previous, 3, false);
    return distinct.length >= 3 ? distinct : pickNames(pool, previous, 3, true);
  };

  // 캐시에 아직 안 보여준 후보가 3개 이상 있으면 API를 부르지 않는다 ("다시 추천받기"도 대부분 여기서 처리)
  let picked = pick();
  let poolChanged = false;
  let lastError = null;
  const rejectedAll = [];

  // 후보가 3개 모일 때까지 최대 MAX_ATTEMPTS번 호출 (후보는 누적)
  for (let attempt = 0; attempt < MAX_ATTEMPTS && picked.length < 3; attempt++) {
    const avoid = [...previous, ...pool.map((c) => c.ko)];
    let msg = baseMessage;
    if (avoid.length) msg += `\n\nPreviously shown names (do NOT use these): ${avoid.join(', ')}`;
    if (rejectedAll.length) {
      msg += `\n\nRejected by the application on the previous try (do NOT repeat these; build names only from the allowed syllable lists): ${rejectedAll.slice(0, 15).join(', ')}`;
    }

    let result;
    try {
      result = await generateCandidates(skill, msg, script, allowed);
    } catch (e) {
      lastError = e.code || 'requestFailed';
      break; // 네트워크·인증 오류는 재시도해도 소용없음
    }
    if (result.parseFailed) {
      lastError = 'parseFailed';
      continue;
    }

    let names = result.names;
    if (JUDGE && names.length) {
      const bad = new Set(await judgeNames(names.map((n) => n.ko)));
      names = names.filter((n) => {
        if (bad.has(n.ko)) { result.rejected.push(n.ko); return false; }
        return true;
      });
    }
    rejectedAll.push(...result.rejected);
    names.forEach((n) => { if (addToPool(n)) poolChanged = true; });
    picked = pick();
  }

  if (!MOCK && poolChanged && pool.length) await cacheSet(cacheKey, pool.slice(0, 30));

  if (!picked.length) {
    await refund(ip).catch(() => {}); // 실패한 요청은 횟수에서 빼준다
    return reply(502, { error: lastError || 'parseFailed', remaining: quota.remaining + 1 });
  }

  return reply(200, {
    names: picked.slice(0, 3).map((n) => ({ ko: n.ko, ro: n.ro || '' })),
    remaining: quota.remaining,
    limit: PER_IP_LIMIT,
  });
}

const reply = (status, body) => ({ status, body });

// ── KNAME_MOCK=1 일 때 쓰는 가짜 응답 (API 비용 없이 화면 확인용) ──
function mockReply(script) {
  const sets = [
    [['하윤', '夏允', 'ハユン'], ['서연', '瑞妍', 'ソヨン'], ['지아', '智雅', 'ジア'], ['예린', '藝琳', 'イェリン'], ['소율', '昭律', 'ソユル'], ['나은', '娜恩', 'ナウン']],
    [['도윤', '道允', 'ドユン'], ['태민', '泰民', 'テミン'], ['준서', '俊瑞', 'ジュンソ'], ['시우', '時雨', 'シウ'], ['현우', '賢宇', 'ヒョヌ'], ['건호', '建浩', 'ゴノ']],
  ];
  const set = sets[Math.floor(Math.random() * sets.length)];
  const idx = script === 'hanzi' ? 1 : script === 'katakana' ? 2 : null;
  return JSON.stringify({ names: shuffle(set).slice(0, 3).map((s) => ({ ko: s[0], ro: idx ? s[idx] : '' })) });
}
