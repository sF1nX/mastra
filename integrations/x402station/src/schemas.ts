import { z } from 'zod';

// Pure (no DNS) host check for `webhookUrl` on watch.subscribe. Fails
// fast LOCAL when the operator passes a private/loopback/cloud-metadata
// host, before the call reaches the x402station server (which has its
// own SSRF guard at /api/v1/watch). Defense-in-depth, audit-2026-04-29
// recon-7 HIGH-8.
function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const a = Number.parseInt(m[1]!, 10);
  const b = Number.parseInt(m[2]!, 10);
  const c = Number.parseInt(m[3]!, 10);
  const d = Number.parseInt(m[4]!, 10);
  if ([a, b, c, d].some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}
function isPrivateIPv6(host: string): boolean {
  let h = host.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h === '::' || h === '::1') return true;
  if (/^fe[89ab]/.test(h)) return true;
  if (/^f[cd]/.test(h)) return true;
  if (/^ff/.test(h)) return true;
  if (h.startsWith('::ffff:')) return true;
  if (h.startsWith('::') && h.length > 2 && /^::[0-9a-f]/.test(h)) return true;
  if (h.startsWith('64:ff9b:')) return true;
  if (h.startsWith('100:')) return true;
  if (h.startsWith('2001:db8')) return true;
  if (/^3fff/.test(h)) return true;
  if (h.startsWith('2001:2:') || h.startsWith('2001:0002:')) return true;
  if (h.startsWith('5f00:')) return true;
  if (h.startsWith('2002:')) return true;
  if (h.startsWith('2001::') || /^2001:0+:/.test(h)) return true;
  return false;
}
const LOCALHOST_NAMES = new Set(['localhost', 'localhost.localdomain']);
export function validateWebhookUrl(rawUrl: string): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: 'invalid URL' }; }
  if (u.protocol !== 'https:') {
    return { ok: false, reason: 'webhookUrl must use HTTPS — HMAC-signed alert payloads must not travel in clear text' };
  }
  if (u.username !== '' || u.password !== '') {
    return { ok: false, reason: 'webhookUrl must not contain userinfo (user:pass@host) — known phishing/spoofing vector' };
  }
  const hostname = u.hostname.toLowerCase();
  if (LOCALHOST_NAMES.has(hostname)) {
    return { ok: false, reason: `webhookUrl hostname is loopback (${hostname})` };
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      return { ok: false, reason: `webhookUrl IPv4 ${hostname} is loopback / private / link-local / cloud-metadata` };
    }
  }
  if (hostname.startsWith('[')) {
    if (isPrivateIPv6(hostname)) {
      return { ok: false, reason: `webhookUrl IPv6 ${hostname} is loopback / ULA / link-local / v4-mapped / NAT64` };
    }
  }
  return { ok: true };
}

/**
 * Whitelist of signal names accepted by `watch.subscribe`. Catching a
 * typo here saves the agent the round-trip cost of finding out via 400.
 */
export const SignalSchema = z.enum([
  'unknown_endpoint',
  'no_history',
  'dead',
  'zombie',
  'decoy_price_extreme',
  'suspicious_high_price',
  'slow',
  'new_provider',
  'dead_7d',
  'mostly_dead',
  'slow_p99',
  'price_outlier_high',
  'high_concentration',
]);

export const PreflightInputSchema = z.object({
  url: z.string().url().describe('The full URL of the x402 endpoint the agent is about to pay.'),
});

export const ForensicsInputSchema = z.object({
  url: z.string().url().describe('The full URL of the x402 endpoint to analyse.'),
});

export const CatalogDecoysInputSchema = z.object({});

