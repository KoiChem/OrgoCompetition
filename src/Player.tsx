import { useEffect, useRef, useState, type ReactNode } from 'react';
import { COMPOUND_BY_ID, type AnswerFieldId, type PublicQuestion } from '../game/types';
import type { ClientMessage, ServerMessage, Snapshot, Verdict } from './protocol';
import type { RoomConnection } from './socket';
import { playAnswerSound } from './host-sound';
import { ReopenSubmission } from './ReopenSubmission';
import { mergeDrafts, readDrafts, writeDraft } from './drafts';

type Send = (message: ClientMessage) => Promise<ServerMessage>;

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

function PairBoard({ question, pairs, selected, disabled, action, onPick, onClear }: {
  question: PublicQuestion;
  pairs: Record<string, string>;
  disabled: boolean;
  selected: { structure: string | null; name: string | null };
  action: ReactNode;
  onPick(side: 'structure' | 'name', id: string): void;
  onClear?(fieldId: AnswerFieldId): void;
}) {
  const prompt = question.prompt;
  if (prompt.kind !== 'pair') return null;
  const openIndex = question.fields.findIndex(field => !pairs[field.id]);
  const renderCard = (side: 'structure' | 'name', id: string, index: number) => {
    const slot = question.fields.findIndex(field => pairs[field.id]?.split('=')[side === 'structure' ? 0 : 1] === id);
    const assigned = slot >= 0;
    const active = selected[side] === id;
    const color = assigned ? slot + 1 : active ? openIndex + 1 : undefined;
    const compound = COMPOUND_BY_ID.get(id);
    const label = side === 'structure' ? `構造 ${index + 1}` : compound?.nameJa ?? id;
    const state = assigned ? `、ペア ${slot + 1}${onClear ? '、押すと解除' : '、確定済み'}` : '';
    return <button key={id} type="button" className={`pair-card ${side}-card`}
      data-pair={color} data-assigned={assigned || undefined}
      aria-label={label + state} aria-pressed={active || assigned}
      disabled={disabled || (assigned ? !onClear : openIndex < 0)}
      onClick={() => assigned ? onClear?.(question.fields[slot].id) : onPick(side, id)}>
      {assigned && <span className="pair-mark" aria-hidden="true">{slot === 0 ? '●' : '◆'}</span>}
      {side === 'structure' ? <img className="structure-img" src={`/${compound?.structureSvg}`} alt="" /> : label}
    </button>;
  };
  return <div className="pair-board">
    <div className="pair-structures" role="group" aria-label="構造式">
      {prompt.structures.map((id, index) => renderCard('structure', id, index))}
    </div>
    <div className="pair-name-row">
      <div className="pair-names" role="group" aria-label="化合物名">
        {prompt.names.map((id, index) => renderCard('name', id, index))}
      </div>
      {action}
    </div>
  </div>;
}

export function Player({ snapshot, connection, verdictSignal, connected, serverNow }: {
  snapshot: Snapshot;
  connection: RoomConnection;
  verdictSignal: { verdict: Verdict; n: number } | null;
  connected: boolean;
  serverNow(): number;
}) {
  const send = useSender(connection, snapshot);
  if (snapshot.room.settings.gradingMode === 'deferred') {
    return <DeferredPlayer snapshot={snapshot} send={send} connected={connected} serverNow={serverNow} />;
  }
  return <ImmediatePlayer snapshot={snapshot} send={send} verdictSignal={verdictSignal} connected={connected}
    onReview={() => connection.send({ type: 'review' }).then(response => response.state?.review)} />;
}

