// 원본 워드프레스 스니펫(kname-snippet.php)의 검증·변환 로직을 JS로 옮긴 파일.
// 서버(api/generate.js)와 화면(src/App.vue)이 같은 규칙을 쓰도록 한 곳에서 관리한다.

const HANGUL_RE = /[가-힣ㄱ-ㆎ]/;
const HIRAGANA_RE = /[぀-ゟ]/;
const KATAKANA_RE = /[゠-ヿ]/;
const HAN_RE = /[一-鿿]/;
const LATIN_RE = /[A-Za-z]/;

export const LANGS = ['en', 'zh', 'ja'];
export const LANG_LABELS = { en: 'English', zh: 'Chinese', ja: 'Japanese' };
export const READING_SCRIPT = { en: 'english-romanization', zh: 'hanzi', ja: 'katakana' };

export function hasHangul(str) {
  return HANGUL_RE.test(str);
}

// 페이지 언어(en/zh/ja)에 맞는 문자로만 이루어져 있는지 검사
export function isValidScript(name, lang) {
  const hangul = HANGUL_RE.test(name);
  const hira = HIRAGANA_RE.test(name);
  const kata = KATAKANA_RE.test(name);
  const han = HAN_RE.test(name);
  const latin = LATIN_RE.test(name);

  if (lang === 'en') return !(hangul || hira || kata || han) && latin;
  if (lang === 'zh') return !(latin || hangul || hira || kata) && han;
  if (lang === 'ja') return !(latin || hangul) && (han || hira || kata);
  return true;
}

// 한글 → 로마자 (국어의 로마자 표기법 + 실제로 널리 쓰는 표기 일부 반영)
// 모델이 쓴 로마자는 받침·모음을 틀리는 경우가 있어 한글에서 직접 계산한다.
const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'oo', 'wo', 'we', 'wi', 'yu', 'eu', 'ee', 'i'];
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
const JONG_LINK = [...JONG];
Object.assign(JONG_LINK, { 1: 'g', 7: 'd', 8: 'r', 17: 'b', 19: 's', 20: 'ss', 22: 'j', 23: 'ch' });

function decompose(ch) {
  const s = ch.codePointAt(0) - 0xac00;
  if (s < 0 || s > 11171) return null;
  return { cho: Math.floor(s / (28 * 21)), jung: Math.floor(s / 28) % 21, jong: s % 28 };
}

export function romanize(hangul) {
  const chars = Array.from(hangul);
  const parts = chars.map(decompose);
  if (parts.some((p) => p === null)) return hangul;

  let out = '';
  parts.forEach((p, i) => {
    // 받침 없이 "우"만 오면 "woo"
    if (p.jung === 13 && p.cho === 11) {
      out += 'woo';
      return;
    }
    const next = parts[i + 1];
    const prev = parts[i - 1];
    const nextIsWoo = next && next.jung === 13 && next.cho === 11;

    let initial = CHO[p.cho];
    // 앞 글자 받침이 이 글자(이응 초성)로 연음
    if (prev && prev.jong !== 0 && prev.jong !== 21 && p.cho === 11) initial = JONG_LINK[prev.jong];

    // "영"은 yeong 대신 young
    if (p.jung === 6 && p.jong === 21) {
      out += initial + 'young';
      return;
    }

    const linkForward = next && p.jong !== 0 && p.jong !== 21 && next.cho === 11 && !nextIsWoo;
    out += initial + JUNG[p.jung] + (linkForward ? '' : JONG[p.jong]);
  });

  out = out.toLowerCase();
  return out ? out[0].toUpperCase() + out.slice(1) : hangul;
}

// SKILL.md의 "First syllable:" / "Second syllable:" 줄에서 허용 음절을 읽는다.
// 프롬프트와 서버 검증이 같은 목록을 쓰도록 스킬 파일 한 곳에서만 관리.
export function allowedSyllables(skill) {
  const m1 = skill.match(/^First syllable:[ \t]*(.+)$/m);
  const m2 = skill.match(/^Second syllable:[ \t]*(.+)$/m);
  if (!m1 || !m2) return null;
  const first = new Set(m1[1].trim().split(/\s+/));
  const second = new Set(m2[1].trim().split(/\s+/));
  if (!first.size || !second.size) return null;
  return { first, second };
}

// "자음 + ㅡ, 받침 없음"(트, 크, 프, 스 …)은 외래어 표기 티가 나서 이름에서 제외
export function hasForeignSyllable(hangul) {
  return Array.from(hangul).some((ch) => {
    const p = decompose(ch);
    return p && p.jung === 18 && p.jong === 0;
  });
}

// 한자·가타카나 표기는 규칙으로 계산할 수 없어 모델 값을 쓰되, 문자 종류만 확인
export function readingLooksValid(ro, script) {
  ro = String(ro || '').trim();
  if (!ro || ro.length > 12) return false;
  if (script === 'katakana') return KATAKANA_RE.test(ro) && !LATIN_RE.test(ro) && !HANGUL_RE.test(ro);
  if (script === 'hanzi') return HAN_RE.test(ro) && !/[가-힣぀-ヿ]/.test(ro) && !LATIN_RE.test(ro);
  return true;
}

// 모델이 준 후보 하나를 검사. 통과하면 { ko, ro }, 탈락하면 { reject: 이유 }
export function checkCandidate(raw, script, allowed) {
  const ko = String(raw?.ko ?? '').trim();
  if (!/^[가-힣]{2}$/.test(ko)) return { reject: 'not2', ko: ko.slice(0, 8) };
  if (hasForeignSyllable(ko)) return { reject: 'foreign', ko };
  if (ko[0] === ko[1]) return { reject: 'same', ko };
  if (allowed && (!allowed.first.has(ko[0]) || !allowed.second.has(ko[1]))) return { reject: 'syllable', ko };

  if (script === 'english-romanization') return { ko, ro: romanize(ko) };
  const ro = String(raw?.ro ?? '').trim();
  if (!readingLooksValid(ro, script)) return { reject: 'reading', ko };
  return { ko, ro };
}

// 후보 풀에서 화면에 보여줄 이름 고르기
//  1차: 첫 음절이 서로 다른 후보 우선 / 2차(allowSameFirst): 모자라면 겹쳐도 채움
export function pickNames(candidates, exclude, want, allowSameFirst) {
  const usedKo = new Set(exclude);
  const usedFirst = new Set();
  const picked = [];

  for (const c of candidates) {
    if (picked.length >= want) break;
    if (usedKo.has(c.ko) || usedFirst.has(c.ko[0])) continue;
    picked.push(c);
    usedKo.add(c.ko);
    usedFirst.add(c.ko[0]);
  }
  if (allowSameFirst) {
    for (const c of candidates) {
      if (picked.length >= want) break;
      if (usedKo.has(c.ko)) continue;
      picked.push(c);
      usedKo.add(c.ko);
    }
  }
  return picked;
}

// 모델 응답 텍스트에서 JSON만 꺼내기 (앞뒤 설명·코드펜스가 섞여도 처리)
export function extractJson(text) {
  let t = String(text || '').replace(/^```(?:json)?|```$/gm, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b === -1) return null;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
