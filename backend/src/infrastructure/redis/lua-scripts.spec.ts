import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LUA_SCRIPTS,
  LUA_SCRIPT_FILES,
  type LuaScriptName,
} from './lua-scripts';

const SCRIPTS_DIRECTORY = resolve(__dirname, '../../../../scripts/redis');

/**
 * The application runs the embedded copies; CI's "Redis Lua scripts" job runs
 * the files. This is what stops those two from becoming two different
 * programs — a divergence would mean the behaviour proven in CI is not the
 * behaviour serving `/auth/sessions`.
 */
describe('embedded Lua sources', () => {
  const names = Object.keys(LUA_SCRIPTS) as LuaScriptName[];

  it('covers all four scripts', () => {
    expect(names).toHaveLength(4);
  });

  it.each(names)('%s matches its file in scripts/redis', (name) => {
    const onDisk = readFileSync(
      resolve(SCRIPTS_DIRECTORY, LUA_SCRIPT_FILES[name]),
      'utf8',
    );

    // Line endings are normalised because git rewrites them on checkout, and a
    // CRLF working copy would fail a comparison that is really about content.
    expect(normalize(LUA_SCRIPTS[name])).toBe(normalize(onDisk));
  });

  it.each(names)('%s builds no key of its own', (name) => {
    // ADR-0011: keys arrive only through KEYS, or Cluster slot routing breaks.
    expect(LUA_SCRIPTS[name]).not.toMatch(/^\s*local\s+\w*key\w*\s*=\s*['"]/im);
  });

  it.each(names)('%s calls no non-deterministic command', (name) => {
    // Replication and AOF replay both require the script to be a pure function
    // of its keys and arguments; TIME or RANDOMKEY would make a replica
    // diverge from its primary.
    expect(LUA_SCRIPTS[name]).not.toMatch(
      /redis\.call\(\s*['"](TIME|RANDOMKEY|SRANDMEMBER|SPOP)['"]/i,
    );
  });
});

function normalize(source: string): string {
  return source.replaceAll('\r\n', '\n');
}
