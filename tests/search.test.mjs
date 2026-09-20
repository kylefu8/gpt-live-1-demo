import assert from 'node:assert/strict';
import test from 'node:test';

import { executeWebSearch, webSearchDefinition } from '../search.mjs';

function jsonResponse(payload, status = 200) {
  const text = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    },
  };
}

test('web search definition is a strict Responses function schema', () => {
  assert.equal(webSearchDefinition.type, 'function');
  assert.equal(webSearchDefinition.name, 'web_search');
  assert.equal(webSearchDefinition.strict, true);
  assert.equal(webSearchDefinition.parameters.type, 'object');
  assert.equal(webSearchDefinition.parameters.additionalProperties, false);
  assert.deepEqual(webSearchDefinition.parameters.required, ['query', 'time_range']);
  assert.deepEqual(webSearchDefinition.parameters.properties.query, {
    type: 'string',
    minLength: 1,
    maxLength: 500,
  });
  assert.deepEqual(webSearchDefinition.parameters.properties.time_range, {
    type: ['string', 'null'],
    enum: ['day', 'week', 'month', 'year', null],
  });
});

test('web search sends the bounded Tavily request and returns filtered compact sources', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      results: [
        {
          title: 'Current story',
          url: 'https://example.com/story',
          content: `  ${'a'.repeat(1900)}  `,
          published_date: '2026-09-20T01:02:03Z',
        },
        { title: 'Non-web', url: 'ftp://example.com/file', content: 'ignore' },
        { title: 'Credential URL', url: 'https://user:pass@example.com/private', content: 'ignore' },
        { title: 'Duplicate', url: 'https://example.com/story', content: 'ignore' },
        { title: 'Second', url: 'http://example.org/second', content: 'ok' },
      ],
    });
  };

  const result = await executeWebSearch({ query: '  latest news  ', time_range: 'day' }, {
    apiKey: 'tvly-test-secret',
    fetch,
  });
  assert.equal(result.query, 'latest news');
  assert.match(result.retrievedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].title, 'Current story');
  assert.equal(result.results[0].content.length, 1800);
  assert.equal(result.results[0].publishedDate, '2026-09-20T01:02:03Z');
  assert.deepEqual(result.sources, [
    { title: 'Current story', url: 'https://example.com/story' },
    { title: 'Second', url: 'http://example.org/second' },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.tavily.com/search');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tvly-test-secret');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    query: 'latest news',
    search_depth: 'basic',
    max_results: 5,
    include_answer: false,
    include_raw_content: false,
    time_range: 'day',
  });
});

test('null time range is omitted and result count is capped at five', async () => {
  let requestBody;
  const fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return jsonResponse({
      results: Array.from({ length: 8 }, (_, index) => ({
        title: `Result ${index}`,
        url: `https://example.com/${index}`,
        content: `Content ${index}`,
      })),
    });
  };
  const result = await executeWebSearch({ query: 'anything', time_range: null }, { apiKey: 'secret', fetch });
  assert.equal(result.results.length, 5);
  assert.equal(Object.hasOwn(requestBody, 'time_range'), false);
});

test('invalid arguments and missing credentials do not make a network request', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    throw new Error('should not be called');
  };
  const invalid = await executeWebSearch({ query: '   ', time_range: null }, { apiKey: 'secret', fetch });
  assert.equal(invalid.error.code, 'invalid_arguments');
  const tooLong = await executeWebSearch({ query: 'x'.repeat(501), time_range: null }, { apiKey: 'secret', fetch });
  assert.equal(tooLong.error.code, 'invalid_arguments');
  const unknown = await executeWebSearch({ query: 'ok', time_range: null, extra: true }, { apiKey: 'secret', fetch });
  assert.equal(unknown.error.code, 'invalid_arguments');
  const missingKey = await executeWebSearch({ query: 'ok', time_range: null }, { fetch });
  assert.equal(missingKey.error.code, 'search_not_configured');
  assert.equal(calls, 0);
});

test('network and API failures return structured safe errors without response body leakage', async () => {
  const responseBody = 'tvly-secret-body-or-key';
  const unauthorized = await executeWebSearch({ query: 'ok', time_range: null }, {
    apiKey: 'tvly-secret-key',
    fetch: async () => jsonResponse({ error: responseBody }, 401),
  });
  assert.equal(unauthorized.error.code, 'search_unauthorized');
  assert.doesNotMatch(unauthorized.error.message, /tvly-secret/);
  const invalid = await executeWebSearch({ query: 'ok', time_range: null }, {
    apiKey: 'tvly-secret-key',
    fetch: async () => jsonResponse({ nope: true }),
  });
  assert.equal(invalid.error.code, 'search_invalid_response');
  const network = await executeWebSearch({ query: 'ok', time_range: null }, {
    apiKey: 'tvly-secret-key',
    fetch: async () => { throw new Error(responseBody); },
  });
  assert.equal(network.error.code, 'search_network_error');
  assert.doesNotMatch(network.error.message, /tvly-secret/);
});

test('caller cancellation prevents or interrupts the request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await executeWebSearch({ query: 'ok', time_range: null }, {
    apiKey: 'secret',
    signal: controller.signal,
    fetch: async (_url, options) => {
      calls += 1;
      assert.ok(options.signal instanceof AbortSignal);
      controller.abort();
      return new Promise(() => {});
    },
  });
  assert.equal(result.error.code, 'aborted');
  assert.equal(calls, 1);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  let called = false;
  const noRequest = await executeWebSearch({ query: 'ok', time_range: null }, {
    apiKey: 'secret',
    signal: alreadyAborted.signal,
    fetch: async () => { called = true; },
  });
  assert.equal(noRequest.error.code, 'aborted');
  assert.equal(called, false);
});

test('response body is bounded', async () => {
  const huge = 'x'.repeat(1_048_577);
  const result = await executeWebSearch({ query: 'ok', time_range: null }, {
    apiKey: 'secret',
    fetch: async () => ({ ok: true, status: 200, async text() { return huge; } }),
  });
  assert.equal(result.error.code, 'search_response_too_large');
});

