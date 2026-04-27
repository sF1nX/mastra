---
'@mastra/temporal': patch
---

Fixed Temporal workflow bundling for Mastra entry files by exporting configured workflows only. Inline `createStep()` calls in workflow chain methods now resolve their step ids during transformation. `MastraPlugin` also supports `debug: true` to persist transformed workflow modules and the emitted webpack bundle under `.mastra/temporal` for debugging.
