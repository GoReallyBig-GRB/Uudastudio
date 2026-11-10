import React, { useMemo } from 'react';
import { parseBlocks, type Run } from './scriptFormat';

const renderRuns = (runs: Run[]) =>
  runs.map((r, i) =>
    r.note ? (
      <span key={i} className="mx-0.5 inline-block rounded border border-accent/40 bg-accent/10 px-1.5 py-px align-baseline text-[0.7em] font-semibold italic text-accent" aria-label={`Director's note: ${r.text}`}>{r.text}</span>
    ) : (
      <span key={i} className={`${r.bold ? 'font-bold' : ''} ${r.italic ? 'italic' : ''} ${r.underline ? 'underline decoration-1 underline-offset-4' : ''}`}>{r.text}</span>
    ),
  );

/** A script with its structure: headings, numbered and bulleted lines, indents, bold, italic, underline and highlighted directions. Used on the talent's page and in the producer's view. */
export const FormattedScript: React.FC<{ script: string; size?: number; className?: string }> = ({ script, size, className = '' }) => {
  const blocks = useMemo(() => parseBlocks(script), [script]);
  return (
    <div className={`leading-relaxed text-ink ${className}`} style={size ? { fontSize: size } : undefined}>
      {blocks.map((b, i) => {
        if (b.type === 'blank') return <div key={i} className="h-[0.7em]" aria-hidden />;
        if (b.type === 'heading') return b.level === 1
          ? <h2 key={i} className="mb-1 mt-3 text-[1.25em] font-bold leading-snug first:mt-0">{renderRuns(b.runs)}</h2>
          : <h3 key={i} className="mb-0.5 mt-2 text-[1.1em] font-semibold leading-snug text-ink-dim first:mt-0">{renderRuns(b.runs)}</h3>;
        const pad = { paddingLeft: `${b.indent * 1.5}em` };
        if (b.type === 'item') return (
          <div key={i} className="flex gap-2" style={pad}>
            <span className="w-[1.6em] shrink-0 text-right font-num text-ink-dim" aria-hidden>{b.marker}</span>
            <span className="min-w-0 flex-1 break-words">{renderRuns(b.runs)}</span>
          </div>
        );
        return <div key={i} className="break-words" style={pad}>{renderRuns(b.runs)}</div>;
      })}
    </div>
  );
};
