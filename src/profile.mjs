// Profiles: product-specific settings (roles, design-system prefixes, login hosts) layered on profiles/default.json.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './paths.mjs';

export function loadProfile(ref) {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'profiles', 'default.json'), 'utf8'));
  if (!ref || ref === 'default') return base;
  const file = fs.existsSync(ref) ? ref : path.join(ROOT, 'profiles', `${ref}.json`);
  if (!fs.existsSync(file)) throw new Error(`profile not found: ${ref}`);
  const own = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {...base, ...own, viewport: {...base.viewport, ...own.viewport}, reflow_widths: {...base.reflow_widths, ...own.reflow_widths}};
}
