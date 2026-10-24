import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  listUserTemplates, upsertUserTemplate, removeUserTemplate, TemplateStore,
  MAX_TEMPLATES_PER_USER, MAX_TEMPLATE_BYTES,
} from './templateService';
import type { ServerTemplate } from './db';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtIn';
import { serializeTemplate } from '../src/templates/template';

/** In-memory store with the same three methods, so these tests check the rules, not a database */
function memoryStore(): TemplateStore & { rows: ServerTemplate[] } {
  const rows: ServerTemplate[] = [];
  let tick = 0;
  return {
    rows,
    async saveTemplate(userId, id, name, data) {
      const now = new Date(1_700_000_000_000 + ++tick * 1000).toISOString();
      let t = rows.find((r) => r.id === id && r.user_id === userId);
      if (t) Object.assign(t, { name, data, updated_at: now, size_bytes: JSON.stringify(data).length });
      else {
        t = { id, user_id: userId, name, data, size_bytes: JSON.stringify(data).length, created_at: now, updated_at: now };
        rows.push(t);
      }
      return t;
    },
    async getTemplatesForUser(userId) {
      return rows.filter((r) => r.user_id === userId).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
    async deleteTemplate(userId, id) {
      const i = rows.findIndex((r) => r.id === id && r.user_id === userId);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
  };
}

const good = () => JSON.parse(serializeTemplate(BUILT_IN_TEMPLATES[0]));

describe('template sync rules', () => {
  it('saves, lists newest first, and updates in place when saved again', async () => {
    const s = memoryStore();
    const a = { ...good(), id: 'tpl-a', name: 'A' };
    const b = { ...good(), id: 'tpl-b', name: 'B' };
    expect((await upsertUserTemplate(s, 'u1', { template: a })).status).toBe(200);
    expect((await upsertUserTemplate(s, 'u1', { template: b })).status).toBe(200);
    const list = await listUserTemplates(s, 'u1');
    expect((list.body as any).items.map((i: any) => i.id)).toEqual(['tpl-b', 'tpl-a']);

    await upsertUserTemplate(s, 'u1', { template: { ...a, name: 'A renamed' } });
    const again = (await listUserTemplates(s, 'u1')).body as any;
    expect(again.items.length).toBe(2);
    expect(again.items[0].id).toBe('tpl-a');
    expect(again.items[0].name).toBe('A renamed');
  });

  it('keeps each user separate: nobody sees or deletes another user\'s template', async () => {
    const s = memoryStore();
    await upsertUserTemplate(s, 'u1', { template: { ...good(), id: 'same-id', name: 'Mine' } });
    await upsertUserTemplate(s, 'u2', { template: { ...good(), id: 'same-id', name: 'Theirs' } });
    expect(((await listUserTemplates(s, 'u1')).body as any).items[0].name).toBe('Mine');
    expect(((await listUserTemplates(s, 'u2')).body as any).items[0].name).toBe('Theirs');
    expect((await removeUserTemplate(s, 'u3', 'same-id')).status).toBe(404);
    expect((await removeUserTemplate(s, 'u1', 'same-id')).status).toBe(200);
    expect(((await listUserTemplates(s, 'u2')).body as any).items.length).toBe(1);
  });

  it('re-validates on the server: a bad or hostile template is refused or cleaned', async () => {
    const s = memoryStore();
    expect((await upsertUserTemplate(s, 'u1', {})).status).toBe(400);
    expect((await upsertUserTemplate(s, 'u1', null)).status).toBe(400);
    expect((await upsertUserTemplate(s, 'u1', { template: { format: 'nope' } })).status).toBe(400);
    expect((await upsertUserTemplate(s, 'u1', { template: { ...good(), version: 99 } })).status).toBe(400);

    const dirty = await upsertUserTemplate(s, 'u1', {
      template: { ...good(), builtIn: true, tracks: [{ name: 'T', volume: 99, plugins: [{ pluginId: 'p', moduleUrl: 'https://evil.example/x.js', parameters: {} }] }] },
    });
    expect(dirty.status).toBe(200);
    const saved = (dirty.body as any).item.template;
    expect(saved.builtIn).toBe(undefined);
    expect(saved.tracks[0].volume).toBe(1.5);
    expect(JSON.stringify(saved)).not.toContain('evil.example');
  });

  it('never uses an id that could escape its storage key', async () => {
    const s = memoryStore();
    const r = await upsertUserTemplate(s, 'u1', { template: { ...good(), id: 'a/b__c../x' } });
    expect(r.status).toBe(200);
    expect((r.body as any).item.id).toMatch(/^tpl-/);
    expect((await removeUserTemplate(s, 'u1', 'a/b')).status).toBe(400);
  });

  it('limits size and the number of templates per user', async () => {
    const s = memoryStore();
    const huge = good();
    huge.description = 'x'.repeat(10); // parser trims fields, so inflate through many plugin parameters instead
    huge.tracks[0].plugins = Array.from({ length: 32 }, (_, i) => ({
      pluginId: 'uuda-native-compressor', instanceId: 'i' + i, isBypassed: false, dryWet: 1,
      parameters: Object.fromEntries(Array.from({ length: 400 }, (_, k) => ['param_name_number_' + k, k])),
    }));
    const big = await upsertUserTemplate(s, 'u1', { template: huge });
    expect(big.status).toBe(413);
    expect(MAX_TEMPLATE_BYTES).toBeGreaterThan(0);

    for (let i = 0; i < MAX_TEMPLATES_PER_USER; i++) {
      expect((await upsertUserTemplate(s, 'u1', { template: { ...good(), id: 't' + i } })).status).toBe(200);
    }
    expect((await upsertUserTemplate(s, 'u1', { template: { ...good(), id: 'one-more' } })).status).toBe(409);
    // updating one that exists is still allowed at the limit
    expect((await upsertUserTemplate(s, 'u1', { template: { ...good(), id: 't0', name: 'Edited' } })).status).toBe(200);
    // another user is not affected
    expect((await upsertUserTemplate(s, 'u2', { template: { ...good(), id: 'one-more' } })).status).toBe(200);
  });

  it('deleting something that is not there says so', async () => {
    const s = memoryStore();
    expect((await removeUserTemplate(s, 'u1', 'nope')).status).toBe(404);
  });
});

describe('file-backed store (local development)', () => {
  let fileDb: typeof import('./db').db;
  beforeAll(async () => {
    process.env.UUDA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uuda-tpl-'));
    fileDb = (await import('./db')).db;
  });

  it('saves, lists, updates and deletes templates, and removes them with the account', () => {
    const t = good();
    fileDb.saveTemplate('uA', 'tpl-1', 'One', t);
    fileDb.saveTemplate('uB', 'tpl-1', 'Other user', t);
    expect(fileDb.getTemplatesForUser('uA').map((x) => x.name)).toEqual(['One']);
    fileDb.saveTemplate('uA', 'tpl-1', 'One v2', t);
    expect(fileDb.getTemplatesForUser('uA').length).toBe(1);
    expect(fileDb.getTemplatesForUser('uA')[0].name).toBe('One v2');
    expect(fileDb.deleteTemplate('uB', 'tpl-1')).toBe(true);
    expect(fileDb.deleteTemplate('uB', 'tpl-1')).toBe(false);
    fileDb.deleteUserPermanently('uA');
    expect(fileDb.getTemplatesForUser('uA').length).toBe(0);
  });
});