export const WatchSubscribeInputSchema = z.object({
  url: z.string().url().describe('The x402 endpoint URL to watch.'),
  webhookUrl: z
    .string()
    .url()
    .superRefine((u, ctx) => {
      const r = validateWebhookUrl(u);
      if (!r.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.reason });
      }
    })
    .describe(
      'Where x402station should POST alert payloads. Must be HTTPS, reachable from the public internet, and contain no userinfo. Loopback / private / link-local / cloud-metadata / IPv6 ULA / NAT64 / 6to4 hosts are rejected client-side.',
    ),
  signals: z
    .array(SignalSchema)
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Signal names to alert on. Defaults server-side to ['dead', 'zombie', 'decoy_price_extreme'].",
    ),
});

export const WatchSecretInputSchema = z.object({
  watchId: z.string().uuid().describe('The watchId UUID returned by watch_subscribe.'),
  secret: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]{64}$/i, 'secret must be 64 hex chars')
    .describe('The 64-char hex secret returned by watch_subscribe.'),
});

// Bulk-preflight credits. v1 has no parameters — fixed $0.50 / 1000 calls.
export const BuyCreditsInputSchema = z
  .object({})
  .describe('Buy 1000 prepaid /api/v1/preflight calls for $0.50 USDC. No parameters in v1.');

// Read a credit's balance + expiry. UUID-only access; the id is the bearer
// token returned by the buy_credits tool.
export const CreditsStatusInputSchema = z.object({
  creditId: z
    .string()
    .uuid()
    .describe('The creditId UUID returned by buy_credits.'),
});

// Catalog diff polling. `since` is an ISO 8601 timestamp (default = now() -
// 24h, cap 30 days back). `limit` caps each of added_endpoints[] and
// removed_endpoints[] (1..500, default 200).
export const WhatsNewInputSchema = z.object({
  since: z
    .string()
    .datetime()
    .optional()
    .describe(
      'ISO 8601 timestamp. Default = now() - 24h. Cannot be older than 30 days or in the future.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe(
      'Per-list cap (1..500, default 200). Applied independently to added_endpoints and removed_endpoints.',
    ),
});

