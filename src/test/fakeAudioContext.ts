/**
 * A stand-in for the Web Audio API for tests that run without a browser.
 * Any createXxx() returns a node whose parameters accept every scheduling call, so tests can check wiring, parameters,
 * bypass and saved state. Sound itself still has to be checked by ear in the app.
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

export function makeNode(): any {
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

export function makeContext(): any {
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
