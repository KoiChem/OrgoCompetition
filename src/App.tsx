import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import type { Credential, Snapshot } from './protocol';
import { readCredential, recent, saveCredential } from './credentials';
import { RoomScreen } from './RoomScreen';
import { TeacherArea } from './TeacherArea';
import { CompetitionSettingsForm, DEFAULT_SETTINGS, settingsSummary } from './Settings';
import { useMateAvailability } from './mate-availability';
import { parseJoinCode } from './join-code';
import type { OrgoGameSettings } from '../game/types';

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
}
function savedNickname(): string {
  try { return localStorage.getItem('orgo-lite:nickname') ?? ''; } catch { return ''; }
}
function saveNickname(name: string) {
  try { localStorage.setItem('orgo-lite:nickname', name); } catch { /* ignore */ }
}

async function storedState(c: Credential): Promise<Snapshot> {
  const r = await fetch(`/api/rooms/${c.code}/state`, {
    headers: { authorization: `Bearer ${c.token}`, ...(c.role === 'participant' && c.participantId ? { 'x-participant-id': c.participantId } : {}) },
  });
  const body = await r.json();
  if (!r.ok) throw Object.assign(new Error(r.status === 410 ? '閲覧期限が切れました' : r.status === 403 ? '参加資格を確認できません' : '結果を取得できません。再試行してください'), { status: r.status });
  return body as Snapshot;
}

export default function App() {
  const [hash, setHash] = useState(location.hash);
  const [room, setRoom] = useState<Credential | null>(null);
  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const openRoom = useCallback((c: Credential) => setRoom(c), []);
  const leaveRoom = useCallback(() => setRoom(null), []);

  if (room) return <RoomScreen credential={room} onLeave={leaveRoom} />;
  if (hash.startsWith('#/teacher')) return <TeacherArea onOpenRoom={openRoom} />;
  if (hash.startsWith('#/mate/new')) return <MateCreatePage onOpenRoom={openRoom} />;
  if (hash.startsWith('#/history')) return <HistoryPage onOpenRoom={openRoom} />;
  const joinMatch = /^#\/join\/([A-Z2-9]{6})/.exec(hash) ?? /^#\/join\?code=([A-Z2-9]{6})/.exec(hash);
  if (joinMatch) return <JoinPage code={joinMatch[1]} onOpenRoom={openRoom} />;
  return <Home />;
}

function Home() {
  const mate = useMateAvailability();
  const active = useActiveRooms();
  return <main className="home-shell">
    <section className="home-card" aria-labelledby="home-title">
      <header>
        <p className="eyebrow">ORGO RUSH</p>
        <h1 id="home-title">オルゴコンペ</h1>
        <div className="home-participation-status">{active.checking ? <p role="status">参加状況を確認しています…</p> : null}</div>
      </header>
      <JoinCodeForm />
      <ActiveRooms {...active} />
      <nav className="home-nav" aria-label="ルームを作成・管理する">
        <a className="secondary-link" href="#/teacher">クラスコンペ</a>
        <a className="secondary-link" href={mate.enabled === true ? '#/mate/new' : undefined} aria-disabled={mate.enabled !== true}>メイトマッチ</a>
      </nav>
      {mate.error && <p role="alert" className="error">{mate.error}</p>}
      <nav className="home-nav" aria-label="履歴と関連アプリ">
        <a className="secondary-link" href="#/history">過去の結果</a>
        <a className="secondary-link" href="https://koichem.github.io/OrgoRush/" target="_blank" rel="noopener noreferrer">OrgoRush</a>
      </nav>
      <nav className="home-nav home-related" aria-label="関連アプリ">
        <a className="secondary-link" href="https://alkanecompetition.koichem.workers.dev/" target="_blank" rel="noopener noreferrer">アルカンコンペ</a>
        <a className="secondary-link" href="https://ionicformulacompetition-lite.koichem.workers.dev/" target="_blank" rel="noopener noreferrer">イオンコンペ</a>
      </nav>
    </section>
  </main>;
}

