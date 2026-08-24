#!/usr/bin/env node
/**
 * A lightweight broken-link check for the documentation.
 *
 * The instruction files (`CLAUDE.md` and the per-app ones) are deliberately small: the
 * detail they used to carry lives in `docs/` and is reached by a plain path. That only
 * works while the paths resolve, and a moved or renamed document breaks them silently -
 * nothing else in this repository reads a markdown link.
 *
 * It checks two things, and only those two, so it stays fast and quiet:
 *   1. every markdown link `[text](target)` that points at a file in this repository;
 *   2. every backticked path ending in `.md` that contains a `/`, which is how these
 *      files cite each other. A bare `plan.md` is a filename, not a pointer, so it is left
 *      alone - the repository names `prd.md`/`plan.md` generically in several places.
 *
 * Anchors, URLs, node_modules and anything carrying a glob or a placeholder are skipped,
 * as are the few paths in KNOWN_GONE, which documents cite as history rather than as a
 * pointer to something a reader should open.
 *
 * Usage: node scripts/check-docs-links.mjs   (also `pnpm check:links`)
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  'generated',
  'skills', // vendored skill bundles, not this repository's documentation
]);

/**
 * Paths a document names as something that used to exist. Deliberately tiny: an entry
 * here is a claim that the reference is historical, not that the check is inconvenient.
 */
const KNOWN_GONE = new Set([
  // research.md, recording where the original investigation lived before it was split up.
  'docs/ralph-loop-issue-cost.md',
]);

function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...markdownFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith('.md')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** A target worth checking: a repository path, not a URL, an anchor or a placeholder. */
function isCheckable(target) {
  if (!target) return false;
  if (/^(https?:|mailto:|#|<)/.test(target)) return false;
  if (/[*<>{}|…]/.test(target)) return false;
  if (target.startsWith('node_modules/') || target.includes('/node_modules/')) return false;
  if (KNOWN_GONE.has(target)) return false;
  return true;
}

function resolves(fromFile, target) {
  const clean = target.split('#')[0].split('?')[0];
  if (!clean) return true; // a bare anchor
  const candidates = [resolve(dirname(fromFile), clean), resolve(ROOT, clean)];
  return candidates.some((c) => existsSync(c) && statSync(c).isFile());
}

const problems = [];
for (const file of markdownFiles(ROOT)) {
  const text = readFileSync(file, 'utf8');
  const targets = new Set();

  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) targets.add(m[1]);
  for (const m of text.matchAll(/`([^`\n]+\.md)`/g)) {
    if (m[1].includes('/')) targets.add(m[1]);
  }

  for (const target of targets) {
    if (!isCheckable(target)) continue;
    if (!resolves(file, target)) {
      problems.push(`${posix.join(...relative(ROOT, file).split('\\'))} -> ${target}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`x ${problems.length} broken documentation link(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('. every documentation link resolves');
