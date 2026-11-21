// OrgoCompe game types. Master data comes from OrgoRush (game/data.json,
// extracted by scripts/extract-data.mjs).
import data from './data.json';

export type Compound = {
  id: string; nameJa: string; formula: string;
  functionalGroups: string[]; skeletonCategory: string; tags: string[];
  structureSvg: string; properties: string;
};
export type UnitDef = { name: string; compoundIds: string[] };
export type Rival = { targetId: string; distractorId: string; level: string };
export type PropertyQuestion = { targetId: string; distractorIds: string[]; approved: boolean };
export type PairBankEntry = {
  id: string; category: PairCategory; targetId: string;
  structureDecoyIds: string[]; nameDecoyIds: string[]; keyComparison?: unknown;
};
export type Pair2BankEntry = {
  id: string; category: PairCategory; targetIds: string[];
  structureDecoyIds: string[]; nameDecoyIds: string[]; keyComparison?: unknown;
};

export const COMPOUNDS = data.compounds as Compound[];
export const UNITS = data.units as UnitDef[];
export const RIVALS = data.rivals as Rival[];
export const PROPERTY_QUESTIONS = data.pQuestions as PropertyQuestion[];
export const PAIR_BANK = data.pairBank as PairBankEntry[];
export const PAIR2_BANK = data.pair2Bank as Pair2BankEntry[];
export const COMPOUND_BY_ID = new Map(COMPOUNDS.map(c => [c.id, c]));
export const UNIT_NAMES = UNITS.map(u => u.name);

export type CompetitionSettings = {
  questionCount: 5 | 10;
  timeLimitMinutes: number;
};
export type GameMode = 'four' | 'onePair' | 'twoPair';
export type Direction = 'A' | 'B' | 'C' | 'D';
export type PairCategory = 'aliphatic' | 'aromatic';
export type GradingMode = 'immediate' | 'deferred';
export type OrgoGameSettings = CompetitionSettings & {
  mode: GameMode;
  units: string[];
  pairCategories: PairCategory[];
  directions: Direction[];
  gradingMode: GradingMode;
};

export type AnswerFieldId = 'choice' | 'pair1' | 'pair2';
export type AnswerField = { id: AnswerFieldId; type: AnswerFieldId };

export type FourPrompt = {
  kind: 'four';
  direction: Direction;
  targetName?: string;
  targetStructure?: string;
  properties?: string;
  choices: { id: string; name?: string; structure?: string }[];
};
export type PairPrompt = {
  kind: 'pair';
  category: PairCategory;
  structures: string[]; // compound ids, display order
  names: string[];      // compound ids, display order
};
export type QuestionPrompt = FourPrompt | PairPrompt;

export type QuestionAnswer = {
  targetId?: string;
  targetIds?: string[];
  canonical: string;
  keyComparison?: unknown;
};
export type InternalQuestion = {
  id: string;
  ordinal: number;
  mode: GameMode;
  prompt: QuestionPrompt;
  fields: readonly AnswerField[];
  maxScore: number;
  answer: QuestionAnswer;
};
export type QuestionProgress = {
  resolvedFieldIds: readonly AnswerFieldId[];
  fieldStates?: Readonly<Partial<Record<AnswerFieldId, 'pending' | 'correct' | 'passed' | 'unanswered'>>>;
};
export type PublicQuestion = Pick<InternalQuestion, 'id' | 'ordinal' | 'prompt' | 'fields'> & { progress: QuestionProgress };
export type FieldEvaluation = { correct: boolean; empty: boolean };
