import { COMPOUND_BY_ID, type AnswerFieldId, type FieldEvaluation, type InternalQuestion } from './types';

export function isAnswerEmpty(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/** Answer values are plain strings: a compound id (four-choice) or
 *  "structureCompoundId=nameCompoundId" (pairing). */
export function validateAnswerValue(value: unknown, question: InternalQuestion): boolean {
  if (typeof value !== 'string' || value.length > 200) return false;
  if (question.prompt.kind === 'four') return question.prompt.choices.some(c => c.id === value);
  const m = /^([a-z0-9-]+)=([a-z0-9-]+)$/.exec(value);
  if (!m) return false;
  return question.prompt.structures.includes(m[1]) && question.prompt.names.includes(m[2]);
}

export function evaluateField(
  question: InternalQuestion,
  fieldId: AnswerFieldId,
  value: unknown,
  resolvedValues: Partial<Record<AnswerFieldId, string>> = {},
): FieldEvaluation {
  if (!question.fields.some(f => f.id === fieldId)) throw new TypeError('この問題に存在しない解答欄です');
  if (isAnswerEmpty(value)) return { correct: false, empty: true };
  if (!validateAnswerValue(value, question)) return { correct: false, empty: false };
  if (question.prompt.kind === 'four') {
    return { correct: value === question.answer.targetId, empty: false };
  }
  const [structureId, nameId] = (value as string).split('=');
  if (structureId !== nameId) return { correct: false, empty: false };
  if (!question.answer.targetIds?.includes(structureId)) return { correct: false, empty: false };
  // The same pair must not score twice across the two fields of a board.
  for (const [otherField, otherValue] of Object.entries(resolvedValues)) {
    if (otherField !== fieldId && otherValue === value) return { correct: false, empty: false };
  }
  return { correct: true, empty: false };
}

/** Human-readable form of an answer value, for result reviews. */
export function describeAnswerValue(question: InternalQuestion, value: unknown): string {
  if (typeof value !== 'string') return '';
  if (question.prompt.kind === 'four') return COMPOUND_BY_ID.get(value)?.nameJa ?? value;
  const [structureId, nameId] = value.split('=');
  const s = COMPOUND_BY_ID.get(structureId)?.nameJa ?? structureId;
  const n = COMPOUND_BY_ID.get(nameId)?.nameJa ?? nameId;
  return `${s}の構造 ＝ ${n}`;
}
