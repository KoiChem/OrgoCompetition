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
import { CollectingParade } from './CollectingParade';
import { HostRunner } from './HostRunner';
import { colorForRunner } from './host-race-colors';
import './host-runner.css';
import { HostSoundGate, playBoundary, playTick, primeAudio, useHostSoundToggle } from './host-sound';

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
        const { room } = state;
        const resumeUntilMs = ['FINISHED', 'CANCELLED'].includes(room.state) ? 0
          : room.deadlineAtMs ? (room.cutoffAtMs ?? room.deadlineAtMs) + 3000 : room.expiresAtMs;
        if ((credential.pending && state.own) || credential.resumeUntilMs !== resumeUntilMs) {
          credential.pending = false;
          credential.nickname = state.own?.nickname ?? credential.nickname;
          credential.kind = room.kind;
          credential.expiresAtMs = room.expiresAtMs;
          credential.resumeUntilMs = resumeUntilMs;
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
  const connected = status === '接続済み' || status === '送信中';

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

  if (!snapshot) return <main className="page-shell"><section className="panel"><h1>OrgoRush Competition</h1><p role="status">{status}</p>{error && <p role="alert" className="error">{error}</p>}<button type="button" className="secondary-button" onClick={onLeave}>ホームへ戻る</button></section></main>;

  const room = snapshot.room;
  const remaining = room.deadlineAtMs ? room.deadlineAtMs - serverNow : null;
  const untilStart = room.startAtMs ? room.startAtMs - serverNow : null;
  const classHost = credential.role === 'teacher' && room.kind === 'class';
  const collecting = room.state === 'COLLECTING';
  const countingDown = room.state === 'COUNTDOWN';
  const showingPlayer = !classHost && (room.state === 'RUNNING' || collecting && room.settings.gradingMode === 'deferred' && !snapshot.own?.finished);

  return <main className={`page-shell room-shell${classHost ? ' class-host-shell' : ''}`}>
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

    {room.state === 'WAITING' && <Lobby snapshot={snapshot} isHost={isHost} joinUrl={joinUrl} send={send} connected={connected} />}
    {countingDown && !classHost && <section className="panel countdown-panel"><p className="countdown-number">{Math.max(1, Math.ceil((untilStart ?? 0) / 1000))}</p><p>まもなく開始！</p></section>}
    {classHost && (countingDown || room.state === 'RUNNING' || collecting) && <HostRace snapshot={snapshot} send={send} connected={connected} untilStart={untilStart ?? 0} />}
    {showingPlayer && <Player snapshot={snapshot} connection={connectionRef.current!} verdictSignal={verdictSignal} connected={connected} serverNow={() => Date.now() + offsetRef.current} />}
    {collecting && !classHost && !showingPlayer && <section className="panel"><h2>集計しています</h2><p>全員の結果をまとめています…</p></section>}
    {room.state === 'FINISHED' && <Results snapshot={snapshot} isClassTeacher={classHost} />}
    {room.state === 'CANCELLED' && <section className="panel"><h2>このルームは解散しました</h2><button type="button" className="secondary-button" onClick={onLeave}>ホームへ戻る</button></section>}
    {isHost && room.state === 'RUNNING' && credential.role === 'mate-host' && <div className="play-actions"><button type="button" className="danger-button" onClick={() => { if (confirm('競技を終了しますか？')) void send({ type: 'finish' }).catch(() => {}); }}>競技を終了する</button></div>}
  </main>;
}

function stableSettingsJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSettingsJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableSettingsJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

type SendRoomMessage = (message: Parameters<RoomConnection['send']>[0]) => Promise<unknown>;

