import { useState } from 'react';

// Host sound (both Lite apps): short ticks in the last 5s before start and
// last 10s before the deadline, a long tone at start / time-up. The ON/OFF
// choice is stored on this device only.
const KEY = 'orgo-lite:host-sound';
export function savedHostSound(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function saveHostSound(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}
export function primeAudio() { audio(); }
function tone(freq: number, seconds: number, delay = 0) {
  const ac = audio(); if (!ac) return;
  const osc = ac.createOscillator(), gain = ac.createGain();
  osc.frequency.value = freq; osc.type = 'sine';
  const t = ac.currentTime + delay;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  osc.connect(gain).connect(ac.destination);
  osc.start(t); osc.stop(t + seconds + 0.05);
}
export function playTick() { tone(880, 0.09); }
export function playBoundary() { tone(660, 0.35); tone(990, 0.35, 0.4); }
export function playAnswerSound(correct: boolean) {
  if (correct) { tone(784, 0.1); tone(1175, 0.16, 0.1); } else { tone(220, 0.18); }
}

export class HostSoundGate {
  private identity = '';
  private seen = new Set<string>();
  private previous: number | null = null;
  observe(start: number, deadline: number, now: number, audible: boolean): 'tick' | 'boundary' | null {
    const identity = `${start}:${deadline}`;
    if (identity !== this.identity) { this.identity = identity; this.seen.clear(); this.previous = null; }
    const previous = this.previous; this.previous = now;
    let key: string | null = null, kind: 'tick' | 'boundary' = 'tick';
    const startSecond = Math.ceil((start - now) / 1000), endSecond = Math.ceil((deadline - now) / 1000);
    if (startSecond >= 1 && startSecond <= 5) key = `start:${startSecond}`;
    else if (now >= start && endSecond >= 1 && endSecond <= 10) key = `end:${endSecond}`;
    for (const [label, time] of [['start', start], ['end', deadline]] as const) {
      if (previous !== null && previous < time && now >= time && now - time < 1000 && now - previous <= 1500) { key = `${label}:0`; kind = 'boundary'; }
    }
    if (!key || this.seen.has(key)) return null;
    this.seen.add(key); return audible ? kind : null;
  }
}

export function useHostSoundToggle() {
  const [on, setOn] = useState(savedHostSound());
  return { on, toggle: () => { const next = !on; setOn(next); saveHostSound(next); if (next) primeAudio(); } };
}
