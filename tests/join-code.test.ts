import { describe, expect, it } from 'vitest';
import { parseJoinCode } from '../src/join-code';

describe('parseJoinCode', () => {
  it('extracts the code from a full join URL (host QR payload)', () => {
    expect(parseJoinCode('https://orgocompetition.koichem.workers.dev/#/join/ABC234')).toBe('ABC234');
  });
  it('does not grab letters from the scheme or domain', () => {
    expect(parseJoinCode('https://orgocompetition.koichem.workers.dev/')).toBeNull();
    expect(parseJoinCode('https://example.com/#/other/ABC234')).toBeNull();
  });
  it('accepts a bare code and normalizes case', () => {
    expect(parseJoinCode('abc234')).toBe('ABC234');
    expect(parseJoinCode('  ZZ29XY ')).toBe('ZZ29XY');
  });
  it('rejects codes containing 0 or 1 and wrong lengths', () => {
    expect(parseJoinCode('ABC101')).toBeNull();
    expect(parseJoinCode('ABC12')).toBeNull();
    expect(parseJoinCode('ABC2344')).toBeNull();
    expect(parseJoinCode('https://orgocompetition.koichem.workers.dev/#/join/ABC2344')).toBeNull();
  });
  it('rejects unrelated QR payloads', () => {
    expect(parseJoinCode('WIFI:T:WPA;S:foo;;')).toBeNull();
    expect(parseJoinCode('')).toBeNull();
  });
});
