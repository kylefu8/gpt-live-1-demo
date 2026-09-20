const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_CONTENT_CHARS = 1_800;
const MAX_TITLE_CHARS = 500;
const TIME_RANGES = new Set(['day', 'week', 'month', 'year']);

export const webSearchDefinition = {
  type: 'function',
  name: 'web_search',
  description: 'Search public web pages for current information and return short snippets with sources.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
      },
      time_range: {
        type: ['string', 'null'],
        enum: ['day', 'week', 'month', 'year', null],
      },
    },
    required: ['query', 'time_range'],
    additionalProperties: false,
  },
  strict: true,
};

function errorResult(code, message) {
  return { error: { code, message } };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateArguments(args) {
  if (!isPlainObject(args)) {
    return errorResult('invalid_arguments', 'web_search 参数必须是 JSON 对象。');
  }
  const keys = Object.keys(args);
  const unknown = keys.filter((key) => key !== 'query' && key !== 'time_range');
  if (unknown.length > 0) {
    return errorResult('invalid_arguments', 'web_search 包含未知参数。');
  }
  if (!Object.prototype.hasOwnProperty.call(args, 'query')
    || !Object.prototype.hasOwnProperty.call(args, 'time_range')) {
    return errorResult('invalid_arguments', 'web_search 缺少必需参数。');
  }
  if (typeof args.query !== 'string') {
    return errorResult('invalid_arguments', 'query 必须是字符串。');
  }
  const query = args.query.trim();
  if (!query) return errorResult('invalid_arguments', 'query 不能为空。');
  if ([...query].length > 500) return errorResult('invalid_arguments', 'query 最多 500 个字符。');
  if (args.time_range !== null && (typeof args.time_range !== 'string' || !TIME_RANGES.has(args.time_range))) {
    return errorResult('invalid_arguments', 'time_range 必须是 day、week、month、year 或 null。');
  }
  return { query, timeRange: args.time_range };
}

function validApiKey(apiKey) {
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function toUint8Array(value) {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

class RequestAbortError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'RequestAbortError';
    this.reason = reason;
  }
}

class ResponseTooLargeError extends Error {
  constructor() {
    super('response_too_large');
    this.name = 'ResponseTooLargeError';
  }
}

function requestContext(parentSignal) {
  const controller = new AbortController();
  let resolveAbort;
  const abortPromise = new Promise((resolve) => {
    resolveAbort = resolve;
  });
  let reason = null;
  let timer;

  const notify = (nextReason) => {
    if (reason) return;
    reason = nextReason;
    controller.abort(nextReason === 'timeout' ? new Error('timeout') : parentSignal?.reason);
    resolveAbort(nextReason);
  };
  const onParentAbort = () => notify('aborted');

  if (parentSignal?.aborted) notify('aborted');
  else if (parentSignal) parentSignal.addEventListener('abort', onParentAbort, { once: true });
  timer = setTimeout(() => notify('timeout'), REQUEST_TIMEOUT_MS);

  return {
    signal: controller.signal,
    abortPromise,
    reason: () => reason,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

async function awaitWithAbort(operation, context) {
  const operationResult = Promise.resolve()
    .then(() => (typeof operation === 'function' ? operation() : operation))
    .then(
      (value) => ({ kind: 'value', value }),
      (error) => ({ kind: 'error', error }),
    );
  const result = await Promise.race([
    operationResult,
    context.abortPromise.then((reason) => ({ kind: 'abort', reason })),
  ]);
  if (result.kind === 'abort') throw new RequestAbortError(result.reason);
  if (result.kind === 'error') throw result.error;
  return result.value;
}

async function readResponseText(response, context) {
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await awaitWithAbort(() => reader.read(), context);
        if (!chunk || chunk.done) break;
        const bytesChunk = toUint8Array(chunk.value);
        bytes += bytesChunk.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw new ResponseTooLargeError();
        chunks.push(decoder.decode(bytesChunk, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join('');
    } catch (error) {
      try {
        // Do not wait for a stalled body reader while returning a timeout or
        // cancellation result; cancellation is best-effort here.
        void Promise.resolve(reader.cancel()).catch(() => {});
      } catch {
        // The request is already being aborted or the reader is closed.
      }
      throw error;
    }
  }

  if (typeof response?.text === 'function') {
    const text = await awaitWithAbort(() => response.text(), context);
    if (typeof text !== 'string') throw new Error('invalid_response_body');
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) throw new ResponseTooLargeError();
    return text;
  }

  if (typeof response?.json === 'function') {
    const payload = await awaitWithAbort(() => response.json(), context);
    const text = JSON.stringify(payload);
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) throw new ResponseTooLargeError();
    return text;
  }

  throw new Error('invalid_response_body');
}

function responseSucceeded(response) {
  if (!response || typeof response !== 'object') return false;
  if (typeof response.ok === 'boolean') return response.ok;
  return Number.isInteger(response.status) && response.status >= 200 && response.status < 300;
}

function httpError(response) {
  const status = Number.isInteger(response?.status) ? response.status : 0;
  if (status === 401 || status === 403) return errorResult('search_unauthorized', '联网搜索 API key 无效或无权限。');
  if (status === 429) return errorResult('search_rate_limited', '联网搜索请求过于频繁，请稍后再试。');
  if (status >= 500) return errorResult('search_service_error', '联网搜索服务暂时不可用。');
  if (status >= 400) return errorResult('search_request_failed', '联网搜索请求被拒绝。');
  return errorResult('search_invalid_response', '联网搜索服务返回了无效响应。');
}

function externalUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim();
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || !parsed.hostname) return null;
    // Keep the source URL as returned by the provider while using URL parsing
    // only for validation. This avoids silently changing a source's spelling.
    return candidate;
  } catch {
    return null;
  }
}

