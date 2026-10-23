import { describe, expect, it } from 'vitest';
import { resolveVerifiedThirdPartyPlugin, VERIFIED_THIRD_PARTY_PLUGINS } from './registry';
import type { PluginDescriptor } from './types';
describe('third-party plugin trust boundary', () => {
 it('rejects unknown plugin IDs', () => { expect(resolveVerifiedThirdPartyPlugin({id:'untrusted-plugin',type:'third-party-wam'} as PluginDescriptor)).toBeUndefined(); });
 it('uses the canonical URL rather than project state URL', () => { const canonical=VERIFIED_THIRD_PARTY_PLUGINS[0]; const resolved=resolveVerifiedThirdPartyPlugin({...canonical,moduleUrl:'https://attacker.example/payload.js'}); expect(resolved).toBe(canonical); expect(resolved?.moduleUrl).toBe(canonical.moduleUrl); });
 it('rejects native descriptors', () => { expect(resolveVerifiedThirdPartyPlugin({id:'uuda-compressor',type:'native'} as PluginDescriptor)).toBeUndefined(); });
});