// Routing-fallback. At least one of `url` or `taskClass` required.
export const AlternativesInputSchema = z.object({
  url: z
    .string()
    .url()
    .optional()
    .describe(
      'URL flagged by preflight (or otherwise rejected). Looked up in the catalog to extract provider/domain/category/price band as match keys.',
    ),
  taskClass: z
    .string()
    .max(80)
    .optional()
    .describe(
      "Service category hint (e.g. 'llm-completions', 'Inference'). Fallback match key when `url` is unknown to the catalog, OR alone for category-only discovery.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('Max alternatives to return (1..10, default 5).'),
});

export const PaymentReceiptSchema = z
  .object({
    transaction: z.string().optional(),
    network: z.string().optional(),
    payer: z.string().optional(),
    raw: z.string().optional(),
    malformed: z.boolean().optional(),
  })
  .passthrough()
  .nullable();

export const EndpointMetadataSchema = z
  .object({
    url: z.string(),
    service: z.string().optional(),
    service_id: z.string().optional(),
    provider: z.string().nullable().optional(),
    price_usdc: z.string().nullable().optional(),
    currency: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    uptime_1h_pct: z.number().nullable().optional(),
    avg_latency_ms: z.number().nullable().optional(),
    endpoint_first_seen: z.string().optional(),
    service_first_seen: z.string().optional(),
  })
  .passthrough();

// `warnings` and `signals` on response payloads are typed as
// `z.union([SignalSchema, z.string()])` (rather than `SignalSchema`
// directly): the x402station signal vocabulary is server-extensible,
// so a strict enum on the response would throw at parse time when the
// oracle ships a new signal — *after* the agent has already paid for
// the call. Inputs (watch.subscribe.signals) keep the strict enum so
// typos still get caught before round-trip. CodeRabbit
// (mastra-ai/mastra#15804, 2026-04-27).
const WarningsArraySchema = z.array(z.union([SignalSchema, z.string()]));

export const PreflightOutputSchema = z.object({
  result: z.object({
    ok: z.boolean(),
    warnings: WarningsArraySchema,
    metadata: EndpointMetadataSchema,
  }),
  paymentReceipt: PaymentReceiptSchema,
});

export const ForensicsOutputSchema = z.object({
  result: z
    .object({
      ok: z.boolean(),
      warnings: WarningsArraySchema,
      decoy_probability: z.number(),
      metadata: EndpointMetadataSchema,
    })
    .passthrough(),
  paymentReceipt: PaymentReceiptSchema,
});

export const CatalogDecoysOutputSchema = z.object({
  result: z
    .object({
      generated_at: z.string(),
      counts: z.object({
        total: z.number(),
        by_reason: z.record(z.string(), z.number()),
      }),
      truncated: z.boolean(),
      entries: z.array(z.unknown()),
    })
    .passthrough(),
  paymentReceipt: PaymentReceiptSchema,
});

export const BuyCreditsOutputSchema = z.object({
  result: z
    .object({
      creditId: z.string(),
      balance: z.number(),
      initialBalance: z.number(),
      paidAmount: z.string(),
      expiresAt: z.string(),
    })
    .passthrough(),
  paymentReceipt: PaymentReceiptSchema,
});

export const CreditsStatusOutputSchema = z
  .object({
    creditId: z.string(),
    balance: z.number(),
    initialBalance: z.number(),
    used: z.number(),
    paidAmount: z.string(),
    expiresAt: z.string(),
    expired: z.boolean(),
  })
  .passthrough();

export const WhatsNewOutputSchema = z.object({
  result: z
    .object({
      since: z.string(),
      until: z.string(),
      window_hours: z.number(),
      added_endpoints: z.array(z.unknown()),
      removed_endpoints: z.array(z.unknown()),
      summary: z
        .object({
          added_endpoints_count: z.number(),
          removed_endpoints_count: z.number(),
          added_services_count: z.number(),
          removed_services_count: z.number(),
          polls_in_window: z.number(),
          current_active_endpoints: z.number(),
          current_active_services: z.number(),
        })
        .passthrough(),
      truncated: z.boolean(),
      limit: z.number(),
    })
    .passthrough(),
  paymentReceipt: PaymentReceiptSchema,
});

export const AlternativesOutputSchema = z.object({
  result: z
    .object({
      target: z.unknown(),
      match_strategy: z.string(),
      alternatives: z.array(z.unknown()),
      candidate_count: z.number(),
    })
    .passthrough(),
  paymentReceipt: PaymentReceiptSchema,
});

export const WatchSubscribeOutputSchema = z.object({
  result: z
    .object({
      watchId: z.string(),
      secret: z.string(),
      expiresAt: z.string(),
      signals: WarningsArraySchema,
      alertsPaid: z.number(),
      alertsRemaining: z.number(),
    })
    .passthrough(),
  paymentReceipt: PaymentReceiptSchema,
});

export const WatchStatusOutputSchema = z
  .object({
    watchId: z.string(),
    endpointUrl: z.string(),
    isActive: z.boolean(),
    expired: z.boolean(),
    alertsRemaining: z.number(),
  })
  .passthrough();

export const WatchUnsubscribeOutputSchema = z
  .object({
    watchId: z.string(),
    isActive: z.literal(false),
    message: z.string(),
  })
  .passthrough();

export type PreflightInput = z.infer<typeof PreflightInputSchema>;
export type ForensicsInput = z.infer<typeof ForensicsInputSchema>;
export type CatalogDecoysInput = z.infer<typeof CatalogDecoysInputSchema>;
export type AlternativesInput = z.infer<typeof AlternativesInputSchema>;
export type WhatsNewInput = z.infer<typeof WhatsNewInputSchema>;
export type BuyCreditsInput = z.infer<typeof BuyCreditsInputSchema>;
export type CreditsStatusInput = z.infer<typeof CreditsStatusInputSchema>;
export type WatchSubscribeInput = z.infer<typeof WatchSubscribeInputSchema>;
export type WatchSecretInput = z.infer<typeof WatchSecretInputSchema>;
