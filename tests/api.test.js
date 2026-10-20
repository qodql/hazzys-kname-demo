// 이름 생성 로직 테스트: Anthropic 응답을 가짜로 바꿔서 검증·재시도·횟수 제한을 확인
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'test';
process.env.KNAME_DAILY_LIMIT_PER_IP = '3';
delete process.env.VERCEL;

let calls = [];
let replies = [];
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  calls.push(body);
  const isJudge = body.system.startsWith('You are a strict validator');
  const text = isJudge ? '{"bad":["가다"]}' : replies.shift() ?? '{"names":[]}';
  return { ok: true, json: async () => ({ content: [{ text }] }) };
};

const { generateNames } = await import('../lib/generate.js');

const call = (body, ip = '1.1.1.1') => generateNames(body, ip);

// 입력 검증 (횟수 차감 없음)
assert.equal((await call({ name: '', lang: 'en' })).body.error, 'enterName');
assert.equal((await call({ name: '홍길동', lang: 'en' })).body.error, 'noKorean');
assert.equal((await call({ name: '李明', lang: 'en' })).body.error, 'wrongScript');
assert.equal(calls.length, 0);

// 1차 응답에 탈락 후보가 섞여 있으면 재시도해서 3개를 채움 + 2차 검증으로 "가다" 제외
replies = [
  '{"names":[{"ko":"제임"},{"ko":"토마"},{"ko":"하윤"},{"ko":"가다"},{"ko":"하은"},{"ko":"민민"}]}',
  'Here you go: {"names":[{"ko":"서연"},{"ko":"지아"},{"ko":"트윤"},{"ko":"예린"},{"ko":"소율"},{"ko":"나은"}]}',
];
let r = await call({ name: 'Emily', lang: 'en' });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.deepEqual(r.body.names.map((n) => n.ko), ['하윤', '서연', '지아']);
assert.equal(r.body.names[0].ro, 'Hayun');
assert.equal(r.body.remaining, 2);
const gen = calls.filter((c) => !c.system.startsWith('You are a strict'));
assert.equal(gen.length, 2);
assert.match(gen[1].messages[0].content, /Rejected by the application.*토마/);
assert.match(gen[1].messages[0].content, /Previously shown names.*하윤/);

// 같은 이름 다시 요청: 캐시에서 이미 보여준 이름 제외하고 골라 줌 (API 호출 없이 가능하면)
calls = [];
r = await call({ name: 'emily', lang: 'en', previous: ['하윤', '서연', '지아'] });
assert.equal(r.status, 200);
assert.ok(r.body.names.every((n) => !['하윤', '서연', '지아'].includes(n.ko)));
assert.equal(calls.length, 0, 'served from cache');
assert.equal(r.body.remaining, 1);

// 중국어: 한자 표기가 아니면 탈락
replies = ['{"names":[{"ko":"지연","ro":"智妍"},{"ko":"하윤","ro":"Hayun"},{"ko":"서아","ro":"瑞雅"},{"ko":"민서","ro":"敏瑞"}]}'];
r = await call({ name: '李明', lang: 'zh' });
assert.deepEqual(r.body.names, [{ ko: '지연', ro: '智妍' }, { ko: '서아', ro: '瑞雅' }, { ko: '민서', ro: '敏瑞' }]);
assert.equal(r.body.remaining, 0);

// 4번째 요청은 하루 한도 초과
r = await call({ name: 'Tom', lang: 'en' });
assert.equal(r.status, 429);
assert.equal(r.body.error, 'limitReached');

// 다른 IP는 영향 없음 / 생성 실패 시 횟수 돌려줌
replies = ['not json', 'still not json', 'nope'];
r = await call({ name: 'Tom', lang: 'en' }, '2.2.2.2');
assert.equal(r.status, 502);
assert.equal(r.body.error, 'parseFailed');
assert.equal(r.body.remaining, 3, 'refunded');

console.log('api tests passed');
