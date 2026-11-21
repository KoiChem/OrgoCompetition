import { useEffect, useRef, useState } from 'react';
import { COMPOUND_BY_ID, type AnswerFieldId, type PublicQuestion } from '../game/types';
import type { ClientMessage, Snapshot, Verdict } from './protocol';
import type { RoomConnection } from './socket';
import { playAnswerSound } from './host-sound';
import { ReopenSubmission } from './ReopenSubmission';
import { mergeDrafts, readDrafts, writeDraft } from './drafts';

type Send = (message: ClientMessage) => Promise<unknown>;

function useSender(connection: RoomConnection, snapshot: Snapshot) {
  const serverSeq = snapshot.own?.lastSeq ?? 0;
  const serverSeqRef = useRef(serverSeq);
  serverSeqRef.current = serverSeq;
  const seqRef = useRef(serverSeq);
  useEffect(() => { seqRef.current = Math.max(seqRef.current, serverSeq); }, [serverSeq]);
  const send: Send = async (message) => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    try { return await connection.send({ ...message, seq }); }
    catch (e) { seqRef.current = serverSeqRef.current; throw e; }
  };
  return send;
}

function FourPromptView({ question }: { question: PublicQuestion }) {
  const p = question.prompt;
  if (p.kind !== 'four') return null;
  return <div className="prompt-area">
    {p.direction === 'A' && <><p className="prompt-label">この名前の構造はどれ？</p><p className="prompt-name">{p.targetName}</p></>}
    {p.direction === 'B' && <><p className="prompt-label">この構造の名前はどれ？</p><img className="structure-img big" src={`/${p.targetStructure}`} alt="構造式" /></>}
    {p.direction === 'C' && <><p className="prompt-label">この性質をもつ化合物はどれ？</p><p className="prompt-properties">{p.properties}</p></>}
    {p.direction === 'D' && <><p className="prompt-label">この性質をもつ化合物の構造はどれ？</p><p className="prompt-properties">{p.properties}</p></>}
  </div>;
}

function PairBoard({ question, locked, selected, onSelectStructure, onSelectName }: {
  question: PublicQuestion;
  locked: Record<string, string>;
  selected: { structure: string | null; name: string | null };
  onSelectStructure(id: string): void;
  onSelectName(id: string): void;
}) {
  const p = question.prompt;
  if (p.kind !== 'pair') return null;
  const usedStructures = new Set(Object.values(locked).map(v => v.split('=')[0]));
  const usedNames = new Set(Object.values(locked).map(v => v.split('=')[1]));
  return <div className="pair-board">
    <div className="pair-column">
      <p className="pair-column-label">構造</p>
      {p.structures.map(id => <button key={id} type="button" className="pair-card structure-card" aria-pressed={selected.structure === id} disabled={usedStructures.has(id)} onClick={() => onSelectStructure(id)}>
        <img className="structure-img" src={`/${COMPOUND_BY_ID.get(id)?.structureSvg}`} alt={COMPOUND_BY_ID.get(id)?.nameJa ?? id} />
      </button>)}
    </div>
    <div className="pair-column">
      <p className="pair-column-label">名前</p>
      {p.names.map(id => <button key={id} type="button" className="pair-card name-card" aria-pressed={selected.name === id} disabled={usedNames.has(id)} onClick={() => onSelectName(id)}>
        {COMPOUND_BY_ID.get(id)?.nameJa ?? id}
      </button>)}
    </div>
  </div>;
}

export function Player({ snapshot, connection, verdictSignal }: { snapshot: Snapshot; connection: RoomConnection; verdictSignal: { verdict: Verdict; n: number } | null }) {
  const send = useSender(connection, snapshot);
  const settings = snapshot.room.settings;
  if (settings.gradingMode === 'deferred') return <DeferredPlayer snapshot={snapshot} send={send} />;
  return <ImmediatePlayer snapshot={snapshot} send={send} verdictSignal={verdictSignal} onReview={() => connection.send({ type: 'review' })} />;
}