function Lobby({ snapshot, isHost, joinUrl, send, connected }: { snapshot: Snapshot; isHost: boolean; joinUrl: string; send: SendRoomMessage; connected: boolean }) {
  const room = snapshot.room;
  const [settings, setSettings] = useState<OrgoGameSettings>(room.settings);
  const [busy, setBusy] = useState(false);
  const participants = snapshot.participants ?? [];
  const changed = stableSettingsJson(settings) !== stableSettingsJson(room.settings);
  const disabled = busy || !connected;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch { /* error shown by room */ }
    finally { setBusy(false); }
  };

  if (!isHost) return <section className="panel">
    <h1>開始を待っています</h1>
    {snapshot.own && <NicknameEditor nickname={snapshot.own.nickname} disabled={disabled} onSave={async nickname => { await send({ type: 'nickname', nickname }); }} />}
    <p className="settings-line">{settingsSummary(room.settings)}</p>
    <ul className="participant-list">{participants.map(p => <li key={p.id}>{p.nickname}</li>)}</ul>
  </section>;

  return <>
    <div className="lobby-grid host-lobby">
      <section className="panel join-panel">
        <h1>参加コード</h1>
        <p className="room-code">{room.code}</p>
        <QRCodeSVG value={joinUrl} size={224} title="参加用QRコード" />
      </section>
      <section className="panel host-lobby-roster">
        <h2>参加者 {room.participantCount} / {room.kind === 'mate' ? 4 : 50}人</h2>
        {participants.length === 0 ? <p>参加を待っています</p> : <ul className="participant-list">
          {participants.map(p => <li key={p.id}><span>{p.nickname}</span>{snapshot.own?.id !== p.id && <button type="button" className="secondary-button small" disabled={disabled} aria-label={`${p.nickname}を削除`} onClick={() => void act(() => send({ type: 'remove', participantId: p.id }))}>削除</button>}</li>)}
        </ul>}
        {snapshot.own && <NicknameEditor nickname={snapshot.own.nickname} disabled={disabled} onSave={async nickname => { await send({ type: 'nickname', nickname }); }} />}
        {changed && <p className="settings-hint" role="status">設定を反映してから開始してください。</p>}
        <div className="play-actions">
          <button type="button" className="primary-action" disabled={disabled || changed || participants.length < (room.kind === 'mate' ? 2 : 1)} onClick={() => { primeAudio(); void act(() => send({ type: 'start' })); }}>開始する</button>
          <button type="button" className="danger-button" disabled={disabled} onClick={() => { if (confirm('ルームを解散しますか？')) void act(() => send({ type: 'cancel' })); }}>解散する</button>
        </div>
      </section>
    </div>
    <details className="panel host-settings">
      <summary>競技設定を変更</summary>
      <CompetitionSettingsForm value={settings} onChange={setSettings} disabled={disabled} mate={room.kind === 'mate'} />
      <button type="button" className="secondary-button" disabled={disabled || !changed} onClick={() => void act(() => send({ type: 'settings', settings }))}>設定を反映</button>
    </details>
  </>;
}

