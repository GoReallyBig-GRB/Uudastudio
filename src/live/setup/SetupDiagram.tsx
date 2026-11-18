import React from 'react';

type Kind = 'single' | 'mixer' | 'desk';

const Box: React.FC<{ x: number; y: number; w: number; label: string }> = ({ x, y, w, label }) => (
  <g>
    <rect x={x} y={y} width={w} height={44} rx={8} className="fill-surface-2 stroke-line-strong" strokeWidth={1.5} />
    <text x={x + w / 2} y={y + 27} textAnchor="middle" className="fill-ink" fontSize={13} fontWeight={600}>{label}</text>
  </g>
);
const Cable: React.FC<{ x1: number; x2: number; y: number; n?: string; label: string }> = ({ x1, x2, y, n, label }) => (
  <g>
    <line x1={x1} y1={y} x2={x2} y2={y} className="stroke-accent" strokeWidth={2.5} />
    {n && <circle cx={(x1 + x2) / 2} cy={y} r={9} className="fill-surface-0 stroke-accent" strokeWidth={1.5} />}
    {n && <text x={(x1 + x2) / 2} y={y + 4} textAnchor="middle" className="fill-accent" fontSize={11} fontWeight={700}>{n}</text>}
    <text x={(x1 + x2) / 2} y={y - 12} textAnchor="middle" className="fill-ink-dim" fontSize={11}>{label}</text>
  </g>
);

/** A simple picture of how the equipment is joined. The text steps beside it say the same thing. */
export const SetupDiagram: React.FC<{ kind: Kind; micLabel?: string }> = ({ kind, micLabel = 'Microphone' }) => {
  const alt = kind === 'single' ? `${micLabel} connected to the computer.` : kind === 'mixer' ? 'Mixer connected to the computer with one USB cable, carrying sound both ways.' : 'Studio desk connected to an audio interface by two audio cables, and the interface connected to the computer by USB.';
  return (
    <svg viewBox="0 0 400 110" role="img" aria-label={alt} className="w-full max-w-md">
      {kind === 'single' && (<><Box x={20} y={34} w={130} label={micLabel} /><Box x={250} y={34} w={130} label="Computer (Uuda)" /><Cable x1={150} x2={250} y={56} label="USB or wire" /></>)}
      {kind === 'mixer' && (<><Box x={20} y={34} w={130} label="Mixer or desk" /><Box x={250} y={34} w={130} label="Computer (Uuda)" /><Cable x1={150} x2={250} y={56} n="1" label="USB, both ways" /></>)}
      {kind === 'desk' && (<>
        <Box x={8} y={34} w={96} label="Studio desk" /><Box x={152} y={34} w={96} label="Interface" /><Box x={296} y={34} w={96} label="Computer" />
        <Cable x1={104} x2={152} y={46} n="1" label="aux send in" /><Cable x1={104} x2={152} y={70} n="2" label="out to channel" />
        <Cable x1={248} x2={296} y={56} n="3" label="USB" />
      </>)}
    </svg>
  );
};