function JoinCodeForm() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const go = (value: string) => {
    const parsed = parseJoinCode(value);
    if (!parsed) { setError('参加コードは6文字で入力してください'); return; }
    location.hash = `/join/${parsed}`;
  };
  return <form className="join-form" onSubmit={e => { e.preventDefault(); go(code); }}>
    <label htmlFor="code">参加コード</label>
    <div className="join-row">
      <div className="join-entry">
        <button type="button" className="qr-button" aria-label="参加用QRコードを読み取る" title="QRコードを読み取る" onClick={() => setScanning(true)}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 2H2v5M17 2h5v5M22 17v5h-5M7 22H2v-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><path fill="currentColor" fillRule="evenodd" d="M5 5h6v6H5V5Zm2 2v2h2V7H7Zm6-2h6v6h-6V5Zm2 2v2h2V7h-2ZM5 13h6v6H5v-6Zm2 2v2h2v-2H7Z" /><path fill="currentColor" d="M13 13h2v2h-2zm4 0h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2z" /></svg>
        </button>
        <input id="code" name="code" inputMode="text" autoComplete="off" autoCapitalize="characters" maxLength={6} placeholder="ABC234" value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); }} required />
      </div>
      <button type="submit" className="primary-action join-submit">参加する</button>
    </div>
    {scanning && <QrScanner onCode={(value) => { setScanning(false); const parsed = parseJoinCode(value); if (parsed) location.hash = `/join/${parsed}`; else setError('QRコードから参加コードを読めませんでした'); }} onClose={() => setScanning(false)} />}
    {error && <p role="alert" className="error">{error}</p>}
  </form>;
}

function useActiveRooms() {
  const [rooms, setRooms] = useState<Credential[]>([]);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    const candidates = recent().filter(c => c.role === 'participant' || c.role === 'mate-host');
    setRooms([]); setFailed(false); setChecking(candidates.length > 0);
    void Promise.all(candidates.map(async c => {
      try {
        const s = await storedState(c);
        return ['WAITING', 'COUNTDOWN', 'RUNNING', 'COLLECTING'].includes(s.room.state) ? c : null;
      } catch (e) {
        if (live && ![403, 404, 410].includes((e as { status?: number }).status ?? 0)) setFailed(true);
        return null;
      }
    })).then(found => { if (live) { setRooms(found.filter((c): c is Credential => !!c)); setChecking(false); } });
    return () => { live = false; };
  }, [revision]);
  return { rooms, checking, failed, retry: () => setRevision(v => v + 1) };
}

function ActiveRooms({ rooms, checking, failed, retry }: ReturnType<typeof useActiveRooms>) {
  if (rooms.length === 0 && !(failed && !checking)) return null;
  return <section className="active-room-links" aria-label="参加中の競技">
    {rooms.length > 0 && <>
      <h2>参加中の競技</h2>
      <ul>{rooms.map(c => <li key={c.code + c.role}>
        <span>{c.kind === 'mate' ? 'メイトマッチ' : 'クラスコンペ'}</span>
        <a className="primary-link" href={`#/join/${c.code}`}>参加中の競技に戻る</a>
      </li>)}</ul>
    </>}
    {failed && !checking && <button type="button" className="secondary-button" onClick={retry}>参加状況を再確認</button>}
  </section>;
}