function HostRace({ snapshot, send, connected, untilStart }: { snapshot: Snapshot; send: SendRoomMessage; connected: boolean; untilStart: number }) {
  const participants = snapshot.participants ?? [];
  const { maxScore, settings, state } = snapshot.room;
  const deferred = settings.gradingMode === 'deferred';
  const unit = deferred ? (settings.mode === 'four' ? '欄' : '組') : '点';
  const collecting = state === 'COLLECTING';
  const countingDown = state === 'COUNTDOWN';
  const [busy, setBusy] = useState(false);
  const [light, setLight] = useState(() => {
    try { return localStorage.getItem('orgo-lite:host-motion') === 'light'; }
    catch { return false; }
  });
  const toggleMotion = () => {
    const next = !light;
    setLight(next);
    try { localStorage.setItem('orgo-lite:host-motion', next ? 'light' : 'normal'); } catch { /* motion preference is optional */ }
  };
  const end = async () => {
    if (!confirm('競技を中断して終了しますか？')) return;
    setBusy(true);
    try { await send({ type: 'finish' }); } catch { /* error shown by room */ }
    finally { setBusy(false); }
  };
  const rows = <ul className="race-list">
    {participants.map(p => {
      const value = deferred ? p.answeredCount : p.correctCount;
      return <li key={p.id} className="race-row">
        <span className="race-name">{p.nickname}</span>
        <div className="race-track">
          <progress className="race-progress" aria-label={`${p.nickname}の${deferred ? '入力済み' : '得点'}`} value={value} max={maxScore} />
          {!collecting && <span className="race-marker" style={{ left: `${Math.min(100, value * 100 / maxScore)}%` }}>
            <HostRunner id={p.id} color={colorForRunner(snapshot.room.code, p.joinedOrder)} goal={!deferred && value >= maxScore} stopped={false} rest={countingDown || deferred && p.finished} />
          </span>}
        </div>
        <span className="race-score">{value} / {maxScore}{unit}{p.finished && <small>{deferred ? '提出済み' : '完了'}</small>}</span>
      </li>;
    })}
  </ul>;

  return <section className={`panel host-progress host-race${light ? ' is-light' : ''}${collecting ? ' host-collecting' : ''}`}>
    {collecting && <CollectingParade roomId={snapshot.room.code} participants={participants} light={light} />}
    <div className="host-progress-heading">
      {!collecting && <h1>{countingDown ? 'まもなく開始' : '進行状況'}</h1>}
      {countingDown && <p className="countdown-number" aria-live="off">{Math.max(1, Math.ceil(untilStart / 1000))}</p>}
      <p>{deferred ? '提出済み' : '完了'} {participants.filter(p => p.finished).length} / {participants.length}人</p>
    </div>
    {collecting ? <details><summary>参加者の進捗を表示</summary>{rows}</details> : rows}
    {!collecting && <div className="play-actions">
      <button type="button" className="secondary-button" aria-pressed={light} onClick={toggleMotion}>軽量表示 {light ? 'ON' : 'OFF'}</button>
      {state === 'RUNNING' && <button type="button" className="danger-button" disabled={!connected || busy} onClick={() => void end()}>中断して終了</button>}
    </div>}
  </section>;
}

function Results({ snapshot, isClassTeacher }: { snapshot: Snapshot; isClassTeacher: boolean }) {
  const results = snapshot.results;
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (!results) return <section className="panel"><p>結果を読み込んでいます…</p></section>;
  const fmt = (cs: number) => `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
  const ranking = results.ranking ?? [];
  const visibleRanking = isClassTeacher && !showAll ? ranking.filter(row => row.rank <= 5) : ranking;
  return <div className="results-stack">
    {results.own && <section className="panel own-result">
      <h2>{results.own.rank}位　{results.own.correctCount}点</h2>
      <p>タイム {fmt(results.own.elapsedCs)}{results.own.finalSyncUnconfirmed && '（最終同期未確認）'}</p>
    </section>}
    <section className="panel">
      <h2>{isClassTeacher ? '競技結果' : 'ランキング'}</h2>
      {isClassTeacher && <p>{snapshot.room.endReason === 'interrupted' ? '中断終了' : '競技終了'} · {ranking.length}人</p>}
      <ol id="room-ranking" className="ranking-list">
        {visibleRanking.map(r => <li key={r.nickname + r.rank}><span>{r.rank}位　{r.nickname}</span><span>{r.correctCount}点　{fmt(r.elapsedCs)}{r.finalSyncUnconfirmed && <small>最終同期未確認</small>}</span></li>)}
      </ol>
      {results.averageCorrectCount !== undefined && <p>平均 {results.averageCorrectCount.toFixed(1)}点</p>}
      {isClassTeacher && ranking.some(r => r.rank > 5) && <button type="button" className="secondary-button" aria-expanded={showAll} aria-controls="room-ranking" onClick={() => setShowAll(current => !current)}>{showAll ? '上位5位まで表示' : '全員の結果を表示'}</button>}
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
