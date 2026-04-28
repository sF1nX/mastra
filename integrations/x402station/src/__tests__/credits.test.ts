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

import {
  createX402StationBuyCreditsTool,
  createX402StationCreditsStatusTool,
} from '../credits.js';

const VALID_PK = '0x' + 'a'.repeat(64);
const VALID_CREDIT_ID = '0a44f6b8-3b7d-4f2a-9e3a-2c5fd1b0aa11';

interface CapturedCall {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

function buildFetchImpl(res: { status: number; bodyText: string }): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: string;
    let method: string;
    let body: string;
    let headers: Record<string, string>;
    if (input instanceof Request) {
      url = input.url;
      method = input.method;
      headers = Object.fromEntries(input.headers);
      body = await input.clone().text();
    } else {
      url = typeof input === 'string' ? input : input.toString();
      method = init?.method ?? 'GET';
      const rawHeaders = init?.headers ?? {};
      headers =
        rawHeaders instanceof Headers
          ? Object.fromEntries(rawHeaders)
          : Array.isArray(rawHeaders)
            ? Object.fromEntries(rawHeaders)
            : (rawHeaders as Record<string, string>);
      body = typeof init?.body === 'string' ? init.body : '';
    }
    calls.push({ url, method, body, headers });
    return new Response(res.bodyText, { status: res.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('createX402StationBuyCreditsTool', () => {
  const fullPayload = {
    creditId: VALID_CREDIT_ID,
    balance: 1000,
    initialBalance: 1000,
    paidAmount: '0.50',
    payerAddress: '0xpayer',
    createdAt: '2026-04-28T00:00:00Z',
    expiresAt: '2026-07-27T00:00:00Z',
    usage: {},
  };

  it('has correct id and schemas', () => {
    const tool = createX402StationBuyCreditsTool({ privateKey: VALID_PK });
    expect(tool.id).toBe('x402station-buy-credits');
    expect(tool.description).toBeDefined();
    expect(tool.description!.length).toBeGreaterThan(0);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
  });

  it('POSTs an empty body to /api/v1/credits', async () => {
    const { fetchImpl, calls } = buildFetchImpl({ status: 200, bodyText: JSON.stringify(fullPayload) });
    const tool = createX402StationBuyCreditsTool({ privateKey: VALID_PK, fetchImpl });
    await tool.execute!({}, {} as never);
    expect(calls[0]!.url).toBe('https://x402station.io/api/v1/credits');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toBe('{}');
  });
});

describe('createX402StationCreditsStatusTool', () => {
  const fullStatus = {
    creditId: VALID_CREDIT_ID,
    balance: 999,
    initialBalance: 1000,
    used: 1,
    paidAmount: '0.50',
    payerAddress: '0xpayer',
    createdAt: '2026-04-28T00:00:00Z',
    expiresAt: '2026-07-27T00:00:00Z',
    expired: false,
    paymentTx: null,
    paymentNetwork: null,
  };

  it('GETs /api/v1/credits/<id> without an x-x402station-secret header', async () => {
    const { fetchImpl, calls } = buildFetchImpl({ status: 200, bodyText: JSON.stringify(fullStatus) });
    const tool = createX402StationCreditsStatusTool({ privateKey: VALID_PK, fetchImpl });
    await tool.execute!({ creditId: VALID_CREDIT_ID }, {} as never);
    expect(calls[0]!.url).toBe(`https://x402station.io/api/v1/credits/${VALID_CREDIT_ID}`);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers['x-x402station-secret']).toBeUndefined();
  });
});