function JoinPage({ code, onOpenRoom }: { code: string; onOpenRoom(c: Credential): void }) {
  const existing = useRef(readCredential(code, 'participant'));
  const [nickname, setNickname] = useState(() => existing.current?.pending ? existing.current.nickname ?? '' : savedNickname());
  const [info, setInfo] = useState<{ room: { state: string; settings: OrgoGameSettings }; participantCount: number; capacity: number } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const pending = existing.current?.pending ? existing.current : null;
  const recovery = existing.current && !pending ? existing.current : null;
  const [recoveryState, setRecoveryState] = useState<'checking' | 'active' | 'finished' | 'cancelled' | 'invalid' | 'error'>('checking');
  const [recoveryRetry, setRecoveryRetry] = useState(0);
  useEffect(() => {
    if (!recovery) return;
    let live = true;
    setRecoveryState('checking');
    void storedState(recovery).then(s => {
      if (!live) return;
      if (s.results || s.room.state === 'FINISHED') setRecoveryState('finished');
      else if (s.room.state === 'CANCELLED') setRecoveryState('cancelled');
      else setRecoveryState('active');
    }).catch(e => {
      if (!live) return;
      setRecoveryState([403, 404, 410].includes((e as { status?: number }).status ?? 0) ? 'invalid' : 'error');
    });
    return () => { live = false; };
  }, [recovery, recoveryRetry]);
  useEffect(() => {
    let live = true;
    void fetch(`/api/rooms/${code}/info`).then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? 'ルーム情報を取得できませんでした');
      if (live) setInfo(body);
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'ルーム情報を取得できませんでした'); });
    return () => { live = false; };
  }, [code, retry]);

  const join = () => {
    const name = nickname.trim();
    if (!name) { setError('ニックネームを入力してください'); return; }
    saveNickname(name);
    const credential: Credential = pending ?? {
      code, role: 'participant', token: randomToken(),
      participantId: crypto.randomUUID(), nickname: name,
      expiresAtMs: Date.now() + 2 * 60 * 60 * 1000, pending: true,
    };
    credential.nickname = name;
    saveCredential(credential);
    onOpenRoom(credential);
  };

  return <main className="page-shell">
    <section className="panel">
      <p className="eyebrow">JOIN</p>
      <h1>競技に参加</h1>
      {recovery ? <div>
        {recoveryState === 'checking' ? <p role="status">参加資格を確認しています…</p>
          : recoveryState === 'finished' ? <><p>競技は終了しました。</p><button type="button" className="primary-action" onClick={() => onOpenRoom(recovery)}>結果を見る</button></>
          : recoveryState === 'active' ? <><h2>参加中の競技があります</h2><button type="button" className="primary-action" onClick={() => onOpenRoom(recovery)}>参加中の競技に戻る</button></>
          : recoveryState === 'error' ? <><p role="status">通信できませんでした。参加資格は保持されています。</p><button type="button" className="secondary-button" onClick={() => setRecoveryRetry(v => v + 1)}>参加資格を再確認</button></>
          : <p role="status">この参加資格では競技に戻れません。</p>}
      </div> : <>
        {info ? <div className="join-info">
          <p>{settingsSummary(info.room.settings)}</p>
          <p>参加 {info.participantCount}人 / 定員 {info.capacity}人</p>
        </div> : <p role="status">{error || 'ルーム情報を確認しています…'}</p>}
        {!info && error && <button type="button" className="secondary-button" onClick={() => { setError(''); setRetry(v => v + 1); }}>参加先を再確認</button>}
        {info && info.room.state !== 'WAITING' && <p role="status">参加受付は終了しました。</p>}
        {info && info.participantCount >= info.capacity && <p role="status">定員に達しました。</p>}
        <p>ニックネームだけを使います。本名や個人情報は入力しないでください。</p>
        <label>ニックネーム（1〜16文字）<input value={nickname} maxLength={16} autoComplete="nickname" onChange={e => setNickname(e.target.value)} /></label>
        {pending && <p role="status">前回の参加要求を確認します。</p>}
        <button type="button" className="primary-action" disabled={!info || !nickname.trim() || (!pending && !!info && (info.room.state !== 'WAITING' || info.participantCount >= info.capacity))} onClick={join}>{pending ? '参加を再確認' : '参加する'}</button>
        {error && info && <p role="alert" className="error">{error}</p>}
      </>}
      <p><a className="primary-link" href="#/">ホームへ戻る</a></p>
    </section>
  </main>;
}

function MateCreatePage({ onOpenRoom }: { onOpenRoom(c: Credential): void }) {
  const mate = useMateAvailability();
  const [settings, setSettings] = useState<OrgoGameSettings>(DEFAULT_SETTINGS);
  const [name, setName] = useState(savedNickname());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (mate.enabled === null) return <main className="page-shell"><section className="panel"><h1>メイトマッチを作る</h1>{mate.error ? <><p role="alert" className="error">{mate.error}</p><button type="button" className="secondary-button" onClick={mate.reload}>設定を再確認</button></> : <p role="status">設定を確認しています…</p>}<p><a className="primary-link" href="#/">ホームへ戻る</a></p></section></main>;
  if (!mate.enabled) return <main className="page-shell"><section className="panel"><h1>メイトマッチを作る</h1><p>メイトマッチの新規作成は停止中です。</p><p><a className="primary-link" href="#/">ホームへ戻る</a></p></section></main>;
  const create = async () => {
    if (!name.trim()) { setError('ニックネームを入力してください'); return; }
    setBusy(true); setError('');
    try {
      saveNickname(name.trim());
      const response = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'mate', nickname: name.trim(), settings }) });
      const data = await response.json() as { code?: string; token?: string; participantId?: string; expiresAtMs?: number; error?: string };
      if (!response.ok || !data.code || !data.token || !data.participantId) throw new Error(data.error ?? 'ルームを作成できませんでした');
      const credential: Credential = { code: data.code, role: 'mate-host', token: data.token, participantId: data.participantId, nickname: name.trim(), expiresAtMs: data.expiresAtMs!, kind: 'mate' };
      saveCredential(credential);
      onOpenRoom(credential);
    } catch (e) { setError(e instanceof Error ? e.message : 'ルームを作成できませんでした'); }
    finally { setBusy(false); }
  };
  return <main className="page-shell">
    <section className="panel wide">
      <h1>メイトマッチを作る</h1>
      <p>2〜4人で対戦します。作成者も解答します。</p>
      <label>あなたのニックネーム（1〜16文字）<input value={name} maxLength={16} onChange={e => setName(e.target.value)} /></label>
      <CompetitionSettingsForm value={settings} onChange={setSettings} disabled={busy} mate />
      {error && <p role="alert" className="error">{error}</p>}
      <div className="play-actions">
        <button type="button" className="primary-action" disabled={busy || !name.trim()} onClick={() => void create()}>{busy ? '作成中…' : 'メイトマッチを作成'}</button>
        <a className="secondary-button link-button" href="#/">ホームへ戻る</a>
      </div>
    </section>
  </main>;
}

