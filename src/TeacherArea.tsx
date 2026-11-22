import { useCallback, useEffect, useState } from 'react';
import { readTeacherSession, teacherMutation, type TeacherSession } from './teacher-auth';
import { CompetitionSettingsForm, DEFAULT_SETTINGS } from './Settings';
import { AdminCompounds } from './AdminCompounds';
import { saveCredential } from './credentials';
import type { Credential } from './protocol';
import type { OrgoGameSettings } from '../game/types';

export function TeacherArea({ onOpenRoom }: { onOpenRoom(c: Credential): void }) {
  const [session, setSession] = useState<TeacherSession | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<'class' | 'management'>('class');
  const refresh = useCallback(() => { setSession(null); setError(''); setRetry(v => v + 1); }, []);
  useEffect(() => {
    let live = true;
    readTeacherSession().then(v => { if (live) setSession(v); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [retry]);
  const logout = async () => {
    if (!session) return;
    try { await teacherMutation('/api/auth/logout', 'POST', session); } catch { /* session may already be gone */ }
    refresh();
  };

  if (!session && !error) return <main className="page-shell"><section className="panel"><p role="status">ログイン状況を確認しています…</p></section></main>;
  if (!session?.identity) {
    const authError = new URLSearchParams(location.hash.split('?')[1]).get('authError');
    return <main className="page-shell"><section className="panel">
      <p className="eyebrow">TEACHER</p><h1>教員ログイン</h1>
      <p>クラスコンペの作成と管理には、許可されたGoogleアカウントでログインしてください。</p>
      {authError && <p role="alert" className="error">{authError === 'forbidden' ? 'このGoogleアカウントは教員として登録されていません。マスター教員に登録を依頼してください。' : 'Google認証を確認できませんでした。もう一度ログインしてください。'}</p>}
      {error ? <><p role="alert" className="error">{error}</p><button type="button" className="secondary-button" onClick={refresh}>再確認する</button></>
        : session?.ready ? <a className="primary-link" href="/api/auth/google/start">Googleでログイン</a>
        : <p role="status">教員認証の設定を準備中です。</p>}
      <p><a href="#/">ホームへ戻る</a></p>
    </section></main>;
  }
  return <main className="page-shell teacher-area">
    <section className="panel teacher-workspace">
      <header className="teacher-workspace-header">
        <div>
          <p className="eyebrow">TEACHER</p>
          <h1>{view === 'class' ? 'クラスコンペを作る' : '教員用の管理設定'}</h1>
          <p>{view === 'class' ? '条件を選んで、クラスのコンペを始めましょう。' : '教員のアクセスと、アプリ全体の出題を管理します。'}</p>
        </div>
        <div className="teacher-workspace-navigation">
          <span className="teacher-role">{session.isMaster ? 'マスター教員' : '許可教員'}</span>
          <div className="teacher-identity"><span>{session.identity.email}</span><button type="button" className="secondary-button" onClick={() => void logout()}>ログアウト</button></div>
          <div className="teacher-view-switch" role="group" aria-label="教員ページの表示">
            <button type="button" className="choice" aria-pressed={view === 'class'} onClick={() => setView('class')}>クラスコンペ</button>
            <button type="button" className="choice" aria-pressed={view === 'management'} onClick={() => setView('management')}>管理設定</button>
          </div>
        </div>
      </header>
      <div hidden={view !== 'class'}><CreateClassRoom session={session} onOpenRoom={onOpenRoom} /></div>
      <div hidden={view !== 'management'} className="teacher-management">
        {session.isMaster && <Allowlist session={session} />}
        {session.isMaster && <MateSetting session={session} />}
        <AdminCompounds session={session} master={session.isMaster} />
      </div>
      <div className="play-actions"><a className="secondary-button" href="#/">ホームへ戻る</a></div>
    </section>
  </main>;
}

function CreateClassRoom({ session, onOpenRoom }: { session: TeacherSession; onOpenRoom(c: Credential): void }) {
  const [settings, setSettings] = useState<OrgoGameSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', 'x-competition-csrf': session.csrfToken ?? '' }, body: JSON.stringify({ kind: 'class', settings }) });
      const data = await response.json() as { code?: string; token?: string; expiresAtMs?: number; error?: string };
      if (!response.ok || !data.code || !data.token) throw new Error(data.error ?? 'ルームを作成できませんでした');
      const credential: Credential = { code: data.code, role: 'teacher', token: data.token, expiresAtMs: data.expiresAtMs!, kind: 'class' };
      saveCredential(credential);
      onOpenRoom(credential);
    } catch (e) { setError(e instanceof Error ? e.message : 'ルームを作成できませんでした'); }
    finally { setBusy(false); }
  };
  return <section className="teacher-create">
    <CompetitionSettingsForm value={settings} onChange={setSettings} disabled={busy} />
    {error && <p role="alert" className="error">{error}</p>}
    <button type="button" className="primary-action" disabled={busy} onClick={() => void create()}>ルームを作成</button>
  </section>;
}

function Allowlist({ session }: { session: TeacherSession }) {
  const [emails, setEmails] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [masterEmail, setMasterEmail] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(() => {
    teacherMutation<{ emails: string[]; notes: Record<string, string>; masterEmail: string }>('/api/teacher/allowlist', 'GET', session)
      .then(d => { setEmails(d.emails); setNotes(d.notes); setMasterEmail(d.masterEmail); })
      .catch((e: Error) => setMessage(e.message));
  }, [session]);
  useEffect(load, [load]);
  const act = async (method: string, body: unknown) => {
    setMessage('');
    try { await teacherMutation('/api/teacher/allowlist', method, session, body); load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : '操作できませんでした'); }
  };
  return <section className="panel">
    <h2>許可教員（マスター：{masterEmail}）</h2>
    <ul className="participant-list">
      {emails.map(e => <li key={e}><span>{e}{notes[e] ? `（${notes[e]}）` : ''}</span>
        <button type="button" className="secondary-button small" onClick={() => void act('DELETE', { email: e })}>削除</button></li>)}
    </ul>
    <div className="admin-filters">
      <input type="email" placeholder="メールアドレス" value={email} onChange={e => setEmail(e.target.value)} />
      <input type="text" placeholder="メモ（任意）" value={note} maxLength={100} onChange={e => setNote(e.target.value)} />
      <button type="button" className="primary-action" disabled={!email} onClick={() => { void act('POST', { email, note }); setEmail(''); setNote(''); }}>追加</button>
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}

function MateSetting({ session }: { session: TeacherSession }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    teacherMutation<{ mateEnabled: boolean }>('/api/teacher/mate-setting', 'GET', session).then(d => setEnabled(d.mateEnabled)).catch(() => setEnabled(null));
  }, [session]);
  const toggle = async () => {
    if (enabled === null) return;
    const next = await teacherMutation<{ mateEnabled: boolean }>('/api/teacher/mate-setting', 'PUT', session, { enabled: !enabled });
    setEnabled(next.mateEnabled);
  };
  return <section className="panel">
    <h2>メイトマッチの新規作成</h2>
    <p>現在：{enabled === null ? '確認中' : enabled ? 'ON' : 'OFF'}</p>
    <button type="button" className="secondary-button" disabled={enabled === null} onClick={() => void toggle()}>{enabled ? 'OFFにする' : 'ONにする'}</button>
  </section>;
}
