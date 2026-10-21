/**
 * X-PRO AUDIO - Express Server Entry Point
 * Implements server-side proxy routes for Gemini TTS and Freesound CC0 Library.
 * Handles Vite middleware mounting in development mode and static serving in production.
 */

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { db } from './db';
import { authRouter, getAuthenticatedUser, checkBurstLimit } from './authRoutes';
import { audioJobsRouter } from './audioJobs';
import { rateLimit, requireSameOrigin } from './http';
import {
  generateStrictTTS,
  sanitizeScriptText,
  AUDITION_SAMPLE_SENTENCE,
  ensureWavHeader,
  analyzeEnds,
} from './voiceService';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The built web app lives in <project>/dist, one level above both server/ and dist-server/
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Behind Firebase Hosting and Cloud Run the real client address arrives in X-Forwarded-For
app.set('trust proxy', true);
app.disable('x-powered-by');

// Security headers. The Content-Security-Policy is applied in production only: in development Vite injects inline
// scripts for hot reload. The script and connect lists below are the exact hosts the app uses today.
const isProduction = process.env.NODE_ENV === 'production';
app.use(
  helmet({
    contentSecurityPolicy: isProduction
      ? {
          // Set CSP_ENFORCE=true once sign-in, audio and plugins are confirmed to work under it.
          // Until then the policy only reports violations in the browser console.
          reportOnly: process.env.CSP_ENFORCE !== 'true',
          useDefaults: false,
          directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'", 'https://apis.google.com', 'https://www.gstatic.com'],
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
            'img-src': ["'self'", 'data:', 'blob:', 'https:'],
            'media-src': ["'self'", 'blob:', 'data:', 'https://cdn.freesound.org'],
            'connect-src': [
              "'self'",
              'https://*.googleapis.com',
              'https://*.firebaseio.com',
              'https://identitytoolkit.googleapis.com',
              'https://securetoken.googleapis.com',
            ],
            'frame-src': ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com'],
            'worker-src': ["'self'", 'blob:'],
            'object-src': ["'none'"],
            'base-uri': ["'self'"],
            'frame-ancestors': ["'self'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false, // Firebase sign-in popup needs this off
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  next();
});

// Saved project documents can be large; everything else is small JSON
app.use('/api/projects', express.json({ limit: '15mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(requireSameOrigin);

// Mount Auth, User Dashboard, Support & Admin Routes
app.use(authRouter);

// Heavy audio jobs (FFmpeg denoise and MP3 export) are off unless ENABLE_AUDIO_JOBS=true: the app does these in the
// browser, and the Cloud Run image does not ship FFmpeg. When enabled, a signed-in user is required.
if (process.env.ENABLE_AUDIO_JOBS === 'true') {
  app.use(['/api/audio', '/api/export'], requireSignedIn);
  app.use(audioJobsRouter);
}

// ---------------------------------------------------------------------------
// 1. Google Gemini Prebuilt Voices Reference Catalog
// ---------------------------------------------------------------------------
const GEMINI_VOICES = [
  // Female voices
  { name: 'Zephyr', gender: 'Female', descriptor: 'Bright, upbeat & clear' },
  { name: 'Kore', gender: 'Female', descriptor: 'Calm, balanced & articulate' },
  { name: 'Aoede', gender: 'Female', descriptor: 'Expressive & melodic' },
  { name: 'Leda', gender: 'Female', descriptor: 'Soft & intimate storytelling' },
  { name: 'Callirrhoe', gender: 'Female', descriptor: 'Warm & welcoming' },
  { name: 'Autonoe', gender: 'Female', descriptor: 'Energetic & spirited' },
  { name: 'Despina', gender: 'Female', descriptor: 'Crisp & professional' },
  { name: 'Erinome', gender: 'Female', descriptor: 'Gentle & reassuring' },
  { name: 'Laomedeia', gender: 'Female', descriptor: 'Smooth & conversational' },
  { name: 'Achernar', gender: 'Female', descriptor: 'Direct & authoritative' },
  { name: 'Gacrux', gender: 'Female', descriptor: 'Deep & grounded' },
  { name: 'Vindemiatrix', gender: 'Female', descriptor: 'Polished & broadcast-ready' },
  { name: 'Sulafat', gender: 'Female', descriptor: 'Airy & friendly' },

  // Male voices
  { name: 'Puck', gender: 'Male', descriptor: 'Playful, engaging & dynamic' },
  { name: 'Fenrir', gender: 'Male', descriptor: 'Authoritative & resonant' },
  { name: 'Charon', gender: 'Male', descriptor: 'Informative & professional broadcaster' },
  { name: 'Orus', gender: 'Male', descriptor: 'Deep & resonant' },
  { name: 'Enceladus', gender: 'Male', descriptor: 'Warm, relatable & conversational' },
  { name: 'Iapetus', gender: 'Male', descriptor: 'Classic radio announcer' },
  { name: 'Umbriel', gender: 'Male', descriptor: 'Grave & dramatic' },
  { name: 'Algieba', gender: 'Male', descriptor: 'Bright & charismatic' },
  { name: 'Algenib', gender: 'Male', descriptor: 'Bold & persuasive' },
  { name: 'Rasalgethi', gender: 'Male', descriptor: 'Documentary & narrator style' },
  { name: 'Alnilam', gender: 'Male', descriptor: 'Smooth & measured' },
  { name: 'Schedar', gender: 'Male', descriptor: 'Commanding & cinematic' },
  { name: 'Pulcherrima', gender: 'Male', descriptor: 'Rich & warm baritone' },
  { name: 'Achird', gender: 'Male', descriptor: 'Casual & friendly' },
  { name: 'Zubenelgenubi', gender: 'Male', descriptor: 'Steady & informative' },
  { name: 'Sadachbia', gender: 'Male', descriptor: 'Clear & articulate' },
  { name: 'Sadaltager', gender: 'Male', descriptor: 'Measured & reflective' },
];

// Helper: Split long scripts into sentence chunks for reliable speech generation
function splitScriptIntoChunks(text: string, maxWordsPerChunk = 55): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Match sentences
  const sentenceRegex = /[^.!?\n]+[.!?\n]*/g;
  const rawSentences = trimmed.match(sentenceRegex) || [trimmed];

  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of rawSentences) {
    const s = sentence.trim();
    if (!s) continue;
    const wordCount = s.split(/\s+/).length;
    const currentCount = currentChunk ? currentChunk.split(/\s+/).length : 0;

    if (currentCount + wordCount > maxWordsPerChunk && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = s;
    } else {
      currentChunk = currentChunk ? `${currentChunk} ${s}` : s;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [trimmed];
}

// Helper: Concatenate multiple 24kHz 16-bit mono WAV buffers with an optional silence gap
function concatenateWavBuffers(buffers: Buffer[], silenceGapMs = 120): Buffer {
  if (buffers.length === 0) return Buffer.alloc(0);
  if (buffers.length === 1) return ensureWavHeader(buffers[0]);

  // Every buffer here already went through ensureWavHeader, so it is a canonical 44-byte-header PCM WAV
  const sampleRate = buffers[0].readUInt32LE(24) || 24000;
  const numChannels = buffers[0].readUInt16LE(22) || 1;
  const bitsPerSample = 16;
  const pcmChunks: Buffer[] = [];

  for (let i = 0; i < buffers.length; i++) {
    pcmChunks.push(buffers[i].subarray(44));

    // Short silence between chunks (not after the last one)
    if (i < buffers.length - 1 && silenceGapMs > 0) {
      const frameBytes = numChannels * (bitsPerSample / 8);
      const frames = Math.round((sampleRate * silenceGapMs) / 1000);
      pcmChunks.push(Buffer.alloc(frames * frameBytes, 0));
    }
  }

  return ensureWavHeader(Buffer.concat(pcmChunks), sampleRate, numChannels, bitsPerSample);
}

// ---------------------------------------------------------------------------
// 2. API Routes
// ---------------------------------------------------------------------------

function requireSignedIn(req: Request, res: Response, next: NextFunction): void {
  const { user } = getAuthenticatedUser(req);
  if (!user || user.blocked) {
    res.status(401).json({ error: 'Sign in required.' });
    return;
  }
  next();
}

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  // Liveness only. Which keys are configured is not public information.
  res.json({ status: 'ok', timestamp: Date.now() });
});

// In-memory cache for voice preview auditions
const voicePreviewCache = new Map<string, string>();

// List verified Gemini voices
app.get('/api/voice/voices', (_req: Request, res: Response) => {
  res.json({
    voices: GEMINI_VOICES,
    models: [
      { id: 'gemini-3.8-flash-tts', name: 'Quality (gemini-3.8-flash-tts)', tier: 'Flagship' },
      { id: 'gemini-3.8-flash-lite-tts', name: 'Fast (gemini-3.8-flash-lite-tts)', tier: 'Low latency' },
    ],
  });
});

// Audition / Preview Voice Talent (Validation against GEMINI_VOICES, no fake tones, real errors)
app.get('/api/voice/preview', rateLimit({ name: 'preview', windowMs: 60 * 1000, max: 20 }), async (req: Request, res: Response): Promise<void> => {
  const voiceName = (req.query.voice as string) || '';
  const match = GEMINI_VOICES.find((v) => v.name.toLowerCase() === voiceName.trim().toLowerCase());
  if (!match) {
    res.status(400).json({
      error: `Unknown voice "${voiceName}". Valid voices: ${GEMINI_VOICES.map((v) => v.name).join(', ')}`,
    });
    return;
  }
  const verifiedVoiceName = match.name;

  const customKey = req.headers['x-gemini-api-key'] as string | undefined;
  const usedOwnKey = Boolean(customKey && customKey.trim().length > 10);
  const effectiveApiKey = usedOwnKey ? customKey!.trim() : process.env.GEMINI_API_KEY;

  if (!effectiveApiKey) {
    res.status(503).json({
      error: 'GEMINI_API_KEY is not configured on the server. Please add your own Gemini API key in User Dashboard.',
    });
    return;
  }

  // Check cache only if server key was used
  if (!usedOwnKey && voicePreviewCache.has(verifiedVoiceName)) {
    res.json({ voiceName: verifiedVoiceName, audioBase64: voicePreviewCache.get(verifiedVoiceName) });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
    const auditionResult = await generateStrictTTS({
      ai,
      script: AUDITION_SAMPLE_SENTENCE,
      voiceName: verifiedVoiceName,
      modelId: 'gemini-3.8-flash-lite-tts',
      isAudition: true,
    });

    const audioBase64 = auditionResult.audioBuffer.toString('base64');
    if (!usedOwnKey) {
      voicePreviewCache.set(verifiedVoiceName, audioBase64);
    }
    res.json({ voiceName: verifiedVoiceName, audioBase64 });
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.error(`Audition failed for ${verifiedVoiceName}:`, err);
    res.status(502).json({ error: `Audition failed: ${errorMsg}` });
  }
});

// Diagnose Gemini TTS Models (signed-in users only)
app.get('/api/voice/diagnose', async (req: Request, res: Response): Promise<void> => {
  const { user } = getAuthenticatedUser(req);
  if (!user || user.blocked) {
    res.status(401).json({ error: 'Sign in is required to run voice diagnostics.' });
    return;
  }

  const customKey = req.headers['x-gemini-api-key'] as string | undefined;
  const usedOwnKey = Boolean(customKey && customKey.trim().length > 10);
  const effectiveApiKey = usedOwnKey ? customKey!.trim() : process.env.GEMINI_API_KEY;

  const keySource: 'own' | 'server' | 'none' = usedOwnKey ? 'own' : (process.env.GEMINI_API_KEY ? 'server' : 'none');

  if (!effectiveApiKey) {
    res.json({
      keySource,
      models: {
        'gemini-3.8-flash-tts': { ok: false, ms: 0, error: 'No API key configured.' },
        'gemini-3.8-flash-lite-tts': { ok: false, ms: 0, error: 'No API key configured.' },
      },
    });
    return;
  }

  const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
  const testScript = 'Testing one, two, three.';
  const testVoice = 'Kore';
  const modelsToTest = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'] as const;
  const modelsResult: Record<string, any> = {};

  for (const modelId of modelsToTest) {
    const t0 = Date.now();
    try {
      const result = await generateStrictTTS({
        ai,
        script: testScript,
        voiceName: testVoice,
        modelId,
        isAudition: true,
      });
      const ms = Date.now() - t0;
      modelsResult[modelId] = {
        ok: true,
        ms,
        seconds: Number(result.durationSeconds.toFixed(2)),
        bytes: result.audioBuffer.length,
        // A tail much louder than the body, or a long tail, points at noise added after the speech
        ends: analyzeEnds(result.audioBuffer),
      };
    } catch (err: any) {
      const ms = Date.now() - t0;
      modelsResult[modelId] = {
        ok: false,
        ms,
        error: err?.message || String(err),
      };
    }
  }

  res.json({
    keySource,
    models: modelsResult,
  });
});

// Generate Voiceover (Requires Google Sign-In & logs generation)
// Strict text-only pipeline: no instructions, no formatting prose, ASR verification layer
app.post('/api/voice/generate', async (req: Request, res: Response): Promise<void> => {
  // 1. Auth check: a signed-in user is required. There is no fallback account.
  const { user } = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({
      error: 'Sign in with Google is required to generate voiceovers.',
    });
    return;
  }

  // 2. Blocked account check
  if (user.blocked) {
    res.status(403).json({
      error: 'This account has been blocked. Contact support.',
      blocked: true,
    });
    return;
  }

  // 3. Anti-abuse per-user burst limit (default 10 requests per minute)
  const burstCheck = checkBurstLimit(user.id, 10);
  if (!burstCheck.allowed) {
    res.status(429).json({
      error: `Rate limit: Maximum 10 requests per minute to prevent server overload. Please wait ${burstCheck.retryAfterSec || 30} seconds and retry.`,
      rateLimited: true,
      burstLimit: true,
      retryAfterSec: burstCheck.retryAfterSec,
    });
    return;
  }

  const { script, voiceName, modelId, instruction } = req.body;

  if (!script || typeof script !== 'string' || !script.trim()) {
    res.status(400).json({ error: 'Script text is required.' });
    return;
  }

  // 4. Check for user-provided own Gemini API Key (never logged or saved on server)
  const customKey = req.headers['x-gemini-api-key'] as string | undefined;
  const usedOwnKey = Boolean(customKey && customKey.trim().length > 10);
  const effectiveApiKey = usedOwnKey ? customKey!.trim() : process.env.GEMINI_API_KEY;

  if (!effectiveApiKey) {
    res.status(500).json({
      error: 'GEMINI_API_KEY is not configured on the server. Please configure your own Gemini API key in User Dashboard.',
    });
    return;
  }

  const selectedModel = modelId === 'gemini-3.8-flash-lite-tts' ? 'gemini-3.8-flash-lite-tts' : 'gemini-3.8-flash-tts';
  const selectedVoice = voiceName || 'Zephyr';

  try {
    const ai = new GoogleGenAI({ apiKey: effectiveApiKey });

    // Break long scripts into sentence chunks to preserve prosody and respect model limits
    const scriptChunks = splitScriptIntoChunks(script);
    const wavBuffers: Buffer[] = new Array(scriptChunks.length);
    const startedAt = Date.now();

    // Synthesize chunks three at a time, keeping their order. A 25 second voiceover is usually one or two chunks.
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= scriptChunks.length) return;
        const chunkResult = await generateStrictTTS({
          ai,
          script: scriptChunks[index],
          voiceName: selectedVoice,
          modelId: selectedModel,
          instruction: typeof instruction === 'string' ? instruction.trim() : undefined,
          maxRetries: 2,
        });
        wavBuffers[index] = chunkResult.audioBuffer;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, scriptChunks.length) }, worker));
    console.info(
      `[TTS] ${scriptChunks.length} chunk(s), ${script.length} chars, model ${selectedModel}, voice ${selectedVoice}: ${Date.now() - startedAt} ms`
    );

    const combinedWav = concatenateWavBuffers(wavBuffers);
    const finalBase64 = combinedWav.toString('base64');

    // Estimate duration: (bytes - 44) / (24000 * 2) for 24kHz 16-bit mono
    const pcmBytes = Math.max(0, combinedWav.length - 44);
    const durationEstimate = pcmBytes / (24000 * 2);

    // Log successful generation
    db.logGeneration({
      user_id: user.id,
      user_email: user.email,
      kind: 'voice',
      model: selectedModel,
      characters: script.length,
      status: 'succeeded',
      error_code: null,
      used_own_key: usedOwnKey,
    });

    res.json({
      audioBase64: finalBase64,
      mimeType: 'audio/wav',
      durationEstimate,
      chunksProcessed: scriptChunks.length,
      voice: selectedVoice,
      model: selectedModel,
    });
  } catch (err: unknown) {
    console.error('Voice generation server error:', err);
    const errMsg = err instanceof Error ? err.message : String(err);

    // Detect 429 Rate Limit / Free Quota Exhaustion
    if (errMsg.includes('429') || errMsg.toLowerCase().includes('resource has been exhausted') || errMsg.toLowerCase().includes('quota')) {
      db.logGeneration({
        user_id: user.id,
        user_email: user.email,
        kind: 'voice',
        model: selectedModel,
        characters: script.length,
        status: 'failed',
        error_code: '429_QUOTA_EXHAUSTED',
        used_own_key: usedOwnKey,
      });

      res.status(429).json({
        error: 'Google Gemini TTS quota limit reached (429). Please retry in a few moments, or configure your own Gemini API key in User Dashboard.',
        rateLimited: true,
        canRetry: true,
      });
      return;
    }

    // Detect Invalid / Missing Key
    if (errMsg.toLowerCase().includes('api_key') || errMsg.toLowerCase().includes('unauthenticated') || errMsg.toLowerCase().includes('permission denied')) {
      db.logGeneration({
        user_id: user.id,
        user_email: user.email,
        kind: 'voice',
        model: selectedModel,
        characters: script.length,
        status: 'failed',
        error_code: 'INVALID_API_KEY',
        used_own_key: usedOwnKey,
      });

      res.status(401).json({
        error: 'Invalid or unauthorized Gemini API key. Please verify your credentials.',
      });
      return;
    }

    db.logGeneration({
      user_id: user.id,
      user_email: user.email,
      kind: 'voice',
      model: selectedModel,
      characters: script.length,
      status: 'failed',
      error_code: errMsg.substring(0, 50),
      used_own_key: usedOwnKey,
    });

    res.status(500).json({
      error: errMsg,
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Freesound API CC0 Audio Library
// ---------------------------------------------------------------------------

// Freesound Configuration & Feature Flag
app.get('/api/freesound/config', (_req: Request, res: Response) => {
  // Flag can be explicitly enabled via FREESOUND_ENABLED env var, or enabled if API key is present
  const enabled = process.env.FREESOUND_ENABLED === 'true' || !!process.env.FREESOUND_API_KEY;
  res.json({
    enabled,
    hasApiKey: !!process.env.FREESOUND_API_KEY,
    clientId: process.env.FREESOUND_CLIENT_ID || null,
  });
});

// Freesound Search (Strictly filtered to CC0 Creative Commons 0)
app.get('/api/freesound/search', rateLimit({ name: 'fs-search', windowMs: 60 * 1000, max: 40 }), async (req: Request, res: Response): Promise<void> => {
  try {
    const apiKey = process.env.FREESOUND_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: 'Freesound API key is not configured on the server. Please set FREESOUND_API_KEY.',
      });
      return;
    }

    const { query = '', page = '1', pageSize = '15', sort = 'score', tag = '', minDuration, maxDuration } = req.query;

    // Build filter string: STRICT CC0 ONLY filter
    const filterParts: string[] = ['license:"Creative Commons 0"'];

    if (tag && typeof tag === 'string' && tag.trim()) {
      filterParts.push(`tag:"${encodeURIComponent(tag.trim())}"`);
    }

    if (minDuration || maxDuration) {
      const min = minDuration ? parseFloat(String(minDuration)) : 0;
      const max = maxDuration ? parseFloat(String(maxDuration)) : 300;
      filterParts.push(`duration:[${min} TO ${max}]`);
    }

    const filterString = filterParts.join(' ');
    const searchUrl = new URL('https://freesound.org/apiv2/search/text/');
    searchUrl.searchParams.set('query', String(query || '*'));
    searchUrl.searchParams.set('filter', filterString);
    searchUrl.searchParams.set('sort', String(sort || 'score'));
    searchUrl.searchParams.set('page', String(page));
    searchUrl.searchParams.set('page_size', String(pageSize));
    searchUrl.searchParams.set(
      'fields',
      'id,name,tags,description,duration,license,username,url,previews,images,filesize,type,samplerate'
    );

    const apiRes = await fetch(searchUrl.toString(), {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    });

    const rateLimitRemaining = apiRes.headers.get('X-RateLimit-Remaining');
    const rateLimitReset = apiRes.headers.get('X-RateLimit-Reset');

    if (apiRes.status === 429) {
      res.status(429).json({
        error: 'Freesound API rate limit reached (60 req/min, 2,000/day). Please wait before making another query.',
        rateLimited: true,
        resetSeconds: rateLimitReset ? parseInt(rateLimitReset, 10) : 60,
      });
      return;
    }

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      res.status(apiRes.status).json({
        error: `Freesound API error: ${errText || apiRes.statusText}`,
      });
      return;
    }

    const data = await apiRes.json();
    res.json({
      ...data,
      rateLimitRemaining: rateLimitRemaining ? parseInt(rateLimitRemaining, 10) : null,
      rateLimitReset: rateLimitReset ? parseInt(rateLimitReset, 10) : null,
    });
  } catch (err: unknown) {
    console.error('Freesound search error:', err);
    res.status(500).json({ error: 'Failed to query Freesound API.' });
  }
});

