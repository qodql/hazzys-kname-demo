'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { I18N, LANG_TABS } from '../lib/i18n.js';
import { hasHangul, isValidScript } from '../lib/kname.js';

const HTML_LANG = { en: 'en', zh: 'zh-CN', ja: 'ja' };

function detectLang() {
  const q = new URLSearchParams(window.location.search).get('lang');
  if (['en', 'zh', 'ja'].includes(q)) return q;
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('zh')) return 'zh';
  if (nav.startsWith('ja')) return 'ja';
  return 'en';
}

export default function KnameApp() {
  const [lang, setLang] = useState('en');
  const [step, setStep] = useState(1);
  const [nameInput, setNameInput] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [names, setNames] = useState([]);
  const [shown, setShown] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [limit, setLimit] = useState(10);
  const [limitHit, setLimitHit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cardFont, setCardFont] = useState('16px');

  const inputRef = useRef(null);
  const cardRef = useRef(null);

  const t = I18N[lang];
  const selected = selectedIdx === null ? null : names[selectedIdx];
  const remainingText =
    remaining === null ? '' : t.remaining.replace('{n}', remaining).replace('{limit}', limit);

  // 언어는 브라우저에서만 알 수 있으므로 마운트 후에 결정 (서버 렌더링과 불일치 방지)
  useEffect(() => setLang(detectLang()), []);

  const errorText = (code, lim = limit) =>
    (t.errors[code] || t.errors.generic).replace('{limit}', lim);

  function resetFlow() {
    setNameInput('');
    setSourceName('');
    setWarning('');
    setError('');
    setNames([]);
    setShown([]);
    setSelectedIdx(null);
    setStep(1);
  }

  function changeLang(next) {
    if (next === lang) return;
    setLang(next);
    resetFlow(); // 원본은 언어별 페이지로 이동하므로 같은 동작으로 처음부터
  }

  function showWarning(code) {
    setWarning(errorText(code));
    inputRef.current?.focus();
  }

  async function generate(name, previous) {
    setLoading(true);
    setError('');
    setSelectedIdx(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, lang, previous }),
      });
      const data = await res.json().catch(() => ({}));
      const lim = typeof data.limit === 'number' ? data.limit : limit;
      setLimit(lim);
      if (typeof data.remaining === 'number') setRemaining(data.remaining);

      if (!res.ok) {
        if (res.status === 429) setLimitHit(true);
        throw new Error(errorText(data.error, lim));
      }
      const list = data.names || [];
      if (!list.length) throw new Error(errorText('parseFailed', lim));
      setNames(list);
      setShown([...previous, ...list.map((n) => n.ko)]);
      if (data.remaining === 0) setLimitHit(true);
    } catch (e) {
      setNames([]);
      setError(e.message && !e.message.startsWith('Failed to fetch') ? e.message : errorText('generic'));
    } finally {
      setLoading(false);
    }
  }

  function onConfirm(e) {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name) return showWarning('enterName');
    if (hasHangul(name)) return showWarning('noKorean');
    if (!isValidScript(name, lang)) return showWarning('wrongScript');
    setWarning('');
    setSourceName(name);
    setNames([]);
    setShown([]);
    setStep(2);
    generate(name, []);
  }

  // 카드 안의 크기는 모두 em — 카드 너비에 맞춰 기준 글자 크기를 바꾼다 (37.5em = 카드 너비)
  const fitCard = useCallback(() => {
    const w = cardRef.current?.getBoundingClientRect().width;
    if (w) setCardFont(`${w / 37.5}px`);
  }, []);

  useEffect(() => {
    if (step !== 3 || !cardRef.current) return;
    fitCard();
    const ro = new ResizeObserver(fitCard);
    ro.observe(cardRef.current);
    return () => ro.disconnect();
  }, [step, selected, fitCard]);

  async function saveImage() {
    if (!cardRef.current || saving) return;
    setSaving(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      if (document.fonts?.ready) await document.fonts.ready; // 이름 웹폰트 적용 후 캡처
      const el = cardRef.current;
      // 모바일에서도 선명하도록 가로 1200px 이상 확보 (최대 4배)
      const scale = Math.min(4, Math.max(2, 1200 / (el.offsetWidth || 600)));
      const canvas = await html2canvas(el, { backgroundColor: null, scale, useCORS: true });
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `korean-name-${selected.ko}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      console.warn('카드 이미지 저장 실패:', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="kname-page">
      <div className="kname-wrap">
        <button type="button" className="kname-logo" aria-label="HAZZYS, 처음으로" onClick={resetFlow}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/hazzys-logo.svg" alt="HAZZYS" />
        </button>

        <div className="kname-progress" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={`kname-progress-dot${step === n ? ' is-active' : ''}${n < step ? ' is-done' : ''}`}
            />
          ))}
        </div>

        <div className="kname-steps" lang={HTML_LANG[lang]}>
          {/* Step 1: 이름 입력 */}
          {step === 1 && (
            <section className="kname-step">
              <div className="kname-step-header">
                <span className="kname-step-num">1</span>
                <h1 className="kname-step-title">{t.step1Title}</h1>
              </div>
              <p className="kname-step-desc">{t.step1Desc}</p>

              <form className="kname-input-card" onSubmit={onConfirm} noValidate>
                <span className="kname-label" id="kname-lang-label">LANGUAGE</span>
                <div className="kname-lang-tabs" role="radiogroup" aria-labelledby="kname-lang-label">
                  {LANG_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="radio"
                      className={`kname-lang-tab${lang === tab.key ? ' is-selected' : ''}`}
                      data-lang={tab.key}
                      aria-checked={lang === tab.key}
                      onClick={() => changeLang(tab.key)}
                    >
                      <span className="kname-lang-label">
                        <span className="kname-lang-full">{tab.full}</span>
                        <span className="kname-lang-short">{tab.short}</span>
                      </span>
                      <span className="kname-lang-check" aria-hidden="true">✓</span>
                    </button>
                  ))}
                </div>

                <label className="kname-label" htmlFor="kname-name-input">{t.nameLabel}</label>
                <input
                  id="kname-name-input"
                  ref={inputRef}
                  type="text"
                  value={nameInput}
                  placeholder={t.placeholder}
                  autoComplete="off"
                  maxLength={40}
                  className={warning ? 'kname-input-error' : ''}
                  aria-invalid={Boolean(warning)}
                  aria-describedby="kname-warning"
                  onChange={(e) => {
                    setNameInput(e.target.value);
                    setWarning('');
                  }}
                />
                {warning && (
                  <p id="kname-warning" className="kname-inline-warning" role="alert">{warning}</p>
                )}
                <button type="submit" className="kname-primary" disabled={loading}>
                  {loading ? t.loadingBtn : t.confirm}
                </button>
                {remainingText && <p className="kname-remaining">{remainingText}</p>}
              </form>
            </section>
          )}

          {/* Step 2: 추천 이름 선택 */}
          {step === 2 && (
            <section className="kname-step">
              <button
                type="button"
                className={`kname-back${loading ? ' is-hidden' : ''}`}
                onClick={() => setStep(1)}
                tabIndex={loading ? -1 : undefined}
                aria-hidden={loading || undefined}
              >
                {t.back}
              </button>
              <div className="kname-step-header">
                <span className="kname-step-num">2</span>
                <h2 className="kname-step-title">{t.step2Title}</h2>
              </div>
              <p className="kname-step-desc">{t.step2Desc}</p>

              <div className="kname-results" aria-live="polite">
                {loading ? (
                  <div className="kname-logo-loading-wrap">
                    <div className="kname-logo-loader" aria-hidden="true">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="kname-logo-loader-base" src="/images/loading.svg" alt="" />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="kname-logo-loader-fill" src="/images/loading.svg" alt="" />
                    </div>
                  </div>
                ) : error ? (
                  <p className="kname-message" role="alert">{error}</p>
                ) : (
                  names.length > 0 && (
                    <div className="kname-list" role="radiogroup" aria-label={t.step2Title}>
                      {names.map((n, idx) => (
                        <button
                          key={n.ko}
                          type="button"
                          role="radio"
                          className={`kname-card${selectedIdx === idx ? ' is-selected' : ''}`}
                          aria-checked={selectedIdx === idx}
                          onClick={() => setSelectedIdx(idx)}
                        >
                          <span className="kname-card-left">
                            <span className="kname-ko" lang="ko">{n.ko}</span>
                            <span className="kname-ro">{n.ro}</span>
                          </span>
                          <span className="kname-card-check" aria-hidden="true">
                            ✓
                            {/* 가운데(두 번째) 카드만 하트, 첫 번째·세 번째는 별 */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              className="kname-card-star"
                              src={idx === 1 ? '/images/icon-heart.png' : '/images/icon-star.png'}
                              alt=""
                            />
                          </span>
                        </button>
                      ))}
                    </div>
                  )
                )}

                {!loading && (names.length > 0 || error) && (
                  <div className="kname-step2-footer">
                    {names.length > 0 && !error && (
                      <button
                        type="button"
                        className="kname-primary"
                        disabled={selectedIdx === null}
                        onClick={() => selected && setStep(3)}
                      >
                        {t.selectBtn}
                      </button>
                    )}
                    <button
                      type="button"
                      className="kname-again"
                      disabled={limitHit}
                      onClick={() => generate(sourceName, shown)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {t.regenerateBtn}
                    </button>
                    {remainingText && <p className="kname-remaining">{remainingText}</p>}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Step 3: 이름 카드 */}
          {step === 3 && selected && (
            <section className="kname-step">
              <button type="button" className="kname-back" onClick={() => setStep(2)}>{t.chooseAgain}</button>
              <div className="kname-step-header">
                <span className="kname-step-num">3</span>
                <h2 className="kname-step-title">{t.step3Title}</h2>
              </div>
              <p className="kname-step-desc">{t.step3Desc}</p>

              <div className="kname-step3-inner">
                <div ref={cardRef} className="kname-selected-card" style={{ fontSize: cardFont }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="kname-c-bg" src="/images/kname-card-bg.jpg" alt="" />
                  <div className="kname-c-body">
                    <div className="kname-selected-label">{sourceName}</div>
                    <div className="kname-selected-ko" lang="ko">{selected.ko}</div>
                    <div className="kname-selected-ro">{selected.ro}</div>
                  </div>
                </div>

                <div className="kname-btn-row">
                  <button type="button" className="kname-save" disabled={saving} onClick={saveImage}>
                    {saving ? t.savingBtn : t.saveBtn}
                  </button>
                  <button type="button" className="kname-restart" onClick={resetFlow}>{t.restartBtn}</button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      <footer className="kname-footer">
        <p lang="ko">포트폴리오용 재현 데모이며, 실제 이벤트 페이지와 무관합니다.</p>
      </footer>
    </div>
  );
}
