import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Credential, Snapshot, Verdict } from './protocol';
import { RoomConnection } from './socket';
import { saveCredential } from './credentials';
import { Player } from './Player';
import { ReviewList } from './Review';
import { NicknameEditor } from './NicknameEditor';
import { CompetitionSettingsForm, settingsSummary } from './Settings';
import type { OrgoGameSettings } from '../game/types';
import { HostSoundGate, playBoundary, playTick, useHostSoundToggle } from './host-sound';

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function RoomScreen({ credential, onLeave }: { credential: Credential; onLeave(): void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState('接続中');
  const [error, setError] = useState('');
  const [verdictSignal, setVerdictSignal] = useState<{ verdict: Verdict; n: number } | null>(null);
  const connectionRef = useRef<RoomConnection | null>(null);
  const offsetRef = useRef(0);
  const isHost = credential.role === 'teacher' || credential.role === 'mate-host';

  useEffect(() => {
    const connection = new RoomConnection(credential, {
      onState: (state) => {
        offsetRef.current = state.serverNow - Date.now();
        // First snapshot carrying our own participant is the server join ACK:
        // confirm the credential so re-entry never re-issues a new token.
        if (credential.pending && state.own) {
          credential.pending = false;
          credential.nickname = state.own.nickname;
          credential.kind = state.room.kind;
          credential.expiresAtMs = state.room.expiresAtMs;
          try { saveCredential(credential); } catch { /* storage unavailable */ }
        }
        setSnapshot(state); setError('');
      },
      onStatus: setStatus,
      onError: (_code, message) => setError(message),
      onVerdict: (verdict) => setVerdictSignal(prev => ({ verdict, n: (prev?.n ?? 0) + 1 })),
    });
    connectionRef.current = connection;
    return () => { connection.dispose(); connectionRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential.code, credential.role, credential.participantId]);

  // When the countdown ends, ask the server for a fresh snapshot so the
  // COUNTDOWN -> RUNNING transition renders without waiting for other events.
  useEffect(() => {
    if (snapshot?.room.state !== 'COUNTDOWN' || !snapshot.room.startAtMs) return;
    const delay = Math.max(50, snapshot.room.startAtMs - snapshot.serverNow + 300);
    const t = setTimeout(() => { connectionRef.current?.send({ type: 'sync' }).catch(() => {}); }, delay);
    return () => clearTimeout(t);
  }, [snapshot?.room.state, snapshot?.room.startAtMs, snapshot?.serverNow]);

  const roomState = snapshot?.room.state;
  const now = useNow(roomState === 'RUNNING' || roomState === 'COUNTDOWN');
  const serverNow = now + offsetRef.current;

  // Host sound: ticks before start/deadline, long tone at boundaries.
  const sound = useHostSoundToggle();
  const gateRef = useRef(new HostSoundGate());
  const startAt = snapshot?.room.startAtMs ?? null, deadlineAt = snapshot?.room.deadlineAtMs ?? null;
  useEffect(() => {
    if (!isHost || !startAt || !deadlineAt) return;
    const kind = gateRef.current.observe(startAt, deadlineAt, serverNow, sound.on);
    if (kind === 'tick') playTick();
    else if (kind === 'boundary') playBoundary();
  }, [isHost, startAt, deadlineAt, serverNow, sound.on]);

  const send = (message: Parameters<RoomConnection['send']>[0]) => connectionRef.current!.send(message);
  const joinUrl = useMemo(() => `${location.origin}/#/join/${credential.code}`, [credential.code]);

  if (!snapshot) return <main className="page-shell"><section className="panel"><h1>オルゴコンペ</h1><p role="status">{status}</p>{error && <p role="alert" className="error">{error}</p>}<button type="button" className="secondary-button" onClick={onLeave}>ホームへ戻る</button></section></main>;

  const room = snapshot.room;
  const remaining = room.deadlineAtMs ? room.deadlineAtMs - serverNow : null;
  const untilStart = room.startAtMs ? room.startAtMs - serverNow : null;

  return <main className="page-shell room-shell">
    <header className="room-header">
      <div>
        <p className="eyebrow">{room.kind === 'mate' ? 'メイトマッチ' : 'クラスコンペ'}　コード {room.code}</p>
        <p className="settings-line">{settingsSummary(room.settings)}</p>
      </div>
      <div className="room-header-side">
        {(room.state === 'RUNNING' || room.state === 'COUNTDOWN') && <p className="timer" aria-label="残り時間">{room.state === 'COUNTDOWN' ? `開始まで ${Math.max(0, Math.ceil((untilStart ?? 0) / 1000))}` : mmss(remaining ?? 0)}</p>}
        <p className="conn-status">{status}</p>
        {isHost && <button type="button" className="secondary-button" onClick={sound.toggle}>ホスト音 {sound.on ? 'ON' : 'OFF'}</button>}
        <button type="button" className="secondary-button" onClick={onLeave}>ホーム</button>
      </div>
    </header>
    {error && <p role="alert" className="error">{error}</p>}

    {room.state === 'WAITING' && <Lobby snapshot={snapshot} isHost={isHost} joinUrl={joinUrl} send={send} />}
    {room.state === 'COUNTDOWN' && <section className="panel countdown-panel"><p className="countdown-number">{Math.max(1, Math.ceil((untilStart ?? 0) / 1000))}</p><p>まもなく開始！</p></section>}
    {room.state === 'RUNNING' && (isHost && credential.role === 'teacher'
      ? <HostRace snapshot={snapshot} send={send} />
      : <Player snapshot={snapshot} connection={connectionRef.current!} verdictSignal={verdictSignal} />)}
    {room.state === 'COLLECTING' && (credential.role !== 'teacher' && room.settings.gradingMode === 'deferred' && !snapshot.own?.finished
      ? <Player snapshot={snapshot} connection={connectionRef.current!} verdictSignal={verdictSignal} />
      : <section className="panel"><h2>集計しています</h2><p>全員の結果をまとめています…</p></section>)}
    {room.state === 'FINISHED' && <Results snapshot={snapshot} isClassTeacher={credential.role === 'teacher' && room.kind === 'class'} />}
    {room.state === 'CANCELLED' && <section className="panel"><h2>このルームは解散しました</h2><button type="button" className="secondary-button" onClick={onLeave}>ホームへ戻る</button></section>}
    {isHost && room.state === 'RUNNING' && credential.role === 'mate-host' && <div className="play-actions"><button type="button" className="danger-button" onClick={() => { if (confirm('競技を終了しますか？')) void send({ type: 'finish' }).catch(() => {}); }}>競技を終了する</button></div>}
  </main>;
}

function stableSettingsJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSettingsJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableSettingsJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

function Lobby({ snapshot, isHost, joinUrl, send }: { snapshot: Snapshot; isHost: boolean; joinUrl: string; send: (m: Parameters<RoomConnection['send']>[0]) => Promise<unknown> }) {
  const room = snapshot.room;
  const [settings, setSettings] = useState<OrgoGameSettings>(room.settings);
  const [busy, setBusy] = useState(false);
  const participants = snapshot.participants ?? [];
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } catch { /* error shown by room */ } finally { setBusy(false); } };
  return <div className="lobby-grid">
    <section className="panel join-panel">
      <h2>参加コード</h2>
      <p className="room-code">{room.code}</p>
      <QRCodeSVG value={joinUrl} size={180} />
      <p className="hint">参加者 {room.participantCount} / {room.kind === 'mate' ? 4 : 50}人</p>
      {snapshot.own && <NicknameEditor nickname={snapshot.own.nickname} disabled={busy} onSave={async (value) => { await send({ type: 'nickname', nickname: value }); }} />}
    </section>
    <section className="panel">
      <h2>参加者</h2>
      {participants.length === 0 ? <p>まだ誰も参加していません</p> : <ul className="participant-list">
        {participants.map(p => <li key={p.id}><span>{p.nickname}</span>{isHost && snapshot.own?.id !== p.id && <button type="button" className="secondary-button small" disabled={busy} onClick={() => void act(() => send({ type: 'remove', participantId: p.id }))}>削除</button>}</li>)}
      </ul>}
      {isHost && <>
        <h3>出題設定</h3>
        <CompetitionSettingsForm value={settings} onChange={setSettings} disabled={busy} mate={room.kind === 'mate'} />
        {stableSettingsJson(settings) !== stableSettingsJson(room.settings) && <p className="settings-hint">設定が未反映です。「設定を反映」を押してから開始してください。</p>}
        <div className="play-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void act(() => send({ type: 'settings', settings }))}>設定を反映</button>
          <button type="button" className="primary-action" disabled={busy || stableSettingsJson(settings) !== stableSettingsJson(room.settings) || participants.length < (room.kind === 'mate' ? 2 : 1)} onClick={() => void act(() => send({ type: 'start' }))}>開始する</button>
          <button type="button" className="danger-button" disabled={busy} onClick={() => { if (confirm('ルームを解散しますか？')) void act(() => send({ type: 'cancel' })); }}>解散する</button>
        </div>
      </>}
      {!isHost && <p className="settings-line">{settingsSummary(room.settings)}</p>}
    </section>
  </div>;
}

