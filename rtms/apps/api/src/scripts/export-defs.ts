/** Exporte les définitions des modules (sans les champs sensibles) pour le mode démonstration. */
import { writeFileSync } from 'node:fs';
import { MODULE_DEFS } from '../modules/definitions.js';
import { DEFAULT_MATRIX, ROLES, ACTIONS, MODULES, SCREENS } from '../security/permissions.js';
const defs = Object.values(MODULE_DEFS).map((m) => ({ key: m.key, referenceField: m.referenceField, statusField: m.statusField, fields: m.fields.map(({ sensitive, ...f }) => ({ ...f, filterable: !sensitive && f.type !== 'lines' })) }));
writeFileSync(process.argv[2]!, `// Généré par apps/api/src/scripts/export-defs.ts — ne pas modifier à la main.\nexport const DEFS = ${JSON.stringify(defs)};\nexport const ROLES = ${JSON.stringify(ROLES)};\nexport const MATRIX = ${JSON.stringify(DEFAULT_MATRIX)};\nexport const ACTIONS = ${JSON.stringify(ACTIONS)};\nexport const RESOURCES = ${JSON.stringify([...MODULES, ...SCREENS])};\n`);
