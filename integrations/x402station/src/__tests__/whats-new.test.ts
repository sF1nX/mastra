import { describe, it, expect, vi } from 'vitest';

vi.mock('@x402/fetch', () => ({
  wrapFetchWithPaymentFromConfig: (impl: typeof fetch) => impl,
}));
vi.mock('@x402/evm', () => ({
  ExactEvmScheme: class {
    constructor(_: unknown) {}
  },
}));
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: (_pk: string) => ({ address: '0x30d2b1f9bcEdE5F13136b56Ff199A8ad6E4f50de' }),
}));

import { createX402StationWhatsNewTool } from '../whats-new.js';

const VALID_PK = '0x' + 'a'.repeat(64);

interface CapturedCall {
  url: string;
  method: string;
  body: string;
}

function buildFetchImpl(res: { status: number; bodyText: string }): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : typeof input === 'string' ? input : input.toString();
    const method = input instanceof Request ? input.method : (init?.method ?? 'GET');
    const body = input instanceof Request ? await input.clone().text() : (typeof init?.body === 'string' ? init.body : '');
    calls.push({ url, method, body });
    return new Response(res.bodyText, { status: res.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('createX402StationWhatsNewTool', () => {
  const fullPayload = {
    since: '2026-04-26T00:00:00Z',
    until: '2026-04-27T00:00:00Z',
    window_hours: 24,
    added_endpoints: [],
    removed_endpoints: [],
    summary: {
      added_endpoints_count: 0,
      removed_endpoints_count: 0,
      added_services_count: 0,
      removed_services_count: 0,
      polls_in_window: 0,
      first_poll_at: null,
      last_poll_at: null,
      current_active_endpoints: 0,
      current_active_services: 0,
    },
    truncated: false,
    limit: 200,
  };

  it('has correct id and schemas', () => {
    const tool = createX402StationWhatsNewTool({ privateKey: VALID_PK });
    expect(tool.id).toBe('x402station-whats-new');
    expect(tool.description).toBeDefined();
    expect(tool.description!.length).toBeGreaterThan(0);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
  });

  it('POSTs an empty body when no args', async () => {
    const { fetchImpl, calls } = buildFetchImpl({ status: 200, bodyText: JSON.stringify(fullPayload) });
    const tool = createX402StationWhatsNewTool({ privateKey: VALID_PK, fetchImpl });
    await tool.execute!({}, {} as never);
    expect(calls[0]!.url).toBe('https://x402station.io/api/v1/whats-new');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toBe('{}');
  });

  it('threads since + limit through', async () => {
    const { fetchImpl, calls } = buildFetchImpl({ status: 200, bodyText: JSON.stringify(fullPayload) });
    const tool = createX402StationWhatsNewTool({ privateKey: VALID_PK, fetchImpl });
    await tool.execute!({ since: '2026-04-27T00:00:00Z', limit: 50 }, {} as never);
    expect(JSON.parse(calls[0]!.body)).toEqual({
      since: '2026-04-27T00:00:00Z',
      limit: 50,
    });
  });
});
