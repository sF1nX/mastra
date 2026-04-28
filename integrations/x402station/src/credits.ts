import { createTool } from '@mastra/core/tools';

import { getX402StationClient } from './client.js';
import type { X402StationClient, X402StationClientOptions } from './client.js';
import {
  BuyCreditsInputSchema,
  BuyCreditsOutputSchema,
  CreditsStatusInputSchema,
  CreditsStatusOutputSchema,
} from './schemas.js';
import type { BuyCreditsResponse, CreditsStatusResponse } from './types.js';

/**
 * Buy 1000 prepaid /api/v1/preflight calls.
 *
 * **Cost: $0.50 USDC.** Effective rate $0.0005/call, 50% off the per-call
 * $0.001 tier. Returns `{ creditId, balance, expiresAt, ... }`. STORE THE
 * creditId — bearer token, not retrievable later. Pass via X-Credit-Id
 * header on subsequent preflight calls; on exhaustion/expiry the
 * middleware falls through to per-call x402 automatically.
 */
export function createX402StationBuyCreditsTool(config: X402StationClientOptions = {}) {
  let client: X402StationClient | null = null;
  function getClient(): X402StationClient {
    if (!client) client = getX402StationClient(config);
    return client;
  }

  return createTool({
    id: 'x402station-buy-credits',
    description:
      'Buy 1000 prepaid /api/v1/preflight calls for $0.50 USDC. Effective rate $0.0005/call ' +
      '(50% off the per-call $0.001 tier). Returns { creditId, balance, expiresAt }. ' +
      'STORE THE creditId — bearer token, not retrievable later. Pass via X-Credit-Id header ' +
      'on subsequent /api/v1/preflight calls; on exhaustion (balance=0) or expiry (90 days) ' +
      'the middleware falls through to per-call x402 automatically. Use this once you have ' +
      'decided to do high-volume preflight work.',
    inputSchema: BuyCreditsInputSchema,
    outputSchema: BuyCreditsOutputSchema,
    execute: async () => {
      const c = getClient();
      const out = await c.callPaid<BuyCreditsResponse>('/api/v1/credits', {});
      return out;
    },
  });
}

/**
 * Read a credit's current balance + expiry. Free, id-gated.
 *
 * 404 covers both malformed UUID and unknown credit (anti-enumeration:
 * an attacker scraping random UUIDs can't tell them apart).
 */
export function createX402StationCreditsStatusTool(config: X402StationClientOptions = {}) {
  let client: X402StationClient | null = null;
  function getClient(): X402StationClient {
    if (!client) client = getX402StationClient(config);
    return client;
  }

  return createTool({
    id: 'x402station-credits-status',
    description:
      "Read a credit's current balance + expiry. Free, no payment required. UUID-only " +
      'access — anyone holding the creditId can read state, same as decrement. Returns 404 ' +
      "for unknown / malformed UUIDs (same response so an attacker scraping random UUIDs can't " +
      'tell them apart).',
    inputSchema: CreditsStatusInputSchema,
    outputSchema: CreditsStatusOutputSchema,
    execute: async ({ creditId }) => {
      const c = getClient();
      return c.callFree<CreditsStatusResponse>(`/api/v1/credits/${creditId}`, 'GET', '');
    },
  });
}
