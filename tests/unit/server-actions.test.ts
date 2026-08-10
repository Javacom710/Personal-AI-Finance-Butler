import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A `'use server'` module may export **only** async functions: every export
 * becomes a callable server endpoint, so a constant among them is a
 * contradiction Next refuses at request time.
 *
 * This is a guard against a bug class that already bit once. `app/(auth)/login/
 * actions.ts` exported an `EMPTY_STATE` object alongside its actions; `tsc`
 * accepted it, `next build` accepted it, and the login page returned a 500 on
 * the first POST. Nothing before this test looked at the rule.
 */

const APP_DIR = path.resolve('app');

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

/** True when the file's first statement is the `'use server'` directive. */
function isServerActionModule(source: string): boolean {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .trimStart();
  return /^(['"])use server\1\s*;?/.test(withoutComments);
}

describe("'use server' modules", () => {
  it('export only functions', async () => {
    const offenders: string[] = [];
    let checked = 0;

    for await (const file of walk(APP_DIR)) {
      const source = await fs.readFile(file, 'utf8');
      if (!isServerActionModule(source)) continue;

      checked += 1;
      const relative = path.relative(process.cwd(), file);
      const exports: Record<string, unknown> = await import(/* @vite-ignore */ file);

      for (const [name, value] of Object.entries(exports)) {
        if (typeof value !== 'function') {
          offenders.push(`${relative} exports "${name}" as ${typeof value}, not a function`);
        }
      }
    }

    // If this drops to zero the test has stopped testing anything — the login
    // actions, the sign-out action and the money actions are all 'use server'
    // modules.
    expect(checked, "no 'use server' modules were found to check").toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
    // Importing each module pulls in whatever it depends on. The money actions
    // reach the whole service layer and Drizzle, so this is seconds of transform
    // work rather than milliseconds — hence the generous timeout below.
  }, 60_000);
});
