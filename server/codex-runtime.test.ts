// @vitest-environment node
import { expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveCodexBinary } from './codex-runtime';
it('prefers executable desktop runtime, preserves overrides and falls back to PATH',()=>{
 const app=join('/Applications','ChatGPT.app','Contents/Resources/codex');
 expect(resolveCodexBinary(undefined,'darwin',p=>p===app)).toBe(app);
 expect(resolveCodexBinary('/custom/codex','darwin',()=>true)).toBe('/custom/codex');
 expect(resolveCodexBinary(undefined,'darwin',()=>false)).toBe('codex');
 expect(resolveCodexBinary(undefined,'linux',()=>true)).toBe('codex');
});

it('finds the current ChatGPT bundled layout before legacy paths and PATH',()=>{
 const root='/Applications/ChatGPT.app/Contents/Resources/';
 expect(resolveCodexBinary(undefined,'darwin',p=>p===root+'codex-cli/bin/codex'||p===root+'codex')).toBe(root+'codex-cli/bin/codex');
 expect(resolveCodexBinary(undefined,'darwin',p=>p===root+'codex-cli/CodexCLI.app/Contents/MacOS/codex')).toBe(root+'codex-cli/CodexCLI.app/Contents/MacOS/codex');
});
