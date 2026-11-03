// Validate finding records against library/finding.schema.json.
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {LIB} from './paths.mjs';

let check;
function validator() {
  if (!check) {
    const ajv = new Ajv2020({allErrors: true, strict: false});
    addFormats(ajv);
    check = ajv.compile(JSON.parse(fs.readFileSync(path.join(LIB, 'finding.schema.json'), 'utf8')));
  }
  return check;
}

export function validateFindings(rows) {
  const v = validator();
  return rows.map((r) => ({finding_id: r.finding_id,
    errors: v(r) ? [] : v.errors.map((e) => `${e.instancePath || '/'} ${e.message}`)}));
}
