/**
 * Uuda Studio - template sync logic, independent of Express.
 *
 * Takes a store (the three template methods) and returns a status and body, so the same rules apply whichever web
 * layer calls it (today the Express routes; later a Worker handler). Every template is re-validated here with the
 * same parser the app uses for files, so nothing unchecked reaches storage no matter what the browser sends.
 */

import { parseTemplate } from '../src/templates/template';
import type { DataStore, ServerTemplate } from './store';

export type TemplateStore = Pick<DataStore, 'saveTemplate' | 'getTemplatesForUser' | 'deleteTemplate'>;

export const MAX_TEMPLATES_PER_USER = 50;
export const MAX_TEMPLATE_BYTES = 200_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export interface TemplateItem {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
  template: unknown;
}

export interface ServiceResult<T> {
  status: number;
  body: T | { error: string };
}

function toItem(t: ServerTemplate): TemplateItem {
  return { id: t.id, name: t.name, createdAt: t.created_at, updatedAt: t.updated_at, sizeBytes: t.size_bytes, template: t.data };
}

export async function listUserTemplates(store: TemplateStore, userId: string): Promise<ServiceResult<{ items: TemplateItem[] }>> {
  const rows = await store.getTemplatesForUser(userId);
  return { status: 200, body: { items: rows.map(toItem) } };
}

/** Creates or replaces one of the user's templates. The template's own id is the key, so saving twice updates. */
export async function upsertUserTemplate(store: TemplateStore, userId: string, raw: unknown): Promise<ServiceResult<{ item: TemplateItem }>> {
  const candidate = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).template : undefined;
  if (candidate === undefined) return { status: 400, body: { error: 'A template is required.' } };

  const parsed = parseTemplate(candidate);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  const template = parsed.template;
  // Ids become part of storage keys, so only plain ones are accepted; anything else gets a fresh id
  const id = ID_PATTERN.test(template.id) ? template.id : `tpl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const stored = { ...template, id };

  const bytes = Buffer.byteLength(JSON.stringify(stored), 'utf8');
  if (bytes > MAX_TEMPLATE_BYTES) {
    return { status: 413, body: { error: `That template is too large (limit ${Math.round(MAX_TEMPLATE_BYTES / 1000)} KB).` } };
  }

  const existing = await store.getTemplatesForUser(userId);
  if (!existing.some((t) => t.id === id) && existing.length >= MAX_TEMPLATES_PER_USER) {
    return { status: 409, body: { error: `You can keep up to ${MAX_TEMPLATES_PER_USER} templates. Delete one to save another.` } };
  }

  const saved = await store.saveTemplate(userId, id, stored.name, stored);
  return { status: 200, body: { item: toItem(saved) } };
}

export async function removeUserTemplate(store: TemplateStore, userId: string, id: string): Promise<ServiceResult<{ ok: true }>> {
  if (!ID_PATTERN.test(id)) return { status: 400, body: { error: 'Invalid template id.' } };
  const deleted = await store.deleteTemplate(userId, id);
  return deleted ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'Template not found.' } };
}
