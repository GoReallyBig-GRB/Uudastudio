/**
 * Uuda Studio - template sync routes: GET /api/templates, POST /api/templates, DELETE /api/templates/:id.
 * Thin wrappers: sign-in and rate limits here, all rules in templateService.ts.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from './authRoutes';
import { rateLimit } from './http';
import { store } from './store';
import { listUserTemplates, upsertUserTemplate, removeUserTemplate } from './templateService';

export const templateRouter = Router();

const perUser = (req: Request) => String((req as any).user?.id || req.ip || 'unknown');

templateRouter.get(
  '/api/templates',
  requireAuth,
  rateLimit({ name: 'templates-list', windowMs: 60 * 1000, max: 60, key: perUser }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const out = await listUserTemplates(store, (req as any).user.id);
      res.status(out.status).json(out.body);
    } catch (err) {
      console.error('[templates] list failed:', err);
      res.status(500).json({ error: 'Could not load your templates.' });
    }
  },
);

templateRouter.post(
  '/api/templates',
  requireAuth,
  rateLimit({ name: 'templates-save', windowMs: 60 * 1000, max: 30, key: perUser }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const out = await upsertUserTemplate(store, (req as any).user.id, req.body);
      res.status(out.status).json(out.body);
    } catch (err) {
      console.error('[templates] save failed:', err);
      res.status(500).json({ error: 'Could not save the template.' });
    }
  },
);

templateRouter.delete(
  '/api/templates/:id',
  requireAuth,
  rateLimit({ name: 'templates-delete', windowMs: 60 * 1000, max: 30, key: perUser }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const out = await removeUserTemplate(store, (req as any).user.id, String(req.params.id));
      res.status(out.status).json(out.body);
    } catch (err) {
      console.error('[templates] delete failed:', err);
      res.status(500).json({ error: 'Could not delete the template.' });
    }
  },
);