function HistoryPage({ onOpenRoom }: { onOpenRoom(c: Credential): void }) {
  const [rows, setRows] = useState<{ credential: Credential; state?: Snapshot; message?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    void Promise.all(recent().map(async (credential): Promise<{ credential: Credential; state?: Snapshot; message?: string }> => {
      try {
        const state = await storedState(credential);
        return state.results ? { credential, state } : { credential, state, message: '競技中・結果確定待ち' };
      } catch (e) {
        return { credential, message: e instanceof Error ? e.message : '通信できません。再試行してください' };
      }
    })).then(next => {
      if (live) { setRows(next.sort((a, b) => (b.state?.room.createdAtMs ?? 0) - (a.state?.room.createdAtMs ?? 0))); setLoading(false); }
    });
    return () => { live = false; };
  }, [retry]);
  const render = (role: Credential['role']) => rows.filter(r => r.credential.role === role).map(({ credential: c, state: s, message }) => <li key={c.code + c.role} className="review-card">
    {s?.results ? <>
      <strong>{s.room.kind === 'mate' ? 'メイトマッチ' : 'クラスコンペ'}・{new Date(s.room.createdAtMs).toLocaleString('ja-JP')}</strong>
      <p>{settingsSummary(s.room.settings)}</p>
      <p>{s.room.endReason === 'interrupted' ? '中断終了' : '終了'}{s.results.own ? `・${s.results.own.rank}位・正解${s.results.own.correctCount}` : ''}</p>
      <p>閲覧期限：{new Date(s.room.expiresAtMs).toLocaleString('ja-JP')}</p>
      <button type="button" className="secondary-button" onClick={() => onOpenRoom(c)}>結果を見る</button>
    </> : <>
      <strong>{c.kind === 'mate' ? 'メイトマッチ' : 'クラスコンペ'}・{c.code}</strong>
      <p>{message}</p>
      {s && ['WAITING', 'COUNTDOWN', 'RUNNING', 'COLLECTING'].includes(s.room.state) && <button type="button" className="secondary-button" onClick={() => onOpenRoom(c)}>参加中の競技に戻る</button>}
    </>}
  </li>);
  return <main className="page-shell">
    <section className="panel wide">
      <h1>過去の結果</h1>
      <p>このブラウザで参加・作成した競技を、閲覧期限内に確認できます。</p>
      {loading ? <p role="status">結果を確認しています…</p> : <>
        {rows.length === 0 && <p>閲覧できる結果はありません。</p>}
        <h2>参加した競技</h2>
        <ul className="review-list">{render('participant')}</ul>
        <h2>主催した競技</h2>
        <ul className="review-list">{render('teacher')}{render('mate-host')}</ul>
        <button type="button" className="secondary-button" onClick={() => { setLoading(true); setRetry(v => v + 1); }}>再確認する</button>
      </>}
      <p><a className="primary-link" href="#/">ホームへ戻る</a></p>
    </section>
  </main>;
}

function QrScanner({ onCode, onClose }: { onCode(value: string): void; onClose(): void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null, raf = 0, stopped = false;
    const canvas = document.createElement('canvas');
    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(image.data, image.width, image.height);
          if (found) { onCode(found.data); return; }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(s => { stream = s; if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play(); } tick(); })
      .catch(() => setError('カメラを使えませんでした。参加コードを入力してください。'));
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()); };
  }, [onCode]);
  return <div className="qr-modal" role="dialog" aria-label="QRコード読み取り">
    <video ref={videoRef} playsInline muted />
    {error && <p role="alert" className="error">{error}</p>}
    <button type="button" className="secondary-button" onClick={onClose}>閉じる</button>
  </div>;
}
