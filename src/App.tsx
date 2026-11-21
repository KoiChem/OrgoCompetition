import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import type { Credential } from './protocol';
import { readCredential, recent, saveCredential } from './credentials';
import { RoomScreen } from './RoomScreen';
import { TeacherArea } from './TeacherArea';
import { CompetitionSettingsForm, DEFAULT_SETTINGS } from './Settings';
import { useMateAvailability } from './mate-availability';
import type { OrgoGameSettings } from '../game/types';

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
}
function savedNickname(): string {
  try { return localStorage.getItem('orgo-lite:nickname') ?? ''; } catch { return ''; }
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
  const joinCode = /^#\/join\/([A-Z2-9]{6})/.exec(hash)?.[1] ?? '';
  return <Home initialCode={joinCode} onOpenRoom={openRoom} />;
}

function Home({ initialCode, onOpenRoom }: { initialCode: string; onOpenRoom(c: Credential): void }) {
  const [code, setCode] = useState(initialCode);
  const [nickname, setNickname] = useState(savedNickname());
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const mate = useMateAvailability();
  useEffect(() => { if (initialCode) setCode(initialCode); }, [initialCode]);

  const join = () => {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(normalized)) { setError('参加コードは6文字で入力してください'); return; }
    const name = nickname.trim();
    if (!name) { setError('ニックネームを入力してください'); return; }
    const existing = readCredential(normalized, 'participant');
    if (existing && existing.nickname === name) { onOpenRoom(existing); return; }
    try { localStorage.setItem('orgo-lite:nickname', name); } catch { /* ignore */ }
    const credential: Credential = {
      code: normalized, role: 'participant', token: randomToken(),
      participantId: crypto.randomUUID(), nickname: name,
      expiresAtMs: Date.now() + 2 * 60 * 60 * 1000, pending: true,
    };
    saveCredential(credential);
    onOpenRoom(credential);
  };

  return <main className="page-shell home-shell">
    <header className="home-header">
      <h1>オルゴコンペ</h1>
      <p>OrgoRushでクラス対戦・メイト対戦</p>
    </header>
    <section className="panel">
      <h2>コンペに参加する</h2>
      <label>参加コード<input value={code} maxLength={6} autoCapitalize="characters" placeholder="ABC123" onChange={e => setCode(e.target.value.toUpperCase())} /></label>
      <label>ニックネーム<input value={nickname} maxLength={16} placeholder="名前" onChange={e => setNickname(e.target.value)} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="play-actions">
        <button type="button" className="primary-action" onClick={join}>参加する</button>
        <button type="button" className="secondary-button" onClick={() => setScanning(true)}>QRコードで参加</button>
      </div>
    </section>
    {scanning && <QrScanner onCode={(value) => { setScanning(false); const m = /([A-Z2-9]{6})/.exec(value.toUpperCase()); if (m) setCode(m[1]); }} onClose={() => setScanning(false)} />}
    <MateCreate enabled={mate.enabled} nickname={nickname} onOpenRoom={onOpenRoom} />
    <section className="panel">
      <h2>クラスコンペ（教員）</h2>
      <p>教員はGoogleログインでルームを作成・管理できます。</p>
      <a className="primary-link" href="#/teacher">教員ページへ</a>
    </section>
    <RecentList onOpenRoom={onOpenRoom} />
  </main>;
}

function MateCreate({ enabled, nickname, onOpenRoom }: { enabled: boolean | null; nickname: string; onOpenRoom(c: Credential): void }) {
  const [settings, setSettings] = useState<OrgoGameSettings>(DEFAULT_SETTINGS);
  const [name, setName] = useState(nickname);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (nickname && !name) setName(nickname); }, [nickname, name]);
  if (enabled === null) return <section className="panel"><h2>メイトマッチ</h2><p role="status">設定を確認しています…</p></section>;
  if (!enabled) return <section className="panel"><h2>メイトマッチ</h2><p>いまは新規作成を停止中です。</p></section>;
  const create = async () => {
    if (!name.trim()) { setError('ニックネームを入力してください'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'mate', nickname: name.trim(), settings: { ...settings, gradingMode: 'immediate' } }) });
      const data = await response.json() as { code?: string; token?: string; participantId?: string; expiresAtMs?: number; error?: string };
      if (!response.ok || !data.code || !data.token || !data.participantId) throw new Error(data.error ?? 'ルームを作成できませんでした');
      const credential: Credential = { code: data.code, role: 'mate-host', token: data.token, participantId: data.participantId, nickname: name.trim(), expiresAtMs: data.expiresAtMs!, kind: 'mate' };
      saveCredential(credential);
      onOpenRoom(credential);
    } catch (e) { setError(e instanceof Error ? e.message : 'ルームを作成できませんでした'); }
    finally { setBusy(false); }
  };
  return <section className="panel">
    <h2>メイトマッチを作る（2〜4人）</h2>
    <label>あなたのニックネーム<input value={name} maxLength={16} onChange={e => setName(e.target.value)} /></label>
    <CompetitionSettingsForm value={{ ...settings, gradingMode: 'immediate' }} onChange={setSettings} disabled={busy} mate />
    {error && <p role="alert" className="error">{error}</p>}
    <button type="button" className="primary-action" disabled={busy} onClick={() => void create()}>メイトマッチを作成</button>
  </section>;
}

function RecentList({ onOpenRoom }: { onOpenRoom(c: Credential): void }) {
  const [items] = useState<Credential[]>(() => recent());
  if (!items.length) return null;
  const label = (c: Credential) => c.role === 'teacher' ? '教員（クラス）' : c.role === 'mate-host' ? 'メイト作成者' : '参加者';
  return <section className="panel">
    <h2>最近のルーム</h2>
    <ul className="recent-list">
      {items.map(c => <li key={c.code + c.role}>
        <span>{c.code}　{label(c)}{c.nickname ? `　${c.nickname}` : ''}</span>
        <button type="button" className="secondary-button small" onClick={() => onOpenRoom(c)}>開く</button>
      </li>)}
    </ul>
  </section>;
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
