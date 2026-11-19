/** The plain-text problem report: what is needed to help, and nothing personal. No audio, no names, no event titles, no links. */
export interface ReportInput {
  when: Date;
  browser: string;
  platform: string;
  /** Names of the sound devices (for example "USB Audio Interface"); device ids are never included */
  inputs: string[];
  outputs: string[];
  studio: { gear: string; mode: string; programContains: string; headphones: boolean; quality: string } | null;
  checks: { computer?: string; network?: string; route?: string; microphone?: string };
  errors: string[];
}

/** Takes out anything that looks like a link, an email address or a long token */
export const scrub = (s: string): string => s.replace(/https?:\/\/\S+/gi, '[link]').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').replace(/[A-Za-z0-9_-]{24,}/g, '[token]').slice(0, 200);

export function buildReport(r: ReportInput): string {
  const lines = [
    'Uuda Studio: live problem report',
    `Time: ${r.when.toISOString()}`,
    `Browser: ${scrub(r.browser)} on ${scrub(r.platform)}`,
    `Sound inputs: ${r.inputs.length ? r.inputs.map(scrub).join('; ') : 'none found'}`,
    `Sound outputs: ${r.outputs.length ? r.outputs.map(scrub).join('; ') : 'none found'}`,
  ];
  if (r.studio) lines.push(`Studio: ${r.studio.gear}, ${r.studio.mode}, program contains ${r.studio.programContains}, headphones ${r.studio.headphones ? 'yes' : 'no'}, quality ${r.studio.quality}`);
  else lines.push('Studio: none saved');
  lines.push(`Computer check: ${r.checks.computer ?? 'not run'}`, `Connection check: ${r.checks.network ?? 'not run'}`, `Echo loop test: ${r.checks.route ?? 'not run'}`, `Microphone: ${r.checks.microphone ?? 'not run'}`);
  lines.push(r.errors.length ? `Recent errors:\n${r.errors.slice(-5).map((e) => `- ${scrub(e)}`).join('\n')}` : 'Recent errors: none');
  lines.push('This report holds no audio, names, event titles or links.');
  return lines.join('\n');
}