// Freesound OAuth2 authorization URL
app.get('/api/freesound/oauth/url', (_req: Request, res: Response) => {
  const clientId = process.env.FREESOUND_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: 'FREESOUND_CLIENT_ID is not configured.' });
    return;
  }

  const authUrl = `https://freesound.org/apiv2/oauth2/authorize/?client_id=${encodeURIComponent(clientId)}&response_type=code`;
  res.json({ authUrl });
});

// Freesound OAuth2 exchange authorization code for user access token
app.post('/api/freesound/oauth/token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.body;
    const clientId = process.env.FREESOUND_CLIENT_ID;
    const clientSecret = process.env.FREESOUND_CLIENT_SECRET;

    if (!code) {
      res.status(400).json({ error: 'Authorization code is required.' });
      return;
    }

    if (!clientId || !clientSecret) {
      res.status(500).json({ error: 'Freesound OAuth credentials are not fully configured on the server.' });
      return;
    }

    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', clientId);
    tokenParams.append('client_secret', clientSecret);
    tokenParams.append('grant_type', 'authorization_code');
    tokenParams.append('code', code);

    const tokenRes = await fetch('https://freesound.org/apiv2/oauth2/access_token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      res.status(tokenRes.status).json({
        error: `OAuth exchange failed: ${errText || tokenRes.statusText}`,
      });
      return;
    }

    const tokenData = await tokenRes.json();
    res.json({
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
    });
  } catch (err: unknown) {
    console.error('Freesound OAuth token exchange error:', err);
    res.status(500).json({ error: 'Failed to exchange authorization code for Freesound access token.' });
  }
});

