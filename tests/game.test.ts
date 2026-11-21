import { describe, expect, it } from 'vitest';
import { generateQuestionSet, fourChoicePool, eligiblePropertyQuestions, eligiblePairBoards, propertySlotCount, QuestionPreparationError } from '../game/generator';
import { evaluateField } from '../game/evaluator';
import { UNITS, type OrgoGameSettings } from '../game/types';
import { DEFAULT_EXCLUSION } from '../game/profile';

const base: OrgoGameSettings = {
  questionCount: 5, timeLimitMinutes: 3, mode: 'four',
  units: UNITS.map(u => u.name), pairCategories: ['aliphatic', 'aromatic'],
  directions: ['A', 'B'], gradingMode: 'immediate',
};
// Deterministic random for repeatable tests.
function lcg(seed = 42) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000); }

describe('pools', () => {
  it('four-choice pool is the unit union (121) without linoleic acid', () => {
    const pool = fourChoicePool(base.units, []);
    expect(pool.length).toBe(121);
    expect(pool.some(c => c.id === 'linoleic-acid')).toBe(false);
  });
  it('per-unit property question eligibility matches the approved sets', () => {
    const byUnit = (name: string) => eligiblePropertyQuestions(fourChoicePool([name], [])).length;
    expect(byUnit('脂肪族炭化水素')).toBe(0);
    expect(byUnit('脂肪族官能基')).toBe(5);
    expect(byUnit('芳香族炭化水素')).toBe(2);
    expect(byUnit('芳香族官能基')).toBe(2);
    expect(eligiblePropertyQuestions(fourChoicePool(base.units, [])).length).toBe(10);
  });
  it('excluded compounds remove property sets and pair boards wholesale', () => {
    const pool = fourChoicePool(base.units, ['2-propanol']);
    expect(eligiblePropertyQuestions(pool).some(q => q.targetId === '2-propanol')).toBe(false);
    const before = eligiblePairBoards('onePair', ['aliphatic', 'aromatic'], []).length;
    const after = eligiblePairBoards('onePair', ['aliphatic', 'aromatic'], ['acetone']).length;
    expect(after).toBeLessThan(before);
  });
  it('property slot allocation follows the spec', () => {
    expect(propertySlotCount({ ...base, directions: ['A', 'B', 'C', 'D'] })).toBe(1);
    expect(propertySlotCount({ ...base, questionCount: 10, directions: ['A', 'B', 'C', 'D'] })).toBe(2);
    expect(propertySlotCount({ ...base, directions: ['C'] })).toBe(5);
    expect(propertySlotCount({ ...base, directions: ['A'] })).toBe(0);
  });
});

describe('generateQuestionSet', () => {
  it('builds a four-choice set with unique targets and valid choices', () => {
    const qs = generateQuestionSet(base, lcg(), DEFAULT_EXCLUSION);
    expect(qs.length).toBe(5);
    expect(new Set(qs.map(q => q.answer.targetId)).size).toBe(5);
    for (const q of qs) {
      expect(q.prompt.kind).toBe('four');
      if (q.prompt.kind === 'four') {
        expect(q.prompt.choices.length).toBe(4);
        expect(q.prompt.choices.some(c => c.id === q.answer.targetId)).toBe(true);
        expect(['A', 'B']).toContain(q.prompt.direction);
      }
    }
  });
  it('mixed directions include exactly one property question in 5', () => {
    const qs = generateQuestionSet({ ...base, directions: ['A', 'B', 'C', 'D'] }, lcg(7), DEFAULT_EXCLUSION);
    const cd = qs.filter(q => q.prompt.kind === 'four' && (q.prompt.direction === 'C' || q.prompt.direction === 'D'));
    expect(cd.length).toBe(1);
  });
  it('rejects when property questions cannot fill the set', () => {
    expect(() => generateQuestionSet({ ...base, units: ['脂肪族炭化水素'], directions: ['C'] }, lcg(), DEFAULT_EXCLUSION)).toThrow(QuestionPreparationError);
  });
  it('builds pairing boards whose cards are all in the bank entry', () => {
    const qs = generateQuestionSet({ ...base, mode: 'twoPair' }, lcg(3), DEFAULT_EXCLUSION);
    expect(qs.length).toBe(5);
    for (const q of qs) {
      expect(q.maxScore).toBe(2);
      expect(q.fields.map(f => f.id)).toEqual(['pair1', 'pair2']);
      if (q.prompt.kind === 'pair') {
        expect(q.prompt.structures.length).toBe(4);
        expect(q.prompt.names.length).toBe(4);
        for (const t of q.answer.targetIds!) expect(q.prompt.structures).toContain(t);
      }
    }
  });
  it('never generates questions for excluded compounds', () => {
    const qs = generateQuestionSet(base, lcg(9), { version: 1, excludedIds: ['ethanol', 'acetone', 'benzene'] });
    for (const q of qs) {
      expect(q.answer.targetId).not.toBe('ethanol');
      if (q.prompt.kind === 'four') for (const c of q.prompt.choices) expect(['ethanol', 'acetone', 'benzene']).not.toContain(c.id);
    }
  });
});

describe('evaluateField', () => {
  it('scores four-choice by target id', () => {
    const [q] = generateQuestionSet(base, lcg(), DEFAULT_EXCLUSION);
    expect(evaluateField(q, 'choice', q.answer.targetId).correct).toBe(true);
    expect(evaluateField(q, 'choice', 'methanol' === q.answer.targetId ? 'ethanol' : 'methanol').correct).toBe(false);
  });
  it('scores pairs and blocks double counting of the same pair', () => {
    const [q] = generateQuestionSet({ ...base, mode: 'twoPair' }, lcg(5), DEFAULT_EXCLUSION);
    const [t1, t2] = q.answer.targetIds!;
    expect(evaluateField(q, 'pair1', `${t1}=${t1}`).correct).toBe(true);
    expect(evaluateField(q, 'pair2', `${t1}=${t1}`, { pair1: `${t1}=${t1}` }).correct).toBe(false);
    expect(evaluateField(q, 'pair2', `${t2}=${t2}`, { pair1: `${t1}=${t1}` }).correct).toBe(true);
    expect(evaluateField(q, 'pair1', `${t1}=${t2}`).correct).toBe(false);
  });
});
