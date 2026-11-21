import { useEffect, useMemo, useState } from 'react';
import { COMPOUNDS, UNITS } from '../game/types';
import { eligiblePairBoards, fourChoicePool } from '../game/generator';
import { teacherMutation, type TeacherSession } from './teacher-auth';
import type { ExclusionProfile } from '../game/profile';

const UNIT_OF = new Map<string, string[]>();
for (const u of UNITS) for (const id of u.compoundIds) UNIT_OF.set(id, [...(UNIT_OF.get(id) ?? []), u.name]);

export function AdminCompounds({ session, master }: { session: TeacherSession; master: boolean }) {
  const [revision, setRevision] = useState(1);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [unit, setUnit] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetch('/api/exclusion-profile', { cache: 'no-store' }).then(r => r.json()).then((d: { revision: number; profile: ExclusionProfile }) => {
      setRevision(d.revision); setExcluded(d.profile.excludedIds); setSaved(d.profile.excludedIds);
    }).catch(() => setMessage('除外設定を読み込めませんでした'));
  };
  useEffect(load, []);

  const dirty = useMemo(() => JSON.stringify([...excluded].sort()) !== JSON.stringify([...saved].sort()), [excluded, saved]);
  const poolCount = fourChoicePool(UNITS.map(u => u.name), excluded).length;
  const onePair = eligiblePairBoards('onePair', ['aliphatic', 'aromatic'], excluded).length;
  const twoPair = eligiblePairBoards('twoPair', ['aliphatic', 'aromatic'], excluded).length;

  const rows = COMPOUNDS.filter(c =>
    (!query || c.nameJa.includes(query) || c.id.includes(query)) &&
    (!unit || (UNIT_OF.get(c.id) ?? []).includes(unit)));
  const toggle = (id: string) => setExcluded(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const res = await teacherMutation<{ revision: number; profile: ExclusionProfile }>('/api/teacher/exclusion-profile', 'PUT', session, { revision, profile: { version: 1, excludedIds: excluded } });
      setRevision(res.revision); setSaved(res.profile.excludedIds); setExcluded(res.profile.excludedIds);
      setMessage('保存しました');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '保存できませんでした');
      if ((e as { status?: number }).status === 409) load();
    } finally { setBusy(false); }
  };

  return <section className="panel">
    <h2>出題しない化合物{master ? '' : '（閲覧のみ）'}</h2>
    <p className="hint">全{COMPOUNDS.length}件中、除外 {excluded.length}件。四択プール（全範囲）{poolCount}件、ワンペア盤面 {onePair}題、ツーペア盤面 {twoPair}題が作成できます。{master && '保存はマスター教員のみ。新しいルームから反映されます。'}</p>
    <div className="admin-filters">
      <input type="search" placeholder="名前で検索" value={query} onChange={e => setQuery(e.target.value)} />
      <select value={unit} onChange={e => setUnit(e.target.value)}>
        <option value="">すべての範囲</option>
        {UNITS.map(u => <option key={u.name} value={u.name}>{u.name}</option>)}
      </select>
    </div>
    <ul className="compound-list">
      {rows.map(c => <li key={c.id} className="compound-row">
        <label>
          <input type="checkbox" checked={excluded.includes(c.id)} disabled={!master || busy} onChange={() => toggle(c.id)} />
          <img className="structure-img small" src={`/${c.structureSvg}`} alt="" />
          <span className="compound-name">{c.nameJa}</span>
          <span className="compound-meta">{c.formula}　{(UNIT_OF.get(c.id) ?? []).join('・') || '（四択範囲外）'}</span>
        </label>
      </li>)}
    </ul>
    {master && <div className="play-actions">
      <button type="button" className="primary-action" disabled={!dirty || busy} onClick={() => void save()}>除外設定を保存</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
