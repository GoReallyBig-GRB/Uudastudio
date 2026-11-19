/** The live guide: searchable help, a fix-a-problem list, and the checks. Works offline: everything is in the app. */
import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button, ModalShell } from '../../components/ui';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { searchGuide, type Problem, type GuideSection } from './guideContent';

const Block: React.FC<{ title: string; children: React.ReactNode; open?: boolean }> = ({ title, children, open }) => (
  <details open={open} className="rounded-control border border-line bg-surface-2 px-3 py-2">
    <summary className="cursor-pointer text-sm font-medium text-ink">{title}</summary>
    <div className="mt-2 flex flex-col gap-2 text-sm text-ink">{children}</div>
  </details>
);
const SectionView: React.FC<{ s: GuideSection; open?: boolean }> = ({ s, open }) => (
  <Block title={s.title} open={open}>{s.paragraphs.map((p) => <p key={p}>{p}</p>)}{s.steps && <ol className="list-decimal pl-5">{s.steps.map((x) => <li key={x} className="mb-1">{x}</li>)}</ol>}</Block>
);
const ProblemView: React.FC<{ p: Problem; open?: boolean }> = ({ p, open }) => (
  <Block title={p.symptom} open={open}><p className="text-xs text-ink-dim">Try these in order, quickest first:</p><ol className="list-decimal pl-5">{p.steps.map((x) => <li key={x} className="mb-1">{x}</li>)}</ol></Block>
);

export const LiveGuide: React.FC<{ open: boolean; onClose: () => void; onRunSetup: () => void }> = ({ open, onClose, onRunSetup }) => {
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchGuide(q), [q]);
  const searching = q.trim().length > 0;
  const sections = hits.filter((h) => h.kind === 'section');
  const problems = hits.filter((h) => h.kind === 'problem');
  return (
    <ModalShell open={open} onClose={onClose} above size="md" title="Live guide" description="Plain help for going live. Search, or pick a problem." footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-4">
        <label className="relative block">
          <span className="sr-only">Search the guide</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, for example: echo, obs, bluetooth"
            className="h-10 w-full rounded-control border border-line-strong bg-surface-3 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint hover:border-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" />
        </label>
        {!searching && <div><Button variant="secondary" onClick={onRunSetup}>Run the setup assistant</Button></div>}
        {hits.length === 0 && <p className="text-sm text-ink-dim">Nothing matches that. Try one word, such as echo, quiet or join.</p>}
        {sections.length > 0 && <div className="flex flex-col gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Guide</h3>{sections.map((h) => <SectionView key={(h.item as GuideSection).id} s={h.item as GuideSection} open={searching} />)}</div>}
        {problems.length > 0 && <div className="flex flex-col gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Fix a problem</h3>{problems.map((h) => <ProblemView key={(h.item as Problem).id} p={h.item as Problem} open={searching && problems.length <= 3} />)}</div>}
        {!searching && (
          <div className="flex flex-col gap-2 border-t border-line pt-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Check everything</h3><DiagnosticsPanel /></div>)}
      </div>
    </ModalShell>
  );
};