function ImmediatePlayer({ snapshot, send, verdictSignal, connected, onReview }: {
  snapshot: Snapshot; send: Send; verdictSignal: { verdict: Verdict; n: number } | null;
  connected: boolean; onReview(): Promise<Snapshot['review']>;
}) {
  const [review, setReview] = useState<Snapshot['review']>();
  const [targetId, setTargetId] = useState<string | null>(null);
  const question = review?.questions.find(item => item.id === targetId) ?? snapshot.question;
  const frontier = snapshot.own?.questionIndex ?? 0;
  const [feedback, setFeedback] = useState('');
  const [sel, setSel] = useState<{ structure: string | null; name: string | null }>({ structure: null, name: null });
  const [busy, setBusy] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const lastVerdictN = useRef(0);
  const questionId = question?.id;

  useEffect(() => { setSel({ structure: null, name: null }); setFeedback(''); }, [questionId]);
  useEffect(() => {
    if (!verdictSignal || verdictSignal.n === lastVerdictN.current) return;
    lastVerdictN.current = verdictSignal.n;
    const v = verdictSignal.verdict;
    playAnswerSound(v.correct);
    if (v.passed) setFeedback('パスしました');
    else if (v.correct) {
      setFeedback('正解！');
      setSel({ structure: null, name: null });
    } else setFeedback('ちがうみたい。もう一度考えてみよう');
  }, [verdictSignal, question, sel]);

  useEffect(() => {
    if (question || frontier === 0 || !connected) return;
    let live = true;
    void onReview().then(value => { if (live) setReview(value); }).catch(() => {});
    return () => { live = false; };
    // Review is refreshed when the frontier first reaches the end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id, frontier, connected]);

  const own = snapshot.own;
  if (own?.finished) return <section className="panel"><h2>おつかれさま！</h2><p>全問終わりました。結果の発表を待ってね。</p></section>;
  const openReview = async () => {
    setShowReview(true); setBusy(true); setTargetId(null);
    try { setReview(await onReview()); } catch { setFeedback('問題一覧を取得できませんでした'); }
    finally { setBusy(false); }
  };
  if (showReview || !question) return <section className="panel play-panel play-review">
    <h2>全解答確認</h2>
    {feedback && <p role="status">{feedback}</p>}
    {!review && <button type="button" className="secondary-button" disabled={busy || !connected} onClick={() => void openReview()}>これまでの問題を確認</button>}
    {review && <ol className="review-list">{review.questions.slice(0, review.frontier).map(q => {
      const retry = q.fields.some(f => ['passed', 'passedRetry'].includes(review.fields[`${q.id}:${f.id}`]));
      return <li className="review-item" key={q.id}>
        <span>{q.ordinal + 1}問目　{retry ? 'パス・再解答できます' : '正解'}</span>
        {retry && <button type="button" className="secondary-button" disabled={!connected || busy} onClick={() => { setTargetId(q.id); setShowReview(false); }}>この問題に戻る</button>}
      </li>;
    })}</ol>}
    {snapshot.question && <div className="play-actions"><button type="button" className="secondary-button" onClick={() => { setTargetId(null); setShowReview(false); }}>現在の問題へ</button></div>}
  </section>;

  const fieldState = (fieldId: AnswerFieldId) => targetId ? review?.fields[`${question.id}:${fieldId}`] : question.progress.fieldStates?.[fieldId];
  const locked = Object.fromEntries(question.fields.filter(f => fieldState(f.id) === 'correct')
    .map(f => [f.id, snapshot.drafts?.[`${question.id}:${f.id}`] ?? '']).filter(([, value]) => value));
  const unresolvedFields = question.fields.filter(f => targetId ? fieldState(f.id) !== 'correct' : !question.progress.resolvedFieldIds.includes(f.id));
  const act = async (message: ClientMessage) => {
    setBusy(true);
    try {
      await send(message);
      if (targetId) {
        const refreshed = await onReview();
        setReview(refreshed);
        if (!refreshed?.questions.find(q => q.id === targetId)?.fields.some(f => refreshed.fields[`${targetId}:${f.id}`] !== 'correct')) {
          setTargetId(null); setShowReview(true);
        }
      }
    } catch { /* room screen shows the error */ } finally { setBusy(false); }
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

  return <section className="panel play-panel play-question">
    <p className="question-progress">{question.ordinal + 1}問目 / {snapshot.room.settings.questionCount}問　スコア {own?.correctCount ?? 0} / {snapshot.room.maxScore}</p>
    {question.prompt.kind === 'four' ? <>
      <FourPromptView question={question} />
      <div className="choice-list">
        {question.prompt.choices.map((c, i) => <button key={c.id} type="button" className="answer-choice" disabled={busy || !connected} onClick={() => answerFour(c.id)}>
          {c.structure ? <img className="structure-img" src={`/${c.structure}`} alt={`選択肢 ${i + 1} の構造`} /> : c.name}
        </button>)}
      </div>
    </> : <>
      <p className="prompt-label">{question.fields.length === 2 ? '正しいペアを2組つくろう' : '正しいペアを1組つくろう'}（あと{unresolvedFields.length}組）</p>
      <PairBoard question={question} pairs={locked} selected={sel} disabled={busy || !connected}
        onPick={(side, id) => setSel(previous => ({ ...previous, [side]: previous[side] === id ? null : id }))}
        action={<button type="button" className="primary-action pair-confirm" disabled={busy || !connected || !sel.structure || !sel.name} onClick={confirmPair}>確定</button>} />
    </>}
    <div className="play-actions">
      {!targetId && <button type="button" className="secondary-button" disabled={busy || !connected} onClick={pass}>パス</button>}
      {(snapshot.own?.questionIndex ?? 0) > 0 && <button type="button" className="secondary-button" disabled={busy || !connected} onClick={() => void openReview()}>これまでの問題</button>}
    </div>
    {feedback && <p className="verdict" role="status">{feedback}</p>}
  </section>;
}

function PairAnswer({ value, question }: { value: string; question: PublicQuestion }) {
  const [structure, name] = value.split('=');
  const number = question.prompt.kind === 'pair' ? question.prompt.structures.indexOf(structure) + 1 : 0;
  return <span className="pair-answer">
    <img className="structure-img small" src={`/${COMPOUND_BY_ID.get(structure)?.structureSvg}`} alt={`構造 ${number}`} />
    <span>{COMPOUND_BY_ID.get(name)?.nameJa}</span>
  </span>;
}

function DeferredPlayer({ snapshot, send, connected, serverNow }: {
  snapshot: Snapshot; send: Send; connected: boolean; serverNow(): number;
}) {
  const deferred = snapshot.deferred;
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [sel, setSel] = useState<{ structure: string | null; name: string | null }>({ structure: null, name: null });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionsRef = useRef(selections);
  const updatedAtRef = useRef<Record<string, number>>({});
  const maxVisitedRef = useRef(snapshot.own?.advancedQuestionCount ?? 0);
  const flushChain = useRef<Promise<void>>(Promise.resolve());
  const submitting = useRef(false);
  const restoreFailed = useRef(false);
  const lastAcknowledged = useRef<Snapshot | undefined>(undefined);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const code = snapshot.room.code, participantId = snapshot.own?.id ?? '';
  const collecting = snapshot.room.state === 'COLLECTING';
  const cutoff = snapshot.room.cutoffAtMs ?? snapshot.room.deadlineAtMs ?? 0;
  const canEdit = ready && !collecting && !busy && serverNow() < cutoff;
  const canEditNow = () => ready && !collecting && !submitting.current && serverNow() < cutoff;

  useEffect(() => {
    if (!deferred) return;
    let live = true;
    const restore = (local: Awaited<ReturnType<typeof readDrafts>>) => {
      if (!live) return;
      const state = snapshotRef.current;
      const restored = mergeDrafts(state.deferred?.drafts ?? {}, local, Date.now(), code);
      selectionsRef.current = restored;
      updatedAtRef.current = Object.fromEntries(local.map(r => [r.question, r.updatedAtMs]));
      setSelections(restored);
      setReady(true);
    };
    restoreFailed.current = false;
    void readDrafts(code, participantId).then(restore).catch(() => {
      if (!live) return;
      restoreFailed.current = true;
      setSyncError('この端末の下書きを読み込めませんでした');
      restore([]);
    });
    return () => { live = false; };
    // Reopening after submission restores the latest saved answers again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(deferred), code, participantId]);

  useEffect(() => () => { if (draftTimer.current) clearTimeout(draftTimer.current); }, []);

  const flush = (): Promise<void> => {
    const run = async () => {
      const state = snapshotRef.current;
      const previous = lastAcknowledged.current;
      const acknowledged = previous && (previous.own?.lastSeq ?? 0) > (state.own?.lastSeq ?? 0)
        ? previous.deferred?.drafts ?? {}
        : state.deferred?.drafts ?? {};
      const room = state.room;
      const end = room.cutoffAtMs ?? room.deadlineAtMs ?? 0;
      const edits = Object.entries(selectionsRef.current).filter(([key, value]) => {
        const time = updatedAtRef.current[key];
        return time >= (room.startAtMs ?? 0) && time < end && value !== (acknowledged[key] ?? '');
      });
      if (!edits.length) return;
      const answers = edits.map(([key, value]) => {
        const [questionId, fieldId] = key.split(':');
        return { questionId, fieldId: fieldId as AnswerFieldId, value };
      });
      const ack = await send({
        type: 'draft', answers, advancedQuestionCount: maxVisitedRef.current,
        capturedAtMs: Math.max(...edits.map(([key]) => updatedAtRef.current[key])),
      });
      lastAcknowledged.current = ack.state;
    };
    const result = flushChain.current.then(run);
    flushChain.current = result.catch(() => {});
    return result;
  };
  const flushRef = useRef(flush); flushRef.current = flush;

  const scheduleFlush = () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (submitting.current) return;
      void flushRef.current().catch(() => setSyncError('回答を送信できませんでした。通信状態を確認してください'));
    }, 350);
  };

  const submit = async (final: boolean) => {
    const capturedAtMs = serverNow();
    if (!connected || submitting.current || (!final && !canEditNow())) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    submitting.current = true;
    setBusy(true);
    setSyncError('');
    try {
      await flushRef.current();
      await send({ type: 'submit', ...(final ? { final: true } : { capturedAtMs }) });
    } catch {
      setSyncError(final ? '締切前の回答を回収できませんでした' : '提出できませんでした。通信状態を確認して、もう一度提出してください');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const submitRef = useRef(submit); submitRef.current = submit;

  useEffect(() => {
    if (!ready || !connected || snapshot.own?.finished) return;
    if (!collecting) {
      void flushRef.current().catch(() => setSyncError('通信が回復したら回答を再送信します'));
      return;
    }
    const recover = () => {
      if (!restoreFailed.current && serverNow() < cutoff + 3000 && !snapshotRef.current.own?.finished) void submitRef.current(true);
    };
    recover();
    const retry = setInterval(recover, 250);
    return () => clearInterval(retry);
    // serverNow is read when each retry runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, connected, collecting, cutoff, snapshot.own?.finished]);

  const own = snapshot.own;
  if (own?.finished) {
    return <section className="panel">
      <h2>提出済み</h2>
      <p>結果の発表を待ってね。</p>
      {snapshot.room.kind === 'class' && snapshot.room.state === 'RUNNING' && <ReopenSubmission disabled={busy || !connected} onConfirm={async () => { setBusy(true); try { await send({ type: 'reopen' }); } finally { setBusy(false); } }} />}
    </section>;
  }
  if (collecting) return <section className="panel"><h2>集計しています</h2><p role="status">締切前の回答を回収しています…</p>{syncError && <p role="alert" className="error">{syncError}</p>}</section>;
  if (!ready || !deferred?.questions.length) return <section className="panel"><p role="status">問題と解答を準備しています…</p></section>;
  const questions = deferred.questions;
  const question = questions[Math.min(index, questions.length - 1)];

  const setValue = (fieldId: AnswerFieldId, value: string) => {
    if (!canEditNow()) return;
    const key = `${question.id}:${fieldId}`;
    const now = serverNow();
    const next = { ...selectionsRef.current, [key]: value };
    selectionsRef.current = next;
    updatedAtRef.current[key] = now;
    setSelections(next);
    void writeDraft({ key: `${code}:${participantId}:${key}`, room: code, participant: participantId, question: key, value, updatedAtMs: now, expiresAtMs: Date.now() + 7 * 24 * 3600 * 1000 })
      .catch(() => setSyncError('この端末に回答を保存できませんでした。通信状態を確認してください'));
    if (connected) scheduleFlush();
  };
  const goto = (next: number) => {
    if (!canEditNow()) return;
    const clamped = Math.max(0, Math.min(questions.length - 1, next));
    setIndex(clamped); setSel({ structure: null, name: null });
    maxVisitedRef.current = Math.max(maxVisitedRef.current, clamped);
  };

  const locked = Object.fromEntries(question.fields.map(f => [f.id, selections[`${question.id}:${f.id}`]]).filter(([, value]) => value));
  const emptyField = question.fields.find(f => !selections[`${question.id}:${f.id}`]);
  const twoPairs = question.prompt.kind === 'pair' && question.fields.length === 2;
  const assignPair = (structure: string | null, name: string | null) => {
    if (!emptyField || !structure || !name || !canEditNow()) return;
    setValue(emptyField.id, `${structure}=${name}`);
    setSel({ structure: null, name: null });
  };
  const pickPair = (side: 'structure' | 'name', id: string) => {
    if (!canEditNow()) return;
    const next = { ...sel, [side]: sel[side] === id ? null : id };
    if (twoPairs && next.structure && next.name) assignPair(next.structure, next.name);
    else setSel(next);
  };
  const lastQuestion = index >= questions.length - 1;
  const nextQuestion = () => lastQuestion ? setReviewing(true) : goto(index + 1);
  const answered = questions.filter(q => q.fields.every(f => selections[`${q.id}:${f.id}`])).length;
  const error = syncError && <p role="alert" className="error">{syncError}</p>;

  if (reviewing) return <section className="panel play-panel play-review">
    <h2>全解答確認</h2>
    <p>回答済み {answered}問 / {questions.length}問</p>
    <ol className="review-list">{questions.map((q, i) => <li className="review-item" key={q.id}>
      <h3>{i + 1}問目</h3>
      {q.fields.map(f => {
        const value = selections[`${q.id}:${f.id}`];
        if (!value) return <p key={f.id}>未回答</p>;
        if (q.prompt.kind === 'pair') return <div key={f.id}><PairAnswer value={value} question={q} /></div>;
        const choice = q.prompt.choices.find(option => option.id === value);
        return <p key={f.id}>{choice?.structure ? <img className="structure-img small" src={`/${choice.structure}`} alt="選んだ構造" /> : choice?.name}</p>;
      })}
      <button type="button" className="secondary-button" disabled={!canEdit} onClick={() => { goto(i); setReviewing(false); }}>この問題に戻る</button>
    </li>)}</ol>
    {error}
    <div className="play-actions">
      <button type="button" className="secondary-button" disabled={!canEdit} onClick={() => setReviewing(false)}>解答に戻る</button>
      <button type="button" className="primary-action" disabled={!connected || !canEdit} onClick={() => void submit(false)}>{busy ? '送信中…' : '提出する'}</button>
    </div>
  </section>;

  return <section className="panel play-panel play-question">
    <p className="question-progress">{question.ordinal + 1}問目 / {questions.length}問　回答済み {answered}問</p>
    {question.prompt.kind === 'four' ? <>
      <FourPromptView question={question} />
      <div className="choice-list">
        {question.prompt.choices.map((c, i) => {
          const current = selections[`${question.id}:choice`] === c.id;
          return <button key={c.id} type="button" className="answer-choice" aria-pressed={current} disabled={!canEdit} onClick={() => setValue('choice', current ? '' : c.id)}>
            {c.structure ? <img className="structure-img" src={`/${c.structure}`} alt={`選択肢 ${i + 1} の構造`} /> : c.name}
          </button>;
        })}
      </div>
    </> : <>
      <p className="prompt-label">{question.fields.length === 2 ? '正しいペアを2組つくろう' : '正しいペアを1組つくろう'}</p>
      <PairBoard question={question} pairs={locked} selected={sel} disabled={!canEdit}
        onPick={pickPair} onClear={fieldId => {
          setValue(fieldId, '');
          setSel({ structure: null, name: null });
        }}
        action={twoPairs
          ? <button type="button" className="primary-action pair-confirm" disabled={!canEdit || !!emptyField} onClick={nextQuestion}>{lastQuestion ? '解答確認' : '次へ'}</button>
          : <button type="button" className="primary-action pair-confirm" disabled={!canEdit || !emptyField || !sel.structure || !sel.name} onClick={() => assignPair(sel.structure, sel.name)}>確定</button>} />
    </>}
    <div className="play-actions pager">
      <button type="button" className="secondary-button" disabled={!canEdit || index === 0} onClick={() => goto(index - 1)}>前の問題</button>
      {!twoPairs && <button type="button" className="secondary-button" disabled={!canEdit || lastQuestion} onClick={nextQuestion}>次の問題</button>}
      <button type="button" className="secondary-button" disabled={!canEdit} onClick={() => setReviewing(true)}>全解答確認</button>
    </div>
    <div className="question-dots">
      {questions.map((q, i) => <button key={q.id} type="button" className="dot" disabled={!canEdit} aria-pressed={i === index} aria-label={`${i + 1}問目`} onClick={() => goto(i)}>{q.fields.every(f => selections[`${q.id}:${f.id}`]) ? '●' : '○'}</button>)}
    </div>
    {error}
  </section>;
}
