import { createTool } from '@mastra/core/tools';

import { getX402StationClient } from './client.js';
import type { X402StationClient, X402StationClientOptions } from './client.js';
import { AlternativesInputSchema, AlternativesOutputSchema } from './schemas.js';
import type { AlternativesResponse } from './types.js';

/**
 * Routing-fallback tool. Given a URL flagged by preflight (or a
 * `taskClass` hint), returns up to 5 healthy sibling endpoints in the
 * same provider / domain / category / price-band. Filters out 7-day-
 * dead and 1-hour-erroring candidates; ranks by uptime_7d_pct DESC,
 * then avg_latency_1h_ms ASC.
 *
 * **Cost: $0.005 USDC.** Use this immediately after preflight returns
 * `ok=false` — it answers "where do I go instead?". At least one of
 * `url` or `taskClass` is required (route returns 400 if both empty).
 */
export function createX402StationAlternativesTool(config: X402StationClientOptions = {}) {
  let client: X402StationClient | null = null;
  function getClient(): X402StationClient {
    if (!client) client = getX402StationClient(config);
    return client;
  }

  return createTool({
    id: 'x402station-alternatives',
    description:
      'Routing fallback. Given a URL flagged by preflight (or a taskClass hint), returns up to 5 ' +
      'healthy sibling endpoints in the same provider/domain/category/price-band. Filters out 7-day-dead ' +
      'and 1-hour-erroring candidates; ranks by uptime + latency. Costs $0.005 USDC. Use this ' +
      "immediately after preflight returns ok=false — it answers 'where do I go instead?'. Pass {url} " +
      "when you have a specific URL the agent was about to pay; pass {taskClass} (e.g. 'llm-completions') " +
      'when discovering by service category; or both for a richer match.',
    inputSchema: AlternativesInputSchema,
    outputSchema: AlternativesOutputSchema,
    execute: async ({ url, taskClass, limit }) => {
      const c = getClient();
      const body: Record<string, unknown> = {};
      if (url !== undefined) body.url = url;
      if (taskClass !== undefined) body.taskClass = taskClass;
      if (limit !== undefined) body.limit = limit;
      const out = await c.callPaid<AlternativesResponse>('/api/v1/alternatives', body);
      return out;
    },
  });
}