function ImmediatePlayer({ snapshot, send, verdictSignal, onReview }: { snapshot: Snapshot; send: Send; verdictSignal: { verdict: Verdict; n: number } | null; onReview(): Promise<unknown> }) {
  const question = snapshot.question;
  const [feedback, setFeedback] = useState('');
  const [sel, setSel] = useState<{ structure: string | null; name: string | null }>({ structure: null, name: null });
  const [locked, setLocked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const lastVerdictN = useRef(0);
  const questionId = question?.id;

  useEffect(() => { setSel({ structure: null, name: null }); setLocked({}); setFeedback(''); }, [questionId]);
  useEffect(() => {
    if (!verdictSignal || verdictSignal.n === lastVerdictN.current) return;
    lastVerdictN.current = verdictSignal.n;
    const v = verdictSignal.verdict;
    playAnswerSound(v.correct);
    if (v.passed) setFeedback('パスしました');
    else if (v.correct) {
      setFeedback('正解！');
      if (question && question.prompt.kind === 'pair') {
        // The pair that was just confirmed is locked locally for display.
        setLocked(prev => (sel.structure && sel.name && !prev[v.fieldId] ? { ...prev, [v.fieldId]: `${sel.structure}=${sel.name}` } : prev));
        setSel({ structure: null, name: null });
      }
    } else setFeedback('ちがうみたい。もう一度考えてみよう');
  }, [verdictSignal, question, sel]);

  const own = snapshot.own;
  if (own?.finished) return <section className="panel"><h2>おつかれさま！</h2><p>全問終わりました。結果の発表を待ってね。</p></section>;
  if (!question) return <section className="panel"><p role="status">問題を準備しています…</p></section>;

  const resolved = new Set(question.progress.resolvedFieldIds);
  const unresolvedFields = question.fields.filter(f => !resolved.has(f.id));
  const act = async (message: ClientMessage) => {
    setBusy(true);
    try { await send(message); } catch { /* room screen shows the error */ } finally { setBusy(false); }
  };
  const answerFour = (id: string) => void act({ type: 'answer', questionId: question.id, fieldId: 'choice', value: id });
  const confirmPair = () => {
    if (!sel.structure || !sel.name || !unresolvedFields.length) return;
    void act({ type: 'answer', questionId: question.id, fieldId: unresolvedFields[0].id, value: `${sel.structure}=${sel.name}` });
  };
  const pass = () => {
    if (!unresolvedFields.length) return;
    void act({ type: 'pass', questionId: question.id, fieldId: unresolvedFields[0].id });
  };

  return <section className="panel play-panel">
    <p className="question-progress">{question.ordinal + 1}問目 / {snapshot.room.settings.questionCount}問　スコア {own?.correctCount ?? 0} / {snapshot.room.maxScore}</p>
    {question.prompt.kind === 'four' ? <>
      <FourPromptView question={question} />
      <div className="choice-list">
        {question.prompt.choices.map(c => <button key={c.id} type="button" className="answer-choice" disabled={busy} onClick={() => answerFour(c.id)}>
          {c.structure ? <img className="structure-img" src={`/${c.structure}`} alt="選択肢の構造" /> : c.name}
        </button>)}
      </div>
    </> : <>
      <p className="prompt-label">{question.fields.length === 2 ? '正しいペアを2組つくろう' : '正しいペアを1組つくろう'}（あと{unresolvedFields.length}組）</p>
      <PairBoard question={question} locked={locked} selected={sel} onSelectStructure={id => setSel(s => ({ ...s, structure: id }))} onSelectName={id => setSel(s => ({ ...s, name: id }))} />
      <div className="play-actions">
        <button type="button" className="primary-action" disabled={busy || !sel.structure || !sel.name} onClick={confirmPair}>このペアで確定</button>
      </div>
    </>}
    <div className="play-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={pass}>パス</button>
      {(snapshot.own?.questionIndex ?? 0) > 0 && <button type="button" className="secondary-button" onClick={() => { setShowReview(r => !r); if (!showReview) void onReview().catch(() => {}); }}>これまでの問題</button>}
    </div>
    {feedback && <p className="verdict" role="status">{feedback}</p>}
    {showReview && snapshot.review && <ol className="mini-review">
      {snapshot.review.questions.slice(0, snapshot.review.frontier).map(q => <li key={q.id}>
        {q.ordinal + 1}問目：{q.fields.map(f => <span key={f.id} className="mini-review-state">{snapshot.review!.fields[`${q.id}:${f.id}`] === 'correct' ? '正解' : snapshot.review!.fields[`${q.id}:${f.id}`] === 'passed' ? 'パス' : '再挑戦中'}</span>)}
      </li>)}
    </ol>}
  </section>;
}

function DeferredPlayer({ snapshot, send }: { snapshot: Snapshot; send: Send }) {
  const deferred = snapshot.deferred;
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<{ structure: string | null; name: string | null }>({ structure: null, name: null });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const code = snapshot.room.code, participantId = snapshot.own?.id ?? '';

  useEffect(() => {
    if (!deferred) return;
    let live = true;
    readDrafts(code, participantId).then(local => {
      if (!live) return;
      setSelections(mergeDrafts(deferred.drafts, local, Date.now(), code));
    }).catch(() => setSelections({ ...deferred.drafts }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferred?.questions.length, code, participantId]);

  const own = snapshot.own;
  if (own?.finished) {
    return <section className="panel">
      <h2>提出済み</h2>
      <p>結果の発表を待ってね。</p>
      {snapshot.room.kind === 'class' && snapshot.room.state === 'RUNNING' && <ReopenSubmission disabled={busy} onConfirm={async () => { setBusy(true); try { await send({ type: 'reopen' }); } finally { setBusy(false); } }} />}
    </section>;
  }
  if (!deferred || !deferred.questions.length) return <section className="panel"><p role="status">問題を準備しています…</p></section>;
  const questions = deferred.questions;
  const question = questions[Math.min(index, questions.length - 1)];

  const pushDraft = (questionId: string, fieldId: AnswerFieldId, value: string, visited: number) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      void send({ type: 'draft', answers: [{ questionId, fieldId, value }], advancedQuestionCount: visited }).catch(() => {});
    }, 350);
  };
  const setValue = (fieldId: AnswerFieldId, value: string) => {
    const key = `${question.id}:${fieldId}`;
    setSelections(prev => ({ ...prev, [key]: value }));
    void writeDraft({ key: `${code}:${participantId}:${key}`, room: code, participant: participantId, question: key, value, updatedAtMs: Date.now(), expiresAtMs: Date.now() + 7 * 24 * 3600 * 1000 }).catch(() => {});
    pushDraft(question.id, fieldId, value, maxVisited);
  };
  const goto = (next: number) => {
    const clamped = Math.max(0, Math.min(questions.length - 1, next));
    setIndex(clamped); setSel({ structure: null, name: null });
    const visited = Math.max(maxVisited, clamped);
    setMaxVisited(visited);
  };

  const lockedFor = (q: PublicQuestion) => Object.fromEntries(q.fields.map(f => [f.id, selections[`${q.id}:${f.id}`]]).filter(([, v]) => v));
  const pairSelectionReady = sel.structure && sel.name;
  const assignPair = () => {
    if (!pairSelectionReady) return;
    const empty = question.fields.find(f => !selections[`${question.id}:${f.id}`]);
    if (!empty) return;
    setValue(empty.id, `${sel.structure}=${sel.name}`);
    setSel({ structure: null, name: null });
  };
  const answered = questions.filter(q => q.fields.some(f => selections[`${q.id}:${f.id}`])).length;

  return <section className="panel play-panel">
    <p className="question-progress">{question.ordinal + 1}問目 / {questions.length}問　回答済み {answered}問</p>
    {question.prompt.kind === 'four' ? <>
      <FourPromptView question={question} />
      <div className="choice-list">
        {question.prompt.choices.map(c => {
          const current = selections[`${question.id}:choice`] === c.id;
          return <button key={c.id} type="button" className="answer-choice" aria-pressed={current} onClick={() => setValue('choice', current ? '' : c.id)}>
            {c.structure ? <img className="structure-img" src={`/${c.structure}`} alt="選択肢の構造" /> : c.name}
          </button>;
        })}
      </div>
    </> : <>
      <p className="prompt-label">{question.fields.length === 2 ? '正しいペアを2組つくろう' : '正しいペアを1組つくろう'}</p>
      <div className="pair-slots">
        {question.fields.map(f => {
          const v = selections[`${question.id}:${f.id}`];
          return <button key={f.id} type="button" className="pair-slot" disabled={!v} onClick={() => setValue(f.id, '')}>
            {v ? `${COMPOUND_BY_ID.get(v.split('=')[0])?.nameJa} ＝ ${COMPOUND_BY_ID.get(v.split('=')[1])?.nameJa}（タップで消す）` : 'ペア未設定'}
          </button>;
        })}
      </div>
      <PairBoard question={question} locked={lockedFor(question)} selected={sel} onSelectStructure={id => setSel(s => ({ ...s, structure: id }))} onSelectName={id => setSel(s => ({ ...s, name: id }))} />
      <div className="play-actions">
        <button type="button" className="primary-action" disabled={!pairSelectionReady} onClick={assignPair}>ペアにする</button>
      </div>
    </>}
    <div className="play-actions pager">
      <button type="button" className="secondary-button" disabled={index === 0} onClick={() => goto(index - 1)}>前の問題</button>
      <button type="button" className="secondary-button" disabled={index >= questions.length - 1} onClick={() => goto(index + 1)}>次の問題</button>
    </div>
    <div className="question-dots">
      {questions.map((q, i) => <button key={q.id} type="button" className="dot" aria-pressed={i === index} aria-label={`${i + 1}問目`} onClick={() => goto(i)}>{q.fields.some(f => selections[`${q.id}:${f.id}`]) ? '●' : '○'}</button>)}
    </div>
    <button type="button" className="primary-action submit-action" disabled={busy} onClick={async () => { setBusy(true); try { await send({ type: 'submit' }); } catch { /* shown by room */ } finally { setBusy(false); } }}>提出する</button>
  </section>;
}
