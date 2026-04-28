import { createTool } from '@mastra/core/tools';

import { getX402StationClient } from './client.js';
import type { X402StationClient, X402StationClientOptions } from './client.js';
import { WhatsNewInputSchema, WhatsNewOutputSchema } from './schemas.js';
import type { WhatsNewResponse } from './types.js';

/**
 * Catalog diff polling tool. Returns `added_endpoints[]`
 * (`first_seen_at >= since` AND `is_active=true`),
 * `removed_endpoints[]` (flipped to `is_active=false` since),
 * service-level counts, polls_in_window, and current active totals.
 *
 * **Cost: $0.001 USDC.** Designed for aggregator agents that need a
 * fresh catalog delta without re-pulling the whole ~30k-endpoint dump.
 * Hourly polling costs ~$0.024/day. Internal ingest cron runs every
 * 5 min, so polling more often than that returns identical data.
 *
 * Default window = now-24h; cap is 30 days back. `limit` caps each
 * list (1..500, default 200).
 */
export function createX402StationWhatsNewTool(config: X402StationClientOptions = {}) {
  let client: X402StationClient | null = null;
  function getClient(): X402StationClient {
    if (!client) client = getX402StationClient(config);
    return client;
  }

  return createTool({
    id: 'x402station-whats-new',
    description:
      'Catalog diff polling. Body { since?, limit? } (default since=now-24h, limit=200, max 500). ' +
      'Returns added_endpoints[] (first_seen_at >= since AND is_active=true), removed_endpoints[] ' +
      '(flipped to is_active=false since), service-level counts, polls_in_window, and current ' +
      'active totals. Costs $0.001 USDC. Designed for aggregator agents to poll hourly without ' +
      'breaking the bank — internal ingest cron runs every 5 min, so polling more often returns ' +
      'identical data.',
    inputSchema: WhatsNewInputSchema,
    outputSchema: WhatsNewOutputSchema,
    execute: async ({ since, limit }) => {
      const c = getClient();
      const body: Record<string, unknown> = {};
      if (since !== undefined) body.since = since;
      if (limit !== undefined) body.limit = limit;
      const out = await c.callPaid<WhatsNewResponse>('/api/v1/whats-new', body);
      return out;
    },
  });
}
