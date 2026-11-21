import { COMPOUND_BY_ID } from '../game/types';
import type { ReviewQuestion } from './protocol';

function PromptView({ question }: { question: ReviewQuestion }) {
  const p = question.prompt;
  if (p.kind === 'four') {
    return <div className="review-prompt">
      {p.targetName && <p className="prompt-name">{p.targetName}</p>}
      {p.targetStructure && <img className="structure-img" src={`/${p.targetStructure}`} alt="構造式" />}
      {p.properties && <p className="prompt-properties">{p.properties}</p>}
      <p className="review-choices">{p.choices.map(c => c.name ?? COMPOUND_BY_ID.get(c.id)?.nameJa ?? c.id).join(' / ')}</p>
    </div>;
  }
  return <div className="review-prompt">
    <p>構造：{p.structures.map(id => COMPOUND_BY_ID.get(id)?.nameJa ?? id).join(' / ')}</p>
    <p>名前：{p.names.map(id => COMPOUND_BY_ID.get(id)?.nameJa ?? id).join(' / ')}</p>
  </div>;
}

const STATE_LABEL = { correct: '正解', incorrect: '不正解', passed: 'パス', unanswered: '未回答' } as const;

export function ReviewList({ questions }: { questions: ReviewQuestion[] }) {
  return <ol className="review-list">{questions.map(q => <li key={q.id} className="review-item">
    <h3>{q.ordinal + 1}問目</h3>
    <PromptView question={q} />
    {q.fields.map(f => <p key={f.id} className={`review-field state-${f.state}`}>
      <span className="review-state">{STATE_LABEL[f.state]}</span>
      <span>正解：{f.correctAnswer}</span>
      {f.lastAnswer !== null && f.lastAnswer !== f.correctAnswer && <span>あなたの回答：{f.lastAnswer}</span>}
      {f.attempts > 1 && <span>{f.attempts}回挑戦</span>}
    </p>)}
  </li>)}</ol>;
}
