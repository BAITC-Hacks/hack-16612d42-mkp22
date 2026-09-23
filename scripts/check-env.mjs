#!/usr/bin/env node
// Check only indexed environment files. This is not a general secret scanner.
import { execFileSync } from 'node:child_process';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function fail(message) {
  console.error(`Environment file check failed: ${message}`);
  process.exitCode = 1;
}

try {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const paths = new Set(git(['ls-files', '--cached', '--full-name', '-z'], root).split('\0').filter(Boolean));
  for (const path of paths) {
    const basename = path.split('/').at(-1);
    if (!/^\.env(?:$|\.)/i.test(basename)) continue;
    if (basename !== '.env.example') {
      fail(`${JSON.stringify(path)} is tracked. Remove it from the index with git rm --cached and keep credentials in a local ignored file.`);
      continue;
    }

    const contents = git(['show', `:${path}`], root).replace(/^\uFEFF/, '');
    const assignments = /^[\t ]*(?:export[\t ]+)?(['"]?)(OPENAI_API_KEY|EKT_PASSWORD|EKT_USERNAME)\1[\t ]*=[\t ]*([^\r\n]*)/gm;
    for (const match of contents.matchAll(assignments)) {
      const value = match[3].trim();
      if (!/^(?:(?:""|'')[\t ]*)?(?:#.*)?$/.test(value)) {
        fail(`${JSON.stringify(path)} has a nonempty ${match[2]}. Leave credential values blank in examples and stage the corrected file.`);
      }
    }
  }
  if (!process.exitCode) console.log('Environment file check passed.');
} catch {
  fail('Cannot inspect the Git index. Check that Git is installed and run this command inside the repository.');
}
