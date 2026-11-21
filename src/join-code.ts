// Extract a 6-character join code from a scanned QR payload or typed text.
// Host QR codes encode a full join URL (…/#/join/ABC123), so a naive
// first-match scan would grab letters from the scheme/domain instead.
// Only two shapes are accepted: a join URL hash segment, or the bare code.
export function parseJoinCode(raw: string): string | null {
  const text = raw.trim();
  const fromHash = /#\/join\/([A-Za-z2-9]{6})(?![A-Za-z0-9])/.exec(text);
  if (fromHash) return fromHash[1].toUpperCase();
  if (/^[A-Za-z2-9]{6}$/.test(text)) return text.toUpperCase();
  return null;
}

export function isJoinCode(value: string): boolean {
  return /^[A-Z2-9]{6}$/.test(value);
}
