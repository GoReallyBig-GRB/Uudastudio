/**
 * Design-system gallery. Dev-only: open the app with ?uigallery=1.
 * Shows the tokens and every shared primitive so the redesign can be reviewed before any screen uses them.
 * Delete this file (and its hook in main.tsx) once the redesign stages have replaced it with real screens.
 */
import React, { useState } from 'react';
import { Download, Play } from 'lucide-react';
import { Button, Card, Input, ModalShell, SegmentedControl, Slider, Switch, type CapsuleVariant } from './index';
import { HeaderMock } from './HeaderMock';

// Full literal class names: Tailwind only generates classes it can see in the source as complete strings.
const SURFACES = [
  { name: 'surface-0', cls: 'bg-surface-0' },
  { name: 'surface-1', cls: 'bg-surface-1' },
  { name: 'surface-2', cls: 'bg-surface-2' },
  { name: 'surface-3', cls: 'bg-surface-3' },
] as const;
const CLIPS = ['bg-clip-1', 'bg-clip-2', 'bg-clip-3', 'bg-clip-4', 'bg-clip-5'] as const;

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mb-10">
    <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{title}</h2>
    {children}
  </section>
);

const Gallery: React.FC = () => {
  const [on, setOn] = useState(true);
  const [mode, setMode] = useState<'original' | 'mastered'>('mastered');
  const [target, setTarget] = useState(-16);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [capsuleVariant, setCapsuleVariant] = useState<CapsuleVariant>('joined');

  return (
    <div className="h-screen overflow-y-auto bg-surface-0 px-6 py-10 font-sans text-ink select-text">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Uuda design system</h1>
        <p className="mb-10 text-sm text-ink-dim">Foundation preview. Cyan is the only interactive accent; gold is for brand moments.</p>

        <Section title="Header and toolbar mock: capsule groups vs loose pills">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <SegmentedControl<CapsuleVariant>
              label="Button style"
              size="sm"
              value={capsuleVariant}
              onChange={setCapsuleVariant}
              options={[{ value: 'joined', label: 'Capsule groups' }, { value: 'loose', label: 'Loose pills' }]}
            />
            <span className="text-xs text-ink-faint">Related buttons share one pill; unrelated actions stay separate. Cyan marks only what is on, gold only Export and the brand.</span>
          </div>
          <HeaderMock variant={capsuleVariant} />
        </Section>

        <Section title="Surfaces">
          <div className="grid grid-cols-4 gap-3">
            {SURFACES.map((s) => (
              <div key={s.name} className={`h-20 rounded-card border border-line ${s.cls} p-3 text-xs text-ink-dim`}>{s.name}</div>
            ))}
          </div>
        </Section>

        <Section title="Accent, brand and status">
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="rounded-full bg-accent px-3 py-1.5 font-semibold text-accent-ink">accent</span>
            <span className="rounded-full bg-gold px-3 py-1.5 font-semibold text-gold-ink">gold</span>
            <span className="rounded-full bg-ok/15 px-3 py-1.5 text-ok">ok</span>
            <span className="rounded-full bg-warn/15 px-3 py-1.5 text-warn">warn</span>
            <span className="rounded-full bg-danger/15 px-3 py-1.5 text-danger">danger</span>
          </div>
        </Section>

        <Section title="Track tints: one hue, five steps">
          <div className="space-y-1.5 rounded-card border border-line bg-surface-1 p-3">
            {CLIPS.map((cls, i) => (
              <div key={cls} className="flex h-10 items-center gap-2">
                <span className="w-12 text-[11px] text-ink-faint">Track {i + 1}</span>
                <div className={`flex h-full flex-1 items-end gap-px overflow-hidden rounded-md ${cls} px-1 pb-1`}>
                  {Array.from({ length: 80 }, (_, k) => (
                    <span key={k} className="w-full rounded-sm bg-wave/80" style={{ height: `${20 + ((k * 37 + i * 11) % 60)}%` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" leftIcon={<Play className="h-4 w-4" />}>Play</Button>
            <Button variant="brand" leftIcon={<Download className="h-4 w-4" />}>Export</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Delete</Button>
            <Button variant="primary" loading>Saving</Button>
            <Button variant="secondary" disabled>Disabled</Button>
            <Button variant="secondary" size="sm">Small</Button>
            <Button variant="primary" size="lg">Large</Button>
          </div>
        </Section>

        <Section title="Controls">
          <Card className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-5">
              <Switch checked={on} onChange={setOn} label="Mastering on" />
              <SegmentedControl
                label="Monitor"
                value={mode}
                onChange={setMode}
                options={[{ value: 'original', label: 'Original' }, { value: 'mastered', label: 'Mastered' }]}
              />
            </div>
            <Slider label="Target loudness" value={target} min={-30} max={-8} step={0.5} unit="LUFS" display={target.toFixed(1)} onChange={setTarget} />
          </Card>
        </Section>

        <Section title="Inputs">
          <Card className="grid gap-4 sm:grid-cols-2">
            <Input label="Project title" placeholder="Untitled project" value={title} onChange={(e) => setTitle(e.target.value)} hint="Shown in the header and the file name." />
            <Input label="Ceiling" defaultValue="-1.0" suffix="dBTP" />
            <Input label="Email" defaultValue="not-an-email" error="Enter a valid email address." />
          </Card>
        </Section>

        <Section title="Modal">
          <Button variant="secondary" onClick={() => setOpen(true)}>Open modal</Button>
        </Section>
      </div>

      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        title="Export project"
        description="Choose a format and an optional loudness target."
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="brand" onClick={() => setOpen(false)}>Export</Button></>}
      >
        <Input label="File name" defaultValue="Station promo" />
      </ModalShell>
    </div>
  );
};

export default Gallery;
