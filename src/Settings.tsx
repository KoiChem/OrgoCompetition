"use client";
import { useEffect, useState } from 'react';
import type { Direction, OrgoGameSettings, PairCategory } from '../game/types';
import { UNITS } from '../game/types';
import { eligiblePairBoards, eligiblePropertyQuestions, fourChoicePool } from '../game/generator';

export const DEFAULT_SETTINGS: OrgoGameSettings = {
  questionCount: 10, timeLimitMinutes: 5, gradingMode: 'immediate',
  mode: 'four', units: UNITS.map(u => u.name), pairCategories: ['aliphatic', 'aromatic'], directions: ['A', 'B'],
};

const DIRECTION_LABELS: Record<Direction, string> = {
  A: 'A 名前 → 構造', B: 'B 構造 → 名前', C: 'C 性質 → 名前', D: 'D 性質 → 構造',
};
const MODE_LABELS = { four: '四択', onePair: 'ワンペア', twoPair: 'ツーペア' } as const;

export function settingsSummary(value: OrgoGameSettings): string {
  const base = `${MODE_LABELS[value.mode]}・${value.questionCount}問・${value.timeLimitMinutes}分・${value.gradingMode === 'deferred' ? 'まとめて判定' : '問題毎判定'}`;
  if (value.mode === 'four') return `${base}・範囲：${value.units.length === UNITS.length ? '全範囲' : value.units.join('、')}・方向：${value.directions.join('')}`;
  return `${base}・範囲：${value.pairCategories.map(c => c === 'aliphatic' ? '脂肪族' : '芳香族').join('・')}`;
}

function Choice<T extends string | number>({ legend, values, value, label, onChange, disabled }: { legend: string; values: readonly T[]; value: T; label: (value: T) => string; onChange: (value: T) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled}><legend>{legend}</legend><div className="choice-grid">{values.map(item => <button key={String(item)} className="choice" type="button" aria-pressed={item === value} onClick={() => onChange(item)}>{label(item)}</button>)}</div></fieldset>;
}
function MultiChoice<T extends string>({ legend, values, selected, label, onChange, disabled, note }: { legend: string; values: readonly T[]; selected: readonly T[]; label: (value: T) => string; onChange: (next: T[]) => void; disabled?: boolean; note?: (value: T) => string }) {
  const toggle = (item: T) => {
    const next = selected.includes(item) ? selected.filter(v => v !== item) : [...selected, item];
    if (next.length) onChange(next);
  };
  return <fieldset disabled={disabled}><legend>{legend}</legend><div className="choice-grid">{values.map(item => <button key={item} className="choice" type="button" aria-pressed={selected.includes(item)} onClick={() => toggle(item)}>{label(item)}{note && <span className="choice-note">{note(item)}</span>}</button>)}</div></fieldset>;
}

type Props = { value: OrgoGameSettings; onChange(value: OrgoGameSettings): void; disabled?: boolean; mate?: boolean };
export function CompetitionSettingsForm({ value, onChange, disabled, mate }: Props) {
  const [excluded, setExcluded] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    fetch('/api/exclusion-profile', { cache: 'no-store' }).then(r => r.json()).then((d: { profile?: { excludedIds?: string[] } }) => { if (live) setExcluded(d.profile?.excludedIds ?? []); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const update = <K extends keyof OrgoGameSettings>(key: K, next: OrgoGameSettings[K]) => onChange({ ...value, [key]: next });
  const pool = fourChoicePool(value.units, excluded);
  const cdEligible = eligiblePropertyQuestions(pool).length;
  const pairCounts = (mode: 'onePair' | 'twoPair') => eligiblePairBoards(mode, value.pairCategories, excluded).length;
  return <div className="settings-form">
    <div className="settings-group">
      <Choice legend="モード" values={['four', 'onePair', 'twoPair'] as const} value={value.mode} label={m => MODE_LABELS[m]} onChange={m => update('mode', m)} disabled={disabled} />
      <Choice legend="問題数" values={[5, 10] as const} value={value.questionCount} label={n => `${n}問`} onChange={n => update('questionCount', n)} disabled={disabled} />
      <Choice legend="制限時間" values={[3, 4, 5, 6, 7, 8, 9, 10] as const} value={value.timeLimitMinutes} label={n => `${n}分`} onChange={n => update('timeLimitMinutes', n)} disabled={disabled} />
      {!mate && <><Choice legend="判定方式" values={['immediate', 'deferred'] as const} value={value.gradingMode} label={m => m === 'immediate' ? '問題毎判定' : 'まとめて判定'} onChange={m => update('gradingMode', m)} disabled={disabled} />
      <p className="settings-hint">{value.gradingMode === 'deferred' ? '最後に提出して採点します' : '答えるたびに正誤がわかります'}</p></>}
    </div>
    {value.mode === 'four' ? <div className="settings-group">
      <MultiChoice legend="出題範囲" values={UNITS.map(u => u.name)} selected={value.units} label={n => n} note={n => `${fourChoicePool([n], excluded).length}件`} onChange={next => update('units', next)} disabled={disabled} />
      <MultiChoice legend="出題方向" values={['A', 'B', 'C', 'D'] as const} selected={value.directions} label={d => DIRECTION_LABELS[d]} onChange={next => update('directions', next as Direction[])} disabled={disabled} />
      <p className="settings-hint">出題プール {pool.length}件{value.directions.some(d => d === 'C' || d === 'D') && `・性質問題（C/D）作成可能 ${cdEligible}件（承認済みの問題のみ）`}</p>
    </div> : <div className="settings-group">
      <MultiChoice legend="出題範囲" values={['aliphatic', 'aromatic'] as const} selected={value.pairCategories} label={c => c === 'aliphatic' ? '脂肪族' : '芳香族'} onChange={next => update('pairCategories', next as PairCategory[])} disabled={disabled} />
      <p className="settings-hint">作成可能な盤面：{pairCounts(value.mode)}題</p>
    </div>}
    <p className="settings-summary" aria-live="polite">{settingsSummary(value)}</p>
  </div>;
}
export { CompetitionSettingsForm as Settings };
