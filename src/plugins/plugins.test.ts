import { describe, it, expect } from 'vitest';
import { NATIVE_STEM_PLUGINS, findPluginDescriptor } from './registry';
import { NATIVE_FACTORIES, createNativePlugin } from './nativeFactories';

/**
 * A stand-in for the Web Audio API. Any createXxx() returns a node whose parameters accept every scheduling call, so
 * these tests check the plugin code (wiring, parameters, bypass, saved state) without a browser.
 * Sound itself still has to be checked by ear in the app.
 */
function makeParam(): any {
  const p: any = () => undefined;
  p.value = 0;
  for (const m of [
    'setValueAtTime',
    'setTargetAtTime',
    'linearRampToValueAtTime',
    'exponentialRampToValueAtTime',
    'cancelScheduledValues',
    'setValueCurveAtTime',
    'cancelAndHoldAtTime',
  ]) {
    p[m] = (v?: number) => {
      if (typeof v === 'number') p.value = v;
      return p;
    };
  }
  p.connect = () => p;
  p.disconnect = () => undefined;
  return p;
}

function makeNode(): any {
  const store: Record<string | symbol, any> = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'connect') return (n: unknown) => n;
      if (['disconnect', 'start', 'stop', 'addEventListener', 'removeEventListener'].includes(String(prop))) return () => undefined;
      if (prop === 'getFrequencyResponse') return () => undefined;
      if (prop === 'then') return undefined; // not a promise
      const param = makeParam();
      target[prop] = param;
      return param;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function makeContext(): any {
  const ctx: any = {
    currentTime: 0,
    sampleRate: 48000,
    destination: makeNode(),
    state: 'running',
    audioWorklet: { addModule: async () => undefined },
    createBuffer: (channels: number, length: number) => ({
      numberOfChannels: channels,
      length,
      getChannelData: () => new Float32Array(length),
    }),
  };
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (String(prop).startsWith('create')) return () => makeNode();
      return undefined;
    },
  });
}

describe('native plugin catalogue', () => {
  it('has at least 19 native plugins, each with a unique id and a factory', () => {
    expect(NATIVE_STEM_PLUGINS.length >= 19).toBe(true);
    const ids = NATIVE_STEM_PLUGINS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(typeof NATIVE_FACTORIES[id]).toBe('function');
    for (const id of Object.keys(NATIVE_FACTORIES)) expect(findPluginDescriptor(id)?.id).toBe(id);
  });

  it('refuses an unknown native plugin instead of substituting another', async () => {
    await expect(createNativePlugin('uuda-native-nope', makeContext(), 't1')).rejects.toThrow(/Unknown native plugin/);
  });
});

describe.each(NATIVE_STEM_PLUGINS.map((d) => [d.name, d] as const))('%s', (_name, descriptor) => {
  it('creates an instance the plugin manager can drive', async () => {
    const inst = await createNativePlugin(descriptor.id, makeContext(), 'track-1');
    expect(inst.descriptor.id).toBe(descriptor.id);
    expect(inst.trackId).toBe('track-1');
    expect(!!inst.inputNode && !!inst.outputNode && !!inst.audioNode).toBe(true);
    expect(typeof inst.setState).toBe('function');
  });

  it('accepts every parameter at its minimum and maximum, and keeps finite values', async () => {
    const inst = await createNativePlugin(descriptor.id, makeContext(), 't');
    for (const [key, def] of Object.entries(descriptor.parameters)) {
      for (const v of [def.min, def.max, def.defaultValue]) {
        inst.setParameter(key, v);
        expect(Number.isFinite(inst.getParameter(key))).toBe(true);
      }
    }
  });

  it('bypass and dry/wet go through the instance fields the manager uses', async () => {
    const inst = await createNativePlugin(descriptor.id, makeContext(), 't');
    inst.isBypassed = true;
    expect(inst.isBypassed).toBe(true);
    inst.isBypassed = false;
    expect(inst.isBypassed).toBe(false);
    inst.dryWet = 0.5;
    expect(Number.isFinite(inst.dryWet)).toBe(true);
  });

  it('saves and restores its settings', async () => {
    const a = await createNativePlugin(descriptor.id, makeContext(), 't');
    for (const [key, def] of Object.entries(descriptor.parameters)) a.setParameter(key, def.max);
    const saved = await a.getState();
    const b = await createNativePlugin(descriptor.id, makeContext(), 't');
    await b.setState(saved);
    const restored = await b.getState();
    for (const [key, value] of Object.entries(saved)) {
      if (typeof value === 'number') expect(restored[key]).toBe(value);
    }
  });
});