function HostRace({ snapshot, send }: { snapshot: Snapshot; send: (m: Parameters<RoomConnection['send']>[0]) => Promise<unknown> }) {
  const participants = snapshot.participants ?? [];
  const maxScore = snapshot.room.maxScore;
  return <section className="panel">
    <h2>進行状況</h2>
    <ul className="race-list">
      {participants.map(p => <li key={p.id} className="race-row">
        <span className="race-name">{p.nickname}</span>
        <span className="race-bar"><span className="race-fill" style={{ width: `${Math.min(100, (p.correctCount / Math.max(1, maxScore)) * 100)}%` }} /></span>
        <span className="race-score">{snapshot.room.settings.gradingMode === 'deferred' ? `${p.answeredCount}問回答` : `${p.correctCount}点`}{p.finished ? '（終了）' : ''}</span>
      </li>)}
    </ul>
    <div className="play-actions">
      <button type="button" className="danger-button" onClick={() => { if (confirm('競技を中断して終了しますか？')) void send({ type: 'finish' }).catch(() => {}); }}>中断して終了</button>
    </div>
  </section>;
}

function Results({ snapshot, isClassTeacher }: { snapshot: Snapshot; isClassTeacher: boolean }) {
  const results = snapshot.results;
  const [selected, setSelected] = useState<string | null>(null);
  if (!results) return <section className="panel"><p>結果を読み込んでいます…</p></section>;
  const fmt = (cs: number) => `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
  return <div className="results-stack">
    {results.own && <section className="panel own-result">
      <h2>{results.own.rank}位　{results.own.correctCount}点</h2>
      <p>タイム {fmt(results.own.elapsedCs)}{results.own.finalSyncUnconfirmed && '（最終同期未確認）'}</p>
    </section>}
    <section className="panel">
      <h2>ランキング</h2>
      <ol className="ranking-list">
        {(results.ranking ?? []).map(r => <li key={r.nickname + r.rank}><span>{r.rank}位　{r.nickname}</span><span>{r.correctCount}点　{fmt(r.elapsedCs)}</span></li>)}
      </ol>
      {results.averageCorrectCount !== undefined && <p>平均 {results.averageCorrectCount.toFixed(1)}点</p>}
    </section>
    {results.questions && <section className="panel"><h2>自分の復習</h2><ReviewList questions={results.questions} /></section>}
    {isClassTeacher && results.reviews && <section className="panel">
      <h2>全員の解答</h2>
      <div className="choice-grid">
        {(snapshot.participants ?? []).map(p => <button key={p.id} type="button" className="choice" aria-pressed={selected === p.id} onClick={() => setSelected(p.id)}>{p.nickname}</button>)}
      </div>
      {selected && results.reviews[selected] && <ReviewList questions={results.reviews[selected]} />}
    </section>}
  </div>;
}
