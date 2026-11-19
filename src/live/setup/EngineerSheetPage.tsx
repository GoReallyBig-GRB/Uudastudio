/** A one-page sheet for a studio engineer: what to plug in where, and what Uuda does. Opens from a link, needs no sign-in, and prints cleanly. */
import React, { useMemo, useState } from 'react';
import { Button } from '../../components/ui';
import { SetupDiagram } from './SetupDiagram';
import { gearLabel, recommend } from './setupPlan';
import { parseSheetHash, sheetLink, type SheetRequest } from './sheetLink';

export const EngineerSheet: React.FC<{ req: SheetRequest; showActions?: boolean }> = ({ req, showActions = true }) => {
  const plan = useMemo(() => recommend(req), [req]);
  const [copied, setCopied] = useState(false);
  const link = sheetLink(window.location.origin, req, req.name);
  const copy = () => { void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined); };
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-4 bg-surface-0 p-6 text-ink print:max-w-none print:bg-white print:p-0 print:text-black">
      <header>
        <p className="text-xs text-ink-dim">Uuda Studio: studio connection sheet</p>
        <h1 className="text-xl font-semibold tracking-tight">{req.name || plan.title}</h1>
        <p className="text-sm text-ink-dim">Equipment: {gearLabel(req.gear)}. New events start as {plan.mode === 'broadcast' ? 'Broadcast' : 'Conversation'}.</p>
      </header>
      <SetupDiagram kind={plan.diagram} micLabel="Microphone" />
      <section><h2 className="mb-1 text-sm font-semibold">How to connect</h2><ol className="list-decimal pl-5 text-sm">{plan.connect.map((c) => <li key={c} className="mb-1">{c}</li>)}</ol></section>
      {plan.needs.length > 0 && <section><h2 className="mb-1 text-sm font-semibold">You may need</h2><ul className="list-disc pl-5 text-sm">{plan.needs.map((n) => <li key={n}>{n}</li>)}</ul></section>}
      {plan.warnings.length > 0 && <section><h2 className="mb-1 text-sm font-semibold">Watch out</h2><ul className="list-disc pl-5 text-sm">{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul></section>}
      <section><h2 className="mb-1 text-sm font-semibold">What Uuda sets up</h2><ul className="list-disc pl-5 text-sm">{plan.settings.map((s) => <li key={s}>{s}</li>)}</ul></section>
      {showActions && (
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="primary" onClick={() => window.print()}>Print this sheet</Button>
          <Button variant="secondary" onClick={copy}>{copied ? 'Link copied' : 'Copy link to this sheet'}</Button>
        </div>)}
    </article>
  );
};

const EngineerSheetPage: React.FC = () => {
  const req = parseSheetHash(window.location.hash);
  if (!req) return <main className="flex min-h-screen items-center justify-center bg-surface-0 p-6 text-sm text-ink">This sheet link is not valid. Ask for a new one.</main>;
  return <main className="min-h-screen bg-surface-0"><EngineerSheet req={req} /></main>;
};
export default EngineerSheetPage;
