// The common profile stored in the Teachers durable object is the compound
// exclusion list (spec: AlkaneLite-style common save by the master only).
import { COMPOUND_BY_ID } from './types';

export type ExclusionProfile = { version: 1; excludedIds: string[] };
export const DEFAULT_EXCLUSION: ExclusionProfile = Object.freeze({ version: 1, excludedIds: [] });

export function validateExclusionProfile(raw: unknown): ExclusionProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('除外設定が不正です');
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || !Array.isArray(value.excludedIds)) throw new TypeError('除外設定の版が不正です');
  const ids = value.excludedIds as unknown[];
  if (ids.length > 122 || ids.some(id => typeof id !== 'string' || !COMPOUND_BY_ID.has(id as string))) {
    throw new TypeError('除外する化合物を確認してください');
  }
  if (new Set(ids).size !== ids.length) throw new TypeError('除外リストに重複があります');
  return { version: 1, excludedIds: [...(ids as string[])] };
}