function urlKey(value) {
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}

function truncate(value, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  return [...text].slice(0, limit).join('');
}

function normalizeResults(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.results)) return null;
  const seen = new Set();
  const results = [];
  for (const item of payload.results) {
    if (!isPlainObject(item)) continue;
    const url = externalUrl(item.url);
    const key = url && urlKey(url);
    if (!url || seen.has(key)) continue;
    seen.add(key);
    const title = truncate(item.title, MAX_TITLE_CHARS) || url;
    const content = truncate(item.content, MAX_CONTENT_CHARS);
    const result = { title, url, content };
    const published = item.published_date ?? item.publishedDate;
    if (typeof published === 'string' && published.trim()) result.publishedDate = truncate(published, 200);
    results.push(result);
    if (results.length === 5) break;
  }
  return results;
}

function cancellationResult(error, context) {
  const reason = error instanceof RequestAbortError ? error.reason : context.reason();
  if (reason === 'aborted') return errorResult('aborted', '联网搜索已取消。');
  if (reason === 'timeout') return errorResult('search_timeout', '联网搜索请求超过 12 秒未返回。');
  return null;
}

export async function executeWebSearch(args, options = {}) {
  const validation = validateArguments(args);
  if (validation?.error) return validation;
  const { apiKey, signal, fetch: fetchImpl = globalThis.fetch } = options ?? {};
  if (!validApiKey(apiKey)) return errorResult('search_not_configured', '联网搜索尚未配置 API key。');
  if (signal?.aborted) return errorResult('aborted', '联网搜索已取消。');
  if (typeof fetchImpl !== 'function') return errorResult('search_unavailable', '当前运行环境没有可用的网络请求能力。');

  const context = requestContext(signal);
  try {
    const body = {
      query: validation.query,
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
    };
    if (validation.timeRange !== null) body.time_range = validation.timeRange;

    let response;
    try {
      response = await awaitWithAbort(() => fetchImpl(TAVILY_SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: context.signal,
      }), context);
    } catch (error) {
      const cancelled = cancellationResult(error, context);
      if (cancelled) return cancelled;
      return errorResult('search_network_error', '联网搜索网络请求失败。');
    }

    let responseText;
    try {
      responseText = await readResponseText(response, context);
    } catch (error) {
      const cancelled = cancellationResult(error, context);
      if (cancelled) return cancelled;
      if (!responseSucceeded(response)) return httpError(response);
      if (error instanceof ResponseTooLargeError) return errorResult('search_response_too_large', '联网搜索服务返回内容过大。');
      return errorResult('search_invalid_response', '联网搜索服务返回的内容无效。');
    }

    if (!responseSucceeded(response)) return httpError(response);
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return errorResult('search_invalid_response', '联网搜索服务返回的内容不是有效 JSON。');
    }
    const results = normalizeResults(payload);
    if (!results) return errorResult('search_invalid_response', '联网搜索服务响应缺少搜索结果。');
    return {
      query: validation.query,
      retrievedAt: new Date().toISOString(),
      results,
      sources: results.map(({ title, url }) => ({ title, url })),
    };
  } catch (error) {
    const cancelled = cancellationResult(error, context);
    if (cancelled) return cancelled;
    if (error instanceof ResponseTooLargeError) return errorResult('search_response_too_large', '联网搜索服务返回内容过大。');
    return errorResult('search_network_error', '联网搜索网络请求失败。');
  } finally {
    context.cleanup();
  }
}
