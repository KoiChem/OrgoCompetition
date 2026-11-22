import { useId, type CSSProperties } from "react";

export function HostRunner({ id, color = "#1763a6", goal, stopped, rest = false, dash = false }: { id: string; color?: string; goal: boolean; stopped: boolean; rest?: boolean; dash?: boolean }) {
  const outlineId = `runner-outline-${useId()}`;
  const bodyFilter = `url(#${outlineId})`;
  return <svg className={`race-runner ${goal ? "is-goal" : ""} ${stopped ? "is-stopped" : ""} ${rest ? "is-resting" : ""} ${dash ? "is-dashing" : ""}`} viewBox={rest ? "-38 -44 76 68" : "-36 -68 72 102"} aria-hidden="true" style={{ color, "--runner-phase": `${(id.charCodeAt(0) % 5) * -0.08}s` } as CSSProperties}>
    <defs>
      <filter id={outlineId} filterUnits="userSpaceOnUse" x="-100" y="-110" width="200" height="200" colorInterpolationFilters="sRGB">
        <feMorphology in="SourceAlpha" operator="dilate" radius="1" result="expanded"/>
        <feComposite in="expanded" in2="SourceAlpha" operator="out" result="boundary"/>
        <feFlood floodColor="#333333" result="outline-color"/>
        <feComposite in="outline-color" in2="boundary" operator="in" result="outline"/>
        <feMerge><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    {rest ? <g className="runner-rest"><ellipse className="runner-shadow" cx="-2" cy="0" rx="27" ry="2"/><g className="runner-body" filter={bodyFilter}><path className="runner-rest-left-leg" d="M-14 -9 L-19 -4 L-33 -6"/><path className="runner-rest-right-leg" d="M-15 -9 L-24 -18 L-25 -7"/><path className="runner-rest-body runner-rest-torso" d="M-13 -9 L-1 -9 L7 -15"/><path className="runner-rest-right-arm" d="M4 -13 L-1 -16 L-13 -13"/><path className="runner-rest-left-arm" d="M4 -12 L9 -4 L16 -9 L19 -8"/><circle className="runner-rest-head runner-head" cx="16" cy="-24" r="12"/></g><text className="runner-rest-sleep" x="27" y="-37">💤</text></g> : dash && !goal ? <g className="runner-dash"><ellipse className="runner-shadow" cx="0" cy="29" rx="20" ry="2"/><g className="runner-dash-speed"><path d="M-33 -13 h10 M-35 -5 h12 M-32 3 h9"/></g><g className="runner-body" filter={bodyFilter}><circle className="runner-dash-head runner-head" cx="11" cy="-43" r="15"/><path d="M6 -28 L-4 -8"/><path className="runner-dash-arm" d="M4 -24 L-11 -26 L-21 -17 M2 -22 L16 -15 L22 -20"/><path className="runner-dash-leg" d="M-4 -8 L-17 11 L-27 7 M-4 -8 L11 8 L25 24"/></g></g> : <>
    {!goal && <ellipse className="runner-shadow" cx="3" cy="28" rx="19" ry="2"/>}
    <g className="runner-body" filter={bodyFilter}>
      <g className="runner-head-motion"><circle className="runner-head" cx="0" cy="-43" r="17"/></g><line x1="0" y1="-26" x2="2" y2="-5"/>
      {goal ? <>
        <g className="runner-goal-arm-left"><path d="M0 -17 L-16.8 -16.3 L-27.945 -24.887"/></g>
        <g className="runner-goal-arm-right"><path d="M1 -17 L17.8 -16.3 L28.945 -24.887"/></g>
        <path className="runner-goal-grounded-leg" d="M2 -5 L-10 26"/>
        <path className="runner-goal-kicked-leg" d="M2 -5 L14 13 L24 5"/>
      </> : <>
        <g className="runner-arm runner-arm-left"><line x1="0" y1="-17" x2="-18" y2="-17"/></g>
        <g className="runner-arm runner-arm-right"><line x1="1" y1="-17" x2="19" y2="-17"/></g>
        <g className="runner-leg runner-leg-left"><line x1="2" y1="-5" x2="2" y2="25"/></g>
        <g className="runner-leg runner-leg-right"><line x1="2" y1="-5" x2="2" y2="25"/></g>
      </>}
    </g>
    {goal ? <g className="runner-joy-rays">
      {[-22, -13, 0, 13, 22].map((x, index) => <path key={x} className={`runner-joy-ray runner-joy-ray-${index + 1}`} d={index === 2 ? "M0 -63 v-3" : `M${x} ${index === 0 || index === 4 ? -58 : -62} l${x < 0 ? -3 : 3} ${index === 0 || index === 4 ? -2 : -3}`}/>)}
    </g> : <g className="runner-sweat">
      {[0, 1, 2].map(index => <path key={index} className="runner-sweat-drop" d="M-23,-55 C-20,-58 -17,-58 -14,-55 C-12,-52 -14,-49 -18,-49 C-21,-49 -24,-52 -23,-55 Z"/>)}
    </g>}
    </>}
  </svg>;
}
