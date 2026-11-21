// Question generation for OrgoCompe, ported from OrgoRush (difficulty fixed to
// "normal"). Differences from OrgoRush solo play, per the competition spec:
// - No widening of the distractor pool outside the selected range.
// - Property questions (C/D) use only the teacher-approved sets; never
//   auto-generated from property texts.
// - No SRS weighting / intro patterns; one fixed set per room, shared by all.
import {
  COMPOUNDS, COMPOUND_BY_ID, PROPERTY_QUESTIONS, PAIR_BANK, PAIR2_BANK, RIVALS, UNITS,
  type Compound, type Direction, type InternalQuestion, type OrgoGameSettings, type PairCategory,
  type PublicQuestion, type QuestionProgress,
} from './types';
import { validateGameSettings } from './settings';
import type { ExclusionProfile } from './profile';

export class QuestionPreparationError extends RangeError {}
export const PREPARATION_MESSAGE = '出題範囲と除外設定では問題を準備できませんでした。範囲を広げるか、除外を減らしてください';

type Random = () => number;
function shuffled<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
function identifier(random: Random): string {
  return Array.from({ length: 4 }, () => Math.floor(random() * 0x10000).toString(16).padStart(4, '0')).join('');
}

// --- OrgoRush distractor logic (simScore / pickByDiff / chooseDistractors) ---
function carbonCount(c: Compound): number | null {
  if (!c.formula || c.formula.includes(')n')) return null;
  const m = c.formula.match(/^C(\d*)/);
  if (!m) return 0;
  return m[1] === '' ? 1 : parseInt(m[1], 10);
}
function simScore(t: Compound, c: Compound): number {
  let s = 0;
  if (c.formula === t.formula) s += 50;
  s += c.functionalGroups.filter(g => t.functionalGroups.includes(g)).length * 30;
  const ct = carbonCount(t), cc = carbonCount(c);
  if (ct !== null && cc !== null) s += Math.max(0, 12 - Math.abs(ct - cc) * 3);
  s += c.tags.filter(g => t.tags.includes(g)).length * 6;
  return s;
}
function pickByDiff(cands: Compound[], target: Compound, n: number, random: Random): Compound[] {
  // "normal": shuffle, then bias toward the median similarity score.
  const scored = cands.map(c => ({ c, s: simScore(target, c) + random() * 4 }));
  scored.sort(() => random() - 0.5);
  const sorted = scored.slice().sort((a, b) => a.s - b.s);
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)].s : 0;
  scored.sort((a, b) => Math.abs(a.s - med) - Math.abs(b.s - med));
  return scored.slice(0, n).map(x => x.c);
}
export function chooseDistractors(target: Compound, pool: readonly Compound[], n: number, random: Random): Compound[] {
  const others = pool.filter(c => c.id !== target.id);
  const sameSkel = others.filter(c => c.skeletonCategory === target.skeletonCategory);
  const sameSkelFg = sameSkel.filter(c => c.functionalGroups.some(g => target.functionalGroups.includes(g)));
  const crossFg = others.filter(c => c.skeletonCategory !== target.skeletonCategory && c.functionalGroups.some(g => target.functionalGroups.includes(g)));
  let picked: Compound[] = [];
  const take = (list: Compound[], k: number) => { picked = picked.concat(pickByDiff(list.filter(c => !picked.includes(c)), target, k, random)); };
  // Rivals first (normal: ふつう then やさしい), as in OrgoRush.
  for (const lv of ['ふつう', 'やさしい']) {
    const rv = RIVALS.filter(r => r.targetId === target.id && r.level === lv)
      .map(r => COMPOUND_BY_ID.get(r.distractorId))
      .filter((c): c is Compound => !!c && others.includes(c) && !picked.includes(c));
    if (rv.length) { picked.push(rv[Math.floor(random() * rv.length)]); break; }
  }
  if (picked.length < n) take(sameSkelFg, n - picked.length);
  if (picked.length < n) take(sameSkel, n - picked.length);
  if (picked.length < n) take(crossFg, n - picked.length);
  if (picked.length < n) take(others, n - picked.length);
  return picked.slice(0, n);
}

// --- Pools ---
export function fourChoicePool(unitNames: readonly string[], excludedIds: readonly string[]): Compound[] {
  const excluded = new Set(excludedIds);
  const ids = new Set<string>();
  for (const unit of UNITS) if (unitNames.includes(unit.name)) for (const id of unit.compoundIds) ids.add(id);
  return COMPOUNDS.filter(c => ids.has(c.id) && !excluded.has(c.id));
}
export function eligiblePropertyQuestions(pool: readonly Compound[]) {
  const inPool = new Set(pool.map(c => c.id));
  return PROPERTY_QUESTIONS.filter(q => inPool.has(q.targetId) && q.distractorIds.every(id => inPool.has(id)));
}
export function eligiblePairBoards(mode: 'onePair' | 'twoPair', categories: readonly PairCategory[], excludedIds: readonly string[]) {
  const excluded = new Set(excludedIds);
  const bank = mode === 'onePair' ? PAIR_BANK : PAIR2_BANK;
  return bank.filter(entry => {
    if (!categories.includes(entry.category)) return false;
    const ids = mode === 'onePair'
      ? [(entry as typeof PAIR_BANK[number]).targetId, ...entry.structureDecoyIds, ...entry.nameDecoyIds]
      : [...(entry as typeof PAIR2_BANK[number]).targetIds, ...entry.structureDecoyIds, ...entry.nameDecoyIds];
    return ids.every(id => !excluded.has(id));
  });
}
/** Number of C/D questions in a session (OrgoRush ratio: ~20% when mixed). */
export function propertySlotCount(settings: OrgoGameSettings): number {
  const hasAB = settings.directions.some(d => d === 'A' || d === 'B');
  const hasCD = settings.directions.some(d => d === 'C' || d === 'D');
  if (!hasCD) return 0;
  if (!hasAB) return settings.questionCount;
  return settings.questionCount === 5 ? 1 : 2;
}