// Freesound Download Original Sound File (Requires User's OAuth2 access token)
app.get('/api/freesound/download/:soundId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { soundId } = req.params;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'A connected Freesound user access token is required to download original sound files.',
      });
      return;
    }

    const userToken = authHeader.substring(7);
    const downloadUrl = `https://freesound.org/apiv2/sounds/${soundId}/download/`;

    const downloadRes = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });

    if (downloadRes.status === 429) {
      res.status(429).json({
        error: 'Freesound original download limit reached (30/min, 500/day). Please wait before downloading more sounds.',
        rateLimited: true,
      });
      return;
    }

    if (!downloadRes.ok) {
      res.status(downloadRes.status).json({
        error: `Failed to download original audio: ${downloadRes.statusText}`,
      });
      return;
    }

    const contentType = downloadRes.headers.get('content-type') || 'audio/wav';
    res.setHeader('Content-Type', contentType);

    const arrayBuffer = await downloadRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err: unknown) {
    console.error('Freesound download error:', err);
    res.status(500).json({ error: 'Internal error downloading original sound file.' });
  }
});

// ---------------------------------------------------------------------------
// 4. Vite Dev Server / Static Production Mounting
// ---------------------------------------------------------------------------
// Unknown API paths answer with JSON, never with the web app's HTML
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found.' });
});

// Last-resort error handler: log the detail, tell the client only what it needs
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number })?.status && (err as { status: number }).status < 500 ? (err as { status: number }).status : 500;
  if (status >= 500) console.error('Unhandled server error:', err);
  if (res.headersSent) return;
  res.status(status).json({ error: status === 413 ? 'Request is too large.' : status >= 500 ? 'Something went wrong.' : 'Bad request.' });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Mount Vite dev middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(DIST_DIR));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Uuda Studio server listening on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`);
  });

  // Cloud Run sends SIGTERM before stopping an instance: finish open requests, then exit
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down');
    server.close(() => process.exit(0));
    (setTimeout(() => process.exit(0), 8000) as unknown as { unref?: () => void }).unref?.();
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
