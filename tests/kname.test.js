// 원본 PHP와 같은 결과가 나오는지 확인하는 간단한 테스트 (node tests/kname.test.js)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  romanize, isValidScript, hasForeignSyllable, allowedSyllables, checkCandidate, pickNames, extractJson,
} from '../lib/kname.js';

const cases = {
  하은: 'Haeun', 도원: 'Dowon', 지우: 'Jiwoo', 서영: 'Seoyoung', 민준: 'Minjoon', 하윤: 'Hayun',
  수빈: 'Soobin', 태민: 'Taemin', 은우: 'Eunwoo', 석민: 'Seokmin', 지혜: 'Jihye', 윤희: 'Yunhee',
  우진: 'Woojin', 선아: 'Seona', 별이: 'Byeori', 한결: 'Hangyeol',
};
for (const [ko, ro] of Object.entries(cases)) assert.equal(romanize(ko), ro, ko);

assert.ok(isValidScript('Emily', 'en'));
assert.ok(!isValidScript('李明', 'en'));
assert.ok(isValidScript('李明', 'zh'));
assert.ok(!isValidScript('みさき', 'zh'));
assert.ok(isValidScript('美咲', 'ja') && isValidScript('みさき', 'ja') && isValidScript('ミサキ', 'ja'));
assert.ok(!isValidScript('Misaki', 'ja'));

assert.ok(hasForeignSyllable('트윤') && hasForeignSyllable('제임스') && !hasForeignSyllable('태민'));

const skill = readFileSync(new URL('../skill/korean-name-generator.md', import.meta.url), 'utf8');
const allowed = allowedSyllables(skill);
assert.ok(allowed && allowed.first.has('하') && allowed.second.has('윤'));

assert.deepEqual(checkCandidate({ ko: '하윤', ro: 'x' }, 'english-romanization', allowed), { ko: '하윤', ro: 'Hayun' });
assert.equal(checkCandidate({ ko: '토마' }, 'english-romanization', allowed).reject, 'syllable');
assert.equal(checkCandidate({ ko: '장지연' }, 'english-romanization', allowed).reject, 'not2');
assert.equal(checkCandidate({ ko: '민민' }, 'english-romanization', allowed).reject, 'same');
assert.equal(checkCandidate({ ko: '하윤', ro: 'Hayun' }, 'katakana', allowed).reject, 'reading');
assert.deepEqual(checkCandidate({ ko: '하윤', ro: 'ハユン' }, 'katakana', allowed), { ko: '하윤', ro: 'ハユン' });
assert.deepEqual(checkCandidate({ ko: '지연', ro: '智妍' }, 'hanzi', allowed), { ko: '지연', ro: '智妍' });

const pool = [{ ko: '하윤' }, { ko: '하은' }, { ko: '서연' }, { ko: '지아' }];
assert.deepEqual(pickNames(pool, [], 3, false).map((n) => n.ko), ['하윤', '서연', '지아']);
assert.deepEqual(pickNames(pool, ['서연'], 3, false).map((n) => n.ko), ['하윤', '지아']);
assert.deepEqual(pickNames(pool, ['서연'], 3, true).map((n) => n.ko), ['하윤', '지아', '하은']);

assert.deepEqual(extractJson('Sure!\n```json\n{"names":[]}\n```'), { names: [] });
assert.equal(extractJson('no json'), null);

console.log('all tests passed');