function fourPrompt(direction: Direction, target: Compound, choices: Compound[], random: Random) {
  const ordered = shuffled(choices, random);
  if (direction === 'A') return { kind: 'four' as const, direction, targetName: target.nameJa, choices: ordered.map(c => ({ id: c.id, structure: c.structureSvg })) };
  if (direction === 'B') return { kind: 'four' as const, direction, targetStructure: target.structureSvg, choices: ordered.map(c => ({ id: c.id, name: c.nameJa })) };
  if (direction === 'C') return { kind: 'four' as const, direction, properties: target.properties, choices: ordered.map(c => ({ id: c.id, name: c.nameJa })) };
  return { kind: 'four' as const, direction, properties: target.properties, choices: ordered.map(c => ({ id: c.id, structure: c.structureSvg })) };
}

export function generateQuestionSet(settings: OrgoGameSettings, random: Random = Math.random, exclusion: ExclusionProfile): InternalQuestion[] {
  validateGameSettings(settings);
  const questions: InternalQuestion[] = [];
  if (settings.mode === 'four') {
    const pool = fourChoicePool(settings.units, exclusion.excludedIds);
    if (pool.length < settings.questionCount) throw new QuestionPreparationError(PREPARATION_MESSAGE);
    const cdCount = propertySlotCount(settings);
    const eligibleCD = eligiblePropertyQuestions(pool);
    if (eligibleCD.length < cdCount) throw new QuestionPreparationError('性質問題（C/D）の適格な問題が足りません。範囲を広げるか、除外を減らしてください');
    const cdPicks = shuffled(eligibleCD, random).slice(0, cdCount);
    const cdTargets = new Set(cdPicks.map(q => q.targetId));
    const abCount = settings.questionCount - cdCount;
    const abTargets = shuffled(pool.filter(c => !cdTargets.has(c.id)), random).slice(0, abCount);
    if (abTargets.length < abCount) throw new QuestionPreparationError(PREPARATION_MESSAGE);
    const abDirs = settings.directions.filter((d): d is Direction => d === 'A' || d === 'B');
    const cdDirs = settings.directions.filter((d): d is Direction => d === 'C' || d === 'D');
    const cdDirectionFor = (i: number): Direction => {
      if (cdDirs.length === 1) return cdDirs[0];
      if (cdCount === 1) return cdDirs[Math.floor(random() * cdDirs.length)];
      return cdDirs[i % 2];
    };
    for (const target of abTargets) {
      const distractors = chooseDistractors(target, pool, 3, random);
      if (distractors.length < 3) throw new QuestionPreparationError(PREPARATION_MESSAGE);
      const direction = abDirs[Math.floor(random() * abDirs.length)];
      questions.push({
        id: identifier(random), ordinal: questions.length, mode: 'four',
        prompt: fourPrompt(direction, target, [target, ...distractors], random),
        fields: [{ id: 'choice', type: 'choice' }], maxScore: 1,
        answer: { targetId: target.id, canonical: target.nameJa },
      });
    }
    cdPicks.forEach((q, i) => {
      const target = COMPOUND_BY_ID.get(q.targetId)!;
      const choices = [target, ...q.distractorIds.map(id => COMPOUND_BY_ID.get(id)!)];
      questions.push({
        id: identifier(random), ordinal: questions.length, mode: 'four',
        prompt: fourPrompt(cdDirectionFor(i), target, choices, random),
        fields: [{ id: 'choice', type: 'choice' }], maxScore: 1,
        answer: { targetId: target.id, canonical: target.nameJa },
      });
    });
    const mixed = shuffled(questions, random);
    mixed.forEach((q, i) => { (q as { ordinal: number }).ordinal = i; });
    return freeze(mixed);
  }
  // Pairing modes
  const eligible = eligiblePairBoards(settings.mode, settings.pairCategories, exclusion.excludedIds);
  if (eligible.length < settings.questionCount) throw new QuestionPreparationError(PREPARATION_MESSAGE);
  const picks = shuffled(eligible, random).slice(0, settings.questionCount);
  for (const entry of picks) {
    const targetIds = settings.mode === 'onePair' ? [(entry as typeof PAIR_BANK[number]).targetId] : [...(entry as typeof PAIR2_BANK[number]).targetIds];
    const structures = shuffled([...targetIds, ...entry.structureDecoyIds], random);
    const names = shuffled([...targetIds, ...entry.nameDecoyIds], random);
    questions.push({
      id: identifier(random), ordinal: questions.length, mode: settings.mode,
      prompt: { kind: 'pair', category: entry.category, structures, names },
      fields: targetIds.map((_, i) => {
        const fid = (i === 0 ? 'pair1' : 'pair2') as 'pair1' | 'pair2';
        return { id: fid, type: fid };
      }),
      maxScore: targetIds.length,
      answer: {
        targetIds,
        canonical: targetIds.map(id => COMPOUND_BY_ID.get(id)!.nameJa).join('・'),
        keyComparison: entry.keyComparison,
      },
    });
  }
  return freeze(questions);
}

export function toPublicQuestion(question: InternalQuestion, progress: QuestionProgress): PublicQuestion {
  return freeze({ id: question.id, ordinal: question.ordinal, prompt: question.prompt, fields: question.fields, progress });
}
