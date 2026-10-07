import { z } from 'zod'

// Zod's JIT fast path uses `new Function`, which the site's Content-Security-Policy
// (no 'unsafe-eval') rightly blocks. Forms are tiny, so the plain path is plenty fast.
//
// Zod decides this when a schema is *constructed*, so this module must be the first
// import of the app entry: ES modules evaluate in import order, so every schema is
// created after this has run.
z.config({ jitless: true })
