import { UNIT_NAMES, type OrgoGameSettings } from './types';

export function parseCompetitionSettings(input: unknown): { questionCount: 5 | 10; timeLimitMinutes: number } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('競技設定はオブジェクトで指定してください');
  }
  const { questionCount, timeLimitMinutes } = input as Record<string, unknown>;
  if (questionCount !== 5 && questionCount !== 10) {
    throw new TypeError('問題数は5問か10問から選んでください');
  }
  if (typeof timeLimitMinutes !== 'number' || !Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 3 || timeLimitMinutes > 10) {
    throw new TypeError('制限時間は3分から10分の間で選んでください');
  }
  return { questionCount, timeLimitMinutes };
}

export function validateGameSettings(settings: OrgoGameSettings): { maxScore: number } {
  parseCompetitionSettings(settings);
  if (!['four', 'onePair', 'twoPair'].includes(settings.mode)) throw new TypeError('モードが不正です');
  if (!['immediate', 'deferred'].includes(settings.gradingMode)) throw new TypeError('判定方式が不正です');
  if (settings.mode === 'four') {
    if (!Array.isArray(settings.units) || settings.units.length === 0 || settings.units.some(u => !UNIT_NAMES.includes(u))) {
      throw new TypeError('出題範囲（unit）を1つ以上選んでください');
    }
    if (!Array.isArray(settings.directions) || settings.directions.length === 0 || settings.directions.some(d => !['A', 'B', 'C', 'D'].includes(d))) {
      throw new TypeError('出題方向を1つ以上選んでください');
    }
  } else {
    if (!Array.isArray(settings.pairCategories) || settings.pairCategories.length === 0 || settings.pairCategories.some(c => !['aliphatic', 'aromatic'].includes(c))) {
      throw new TypeError('出題範囲（脂肪族／芳香族）を1つ以上選んでください');
    }
  }
  return { maxScore: settings.questionCount * (settings.mode === 'twoPair' ? 2 : 1) };
}
