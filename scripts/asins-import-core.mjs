/**
 * Incremental ASIN import — pure helpers (re-export)
 * ═════════════════════════════════════════════════
 *
 * The implementation moved to `src/utils/asinsImportCore.js` so the browser
 * import in /#/admin/products can use the exact same rules. This file stays
 * where it is because `import-asins.mjs`, `batch-upsert.mjs` and
 * `test-asins-import.mjs` import this path — a shim keeps all three honest
 * about there being exactly one implementation.
 *
 *   import { mergeSpecs } from './asins-import-core.mjs'   // still works
 */

export * from '../src/utils/asinsImportCore.js'
