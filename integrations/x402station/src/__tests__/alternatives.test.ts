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

import { createX402StationAlternativesTool } from '../alternatives.js';

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

describe('createX402StationAlternativesTool', () => {
  const fullPayload = {
    target: { url: 'https://api.example.com/llm', service: 'Example', service_id: 'example-llm' },
    match_strategy: 'url_target',
    alternatives: [],
    candidate_count: 0,
  };

  it('has correct id and schemas', () => {
    const tool = createX402StationAlternativesTool({ privateKey: VALID_PK });
    expect(tool.id).toBe('x402station-alternatives');
    expect(tool.description).toBeDefined();
    expect(tool.description!.length).toBeGreaterThan(0);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
  });

  it('POSTs url to /api/v1/alternatives', async () => {
    const { fetchImpl, calls } = buildFetchImpl({
      status: 200,
      bodyText: JSON.stringify(fullPayload),
    });
    const tool = createX402StationAlternativesTool({ privateKey: VALID_PK, fetchImpl });
    await tool.execute!({ url: 'https://api.example.com/llm' }, {} as never);
    expect(calls[0]!.url).toBe('https://x402station.io/api/v1/alternatives');
    expect(calls[0]!.method).toBe('POST');
    expect(JSON.parse(calls[0]!.body)).toEqual({ url: 'https://api.example.com/llm' });
  });

  it('accepts taskClass + limit, omits unset url', async () => {
    const { fetchImpl, calls } = buildFetchImpl({
      status: 200,
      bodyText: JSON.stringify({ ...fullPayload, target: { task_class: 'Inference' }, match_strategy: 'task_class_only' }),
    });
    const tool = createX402StationAlternativesTool({ privateKey: VALID_PK, fetchImpl });
    await tool.execute!({ taskClass: 'Inference', limit: 3 }, {} as never);
    const body = JSON.parse(calls[0]!.body);
    expect(body).toEqual({ taskClass: 'Inference', limit: 3 });
    expect(body).not.toHaveProperty('url');
  });
});
