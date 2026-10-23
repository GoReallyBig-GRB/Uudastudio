import { describe, expect, it } from 'vitest';
import { resolveVerifiedThirdPartyPlugin, VERIFIED_THIRD_PARTY_PLUGINS } from './registry';
import type { PluginDescriptor } from './types';

describe('third-party plugin trust boundary', () => {
  it('resolves only catalogue-listed third-party plugin IDs', () => {
    const unknown = { id: 'untrusted-plugin', type: 'third-party-wam' } as PluginDescriptor;
    expect(resolveVerifiedThirdPartyPlugin(unknown)).toBeUndefined();
  });

  it('uses the canonical module URL instead of a URL from project state', () => {
    const canonical = VERIFIED_THIRD_PARTY_PLUGINS[0];
    const forged = { ...canonical, moduleUrl: 'https://attacker.example/payload.js' };
    const resolved = resolveVerifiedThirdPartyPlugin(forged);
    expect(resolved).toBe(canonical);
    expect(resolved?.moduleUrl).toBe(canonical.moduleUrl);
  });

  it('does not resolve native descriptors through the third-party catalogue', () => {
    const native = { id: 'uuda-compressor', type: 'native' } as PluginDescriptor;
    expect(resolveVerifiedThirdPartyPlugin(native)).toBeUndefined();
  });
});
