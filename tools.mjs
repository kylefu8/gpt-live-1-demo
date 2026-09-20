const DEFAULT_TIME_ZONE = 'UTC';
const DEFAULT_FORECAST_DAYS = 3;
const WEATHER_TIMEOUT_MS = 12_000;
const MAX_LOCATION_LENGTH = 160;
const MAX_EXPRESSION_LENGTH = 256;

const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

const WMO_DESCRIPTIONS = new Map([
  [0, '晴'],
  [1, '大部晴朗'],
  [2, '局部多云'],
  [3, '阴'],
  [45, '雾'],
  [48, '冻雾'],
  [51, '小毛毛雨'],
  [53, '毛毛雨'],
  [55, '大毛毛雨'],
  [56, '冻毛毛雨'],
  [57, '强冻毛毛雨'],
  [61, '小雨'],
  [63, '中雨'],
  [65, '大雨'],
  [66, '冻雨'],
  [67, '强冻雨'],
  [71, '小雪'],
  [73, '中雪'],
  [75, '大雪'],
  [77, '雪粒'],
  [80, '小阵雨'],
  [81, '阵雨'],
  [82, '强阵雨'],
  [85, '小阵雪'],
  [86, '强阵雪'],
  [95, '雷暴'],
  [96, '雷暴伴小冰雹'],
  [99, '雷暴伴大冰雹'],
]);

const TOOL_NAMES = new Set(['get_current_time', 'get_weather', 'calculate']);

const nullableString = {
  type: ['string', 'null'],
};

export const toolDefinitions = [
  {
    type: 'function',
    name: 'get_current_time',
    description: '获取指定时区的当前本地日期、时间和星期。time_zone 为空时使用会话默认时区。',
    parameters: {
      type: 'object',
      properties: {
        time_zone: nullableString,
      },
      required: ['time_zone'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_weather',
    description: '查询地点当前天气和未来天气。location 为空时使用会话默认城市；days 为空时返回默认天数。地点不明确时会返回候选城市并请求澄清。',
    parameters: {
      type: 'object',
      properties: {
        location: nullableString,
        days: { type: ['integer', 'null'], minimum: 1, maximum: 7 },
      },
      required: ['location', 'days'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'calculate',
    description: '安全计算包含加减乘除、乘方、百分号和括号的算式。',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', minLength: 1, maxLength: MAX_EXPRESSION_LENGTH },
      },
      required: ['expression'],
      additionalProperties: false,
    },
    strict: true,
  },
];

function errorResult(code, message, details = undefined) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { ok: false, error };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateArgs(name, args) {
  if (!isPlainObject(args)) {
    return errorResult('invalid_arguments', `${name} 的参数必须是 JSON 对象。`);
  }

  const allowed = {
    get_current_time: ['time_zone'],
    get_weather: ['location', 'days'],
    calculate: ['expression'],
  }[name];
  if (!allowed) return errorResult('unknown_tool', `未知工具：${name}。`);

  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    return errorResult('invalid_arguments', `${name} 包含未知参数：${unknown.join('、')}。`);
  }

  const missing = allowed.filter((key) => !Object.prototype.hasOwnProperty.call(args, key));
  if (missing.length > 0) {
    return errorResult('invalid_arguments', `${name} 缺少必需参数：${missing.join('、')}。`);
  }

  return null;
}

function validateNullableString(value, field, maxLength) {
  if (value !== null && typeof value !== 'string') {
    return errorResult('invalid_arguments', `${field} 必须是字符串或 null。`);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return errorResult('invalid_arguments', `${field} 不能为空字符串。`);
    if (trimmed.length > maxLength) return errorResult('invalid_arguments', `${field} 超过 ${maxLength} 个字符。`);
  }
  return null;
}

function validateTimeZone(value) {
  const validation = validateNullableString(value, 'time_zone', 100);
  if (validation) return validation;
  if (value === null) return null;
  try {
    // Constructing the formatter is the platform-supported timezone validation.
    new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format();
  } catch {
    return errorResult('invalid_time_zone', `无法识别时区：${value}。`);
  }
  return null;
}

function normalizeContext(context) {
  return isPlainObject(context) ? context : {};
}

function formatTimeParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekday: parts.weekday,
    local: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function getCurrentTime(args, context) {
  const validation = validateArgs('get_current_time', args);
  if (validation) return validation;
  const timezoneValidation = validateTimeZone(args.time_zone);
  if (timezoneValidation) return timezoneValidation;

  const ctx = normalizeContext(context);
  const timeZone = args.time_zone ?? (typeof ctx.timeZone === 'string' && ctx.timeZone.trim() ? ctx.timeZone.trim() : DEFAULT_TIME_ZONE);
  const inheritedValidation = validateTimeZone(timeZone);
  if (inheritedValidation) return inheritedValidation;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  if (Number.isNaN(now.getTime())) return errorResult('clock_error', '当前时间不可用。');
  const parts = formatTimeParts(now, timeZone);
  return {
    ok: true,
    time_zone: timeZone,
    date: parts.date,
    time: parts.time,
    weekday: parts.weekday,
    local: parts.local,
    utc: now.toISOString(),
  };
}

function normalizeName(value) {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/[\s,，、]+/gu, '');
}

function hasChinese(value) {
  return /[\u3400-\u9fff]/u.test(value);
}

function candidateFromResult(result) {
  if (!result || typeof result !== 'object') return null;
  if (!Number.isFinite(Number(result.latitude)) || !Number.isFinite(Number(result.longitude))) return null;
  const population = Number(result.population);
  return {
    name: typeof result.name === 'string' ? result.name : '',
    country: typeof result.country === 'string' ? result.country : '',
    country_code: typeof result.country_code === 'string' ? result.country_code : undefined,
    admin1: typeof result.admin1 === 'string' ? result.admin1 : undefined,
    admin2: typeof result.admin2 === 'string' ? result.admin2 : undefined,
    feature_code: typeof result.feature_code === 'string' ? result.feature_code : undefined,
    population: Number.isFinite(population) && population > 0 ? population : null,
    latitude: Number(result.latitude),
    longitude: Number(result.longitude),
    timezone: typeof result.timezone === 'string' ? result.timezone : undefined,
  };
}

function candidateLabel(candidate) {
  return [candidate.name, candidate.admin1, candidate.admin2, candidate.country].filter(Boolean).join('，');
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.name}|${candidate.country}|${candidate.admin1}|${candidate.latitude.toFixed(4)}|${candidate.longitude.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isClearlySamePlace(a, b) {
  return normalizeName(a.name) === normalizeName(b.name)
    && normalizeName(a.country) === normalizeName(b.country)
    && Math.abs(a.latitude - b.latitude) < 0.01
    && Math.abs(a.longitude - b.longitude) < 0.01;
}

function normalizePlaceName(value) {
  return normalizeName(value).replace(/(?:特别行政区|自治区|自治州|地区|省|市|州|县|区)$/u, '');
}

function splitQueryParts(query) {
  return String(query).split(/[,，、/|;；]+/u).map((part) => part.trim()).filter(Boolean);
}

function geocodingSearchTerm(query) {
  const firstPart = splitQueryParts(query)[0] ?? String(query).trim();
  return firstPart.replace(/(?:特别行政区|自治区|自治州|地区|省|市|州|县|区)$/u, '') || firstPart;
}

function isCredibleAdminCenter(candidate) {
  return /^(?:PPLC|PPLA(?:2)?)$/u.test(candidate.feature_code ?? '')
    || (candidate.admin1 && normalizePlaceName(candidate.admin1) === normalizePlaceName(candidate.name));
}

function isQualifiedCandidate(candidate, queryParts) {
  return queryParts.every((part) => {
    const normalizedPart = normalizePlaceName(part);
    return [candidate.name, candidate.admin1, candidate.admin2, candidate.country, candidate.country_code]
      .filter(Boolean)
      .some((value) => {
        const normalizedValue = normalizePlaceName(value);
        return normalizedValue === normalizedPart
          || normalizedValue.includes(normalizedPart)
          || normalizedPart.includes(normalizedValue);
      });
  });
}

function chooseDominantCandidate(candidates) {
  const populated = candidates
    .filter((candidate) => Number.isFinite(candidate.population))
    .sort((a, b) => b.population - a.population);
  const top = populated[0];
  if (!top || top.population < 100_000 || !isCredibleAdminCenter(top)) return null;
  const others = candidates.filter((candidate) => candidate !== top);
  const competingMajor = others.some((candidate) => Number.isFinite(candidate.population) && candidate.population >= 100_000);
  if (competingMajor) return null;
  const knownSmaller = others.filter((candidate) => Number.isFinite(candidate.population) && candidate.population > 0);
  if (knownSmaller.some((candidate) => top.population < candidate.population * 20)) return null;
  const unknownAdminCenters = others.some((candidate) => !Number.isFinite(candidate.population) && isCredibleAdminCenter(candidate));
  if (unknownAdminCenters) return null;
  return top;
}

function chooseGeocodingCandidate(results, query) {
  const candidates = dedupeCandidates(results.map(candidateFromResult).filter(Boolean));
  if (candidates.length === 0) return { kind: 'not_found' };

  const queryParts = splitQueryParts(query);
  const normalizedQuery = normalizePlaceName(queryParts[0] ?? query);
  const exact = candidates.filter((candidate) => normalizePlaceName(candidate.name) === normalizedQuery);
  if (queryParts.length > 1) {
    const qualified = candidates.filter((candidate) => isQualifiedCandidate(candidate, queryParts));
    if (qualified.length === 0) return { kind: 'not_found' };
    if (qualified.length === 1) return { kind: 'selected', candidate: qualified[0] };
    const dominantQualified = chooseDominantCandidate(qualified);
    if (dominantQualified) return { kind: 'selected', candidate: dominantQualified };
    const firstQualified = qualified[0];
    if (qualified.every((candidate) => isClearlySamePlace(firstQualified, candidate))) {
      return { kind: 'selected', candidate: firstQualified };
    }
    return { kind: 'ambiguous', candidates: qualified.slice(0, 5) };
  }

  // A localized result can have a translated name (for example Shanghai -> 上海).
  // Only accept this fallback when there is a bounded candidate set and a clearly
  // dominant administrative center; a lone fuzzy result must fail closed.
  if (candidates.length > 1) {
    const dominant = chooseDominantCandidate(candidates);
    if (dominant) return { kind: 'selected', candidate: dominant };
  }
  if (exact.length === 1) return { kind: 'selected', candidate: exact[0] };
  if (exact.length > 1) {
    const first = exact[0];
    if (exact.every((candidate) => isClearlySamePlace(first, candidate))) {
      return { kind: 'selected', candidate: first };
    }
    const dominant = chooseDominantCandidate(exact);
    if (dominant) return { kind: 'selected', candidate: dominant };
    return { kind: 'ambiguous', candidates: exact.slice(0, 5) };
  }
  if (exact.length === 0) return { kind: 'not_found' };
  return { kind: 'ambiguous', candidates: candidates.slice(0, 5) };
}

function buildGeocodingUrl(query, language) {
  const url = new URL(GEOCODING_ENDPOINT);
  url.searchParams.set('name', query);
  url.searchParams.set('count', '5');
  url.searchParams.set('language', language);
  url.searchParams.set('format', 'json');
  return url.toString();
}

function buildForecastUrl(candidate, days) {
  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set('latitude', String(candidate.latitude));
  url.searchParams.set('longitude', String(candidate.longitude));
  url.searchParams.set('current', [
    'temperature_2m',
    'relative_humidity_2m',
    'apparent_temperature',
    'is_day',
    'precipitation',
    'rain',
    'weather_code',
    'wind_speed_10m',
  ].join(','));
  url.searchParams.set('daily', [
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_probability_max',
    'precipitation_sum',
    'rain_sum',
    'weather_code',
  ].join(','));
  url.searchParams.set('forecast_days', String(days));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('wind_speed_unit', 'kmh');
  return url.toString();
}

function getFetch(context) {
  if (typeof context.fetch === 'function') return context.fetch;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  return null;
}

function makeCombinedTimeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort(parentSignal.reason);
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('timeout'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

async function fetchJson(url, context, timeout) {
  if (!url.startsWith('https://geocoding-api.open-meteo.com/') && !url.startsWith('https://api.open-meteo.com/')) {
    return { ok: false, error: errorResult('unsafe_url', '天气请求地址不在允许的服务范围内。') };
  }
  if (context.signal?.aborted) return { ok: false, error: errorResult('aborted', '天气查询已取消。') };
  if (timeout.signal.aborted) {
    return {
      ok: false,
      error: timeout.timedOut()
        ? errorResult('weather_timeout', '天气服务请求超过 12 秒未返回。')
        : errorResult('aborted', '天气查询已取消。'),
    };
  }
  const fetchImpl = getFetch(context);
  if (!fetchImpl) return { ok: false, error: errorResult('weather_unavailable', '当前 Node.js 没有可用的 fetch。') };
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: timeout.signal,
    });
    if (!response || !response.ok) {
      const status = response && Number.isFinite(response.status) ? response.status : undefined;
      return { ok: false, error: errorResult('weather_http_error', `天气服务返回了${status ? ` HTTP ${status}` : '错误响应'}。`) };
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, error: errorResult('weather_invalid_response', '天气服务返回的内容不是有效 JSON。') };
    }
    return { ok: true, payload };
  } catch (error) {
    if (context.signal?.aborted) return { ok: false, error: errorResult('aborted', '天气查询已取消。') };
    if (timeout.timedOut()) return { ok: false, error: errorResult('weather_timeout', '天气服务请求超过 12 秒未返回。') };
    const message = error instanceof Error && error.message ? error.message : '网络请求失败';
    return { ok: false, error: errorResult('weather_fetch_failed', `天气服务请求失败：${message}`) };
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value) {
  return typeof value === 'string' && value ? value : null;
}

function weatherDescription(code) {
  const number = Number(code);
  return WMO_DESCRIPTIONS.get(number) ?? (Number.isFinite(number) ? `天气代码 ${number}` : null);
}

function validateWeatherPayload(payload, days) {
  if (!payload || typeof payload !== 'object' || !payload.current || !payload.daily) {
    return errorResult('weather_invalid_response', '天气服务响应缺少当前或逐日数据。');
  }
  const current = payload.current;
  const daily = payload.daily;
  if (!Array.isArray(daily.time) || daily.time.length < days) {
    return errorResult('weather_invalid_response', '天气服务响应缺少完整的逐日数据。');
  }
  const fields = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'precipitation_sum', 'rain_sum', 'weather_code'];
  if (fields.some((field) => !Array.isArray(daily[field]) || daily[field].length < days)) {
    return errorResult('weather_invalid_response', '天气服务响应缺少逐日天气字段。');
  }
  return null;
}

function compactWeather(payload, candidate, days, query, sources, retrievedAt) {
  const current = payload.current;
  const daily = payload.daily;
  return {
    ok: true,
    location: {
      query,
      name: candidate.name,
      admin1: candidate.admin1 ?? null,
      country: candidate.country,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      timezone: textOrNull(payload.timezone) ?? candidate.timezone ?? null,
    },
    current: {
      time: textOrNull(current.time),
      temperature_c: numberOrNull(current.temperature_2m),
      apparent_temperature_c: numberOrNull(current.apparent_temperature),
      relative_humidity_percent: numberOrNull(current.relative_humidity_2m),
      weather_code: numberOrNull(current.weather_code),
      condition: weatherDescription(current.weather_code),
      precipitation_mm: numberOrNull(current.precipitation),
      rain_mm: numberOrNull(current.rain),
      wind_speed_kmh: numberOrNull(current.wind_speed_10m),
      is_day: current.is_day === null || current.is_day === undefined ? null : Boolean(Number(current.is_day)),
    },
    daily: daily.time.slice(0, days).map((date, index) => ({
      date: textOrNull(date),
      temperature_max_c: numberOrNull(daily.temperature_2m_max[index]),
      temperature_min_c: numberOrNull(daily.temperature_2m_min[index]),
      precipitation_probability_max_percent: numberOrNull(daily.precipitation_probability_max[index]),
      precipitation_sum_mm: numberOrNull(daily.precipitation_sum[index]),
      rain_sum_mm: numberOrNull(daily.rain_sum[index]),
      weather_code: numberOrNull(daily.weather_code[index]),
      condition: weatherDescription(daily.weather_code[index]),
    })),
    retrieved_at: retrievedAt,
    sources,
  };
}

async function getWeather(args, context) {
  const validation = validateArgs('get_weather', args);
  if (validation) return validation;
  const locationValidation = validateNullableString(args.location, 'location', MAX_LOCATION_LENGTH);
  if (locationValidation) return locationValidation;
  if (args.days !== null && (!Number.isInteger(args.days) || args.days < 1 || args.days > 7)) {
    return errorResult('invalid_arguments', 'days 必须是 1 到 7 之间的整数或 null。');
  }

  const ctx = normalizeContext(context);
  let query = args.location;
  if (query === null) query = typeof ctx.city === 'string' ? ctx.city.trim() : '';
  if (!query) {
    return errorResult('needs_location', '请先提供要查询的城市或地点。');
  }
  if (query.length > MAX_LOCATION_LENGTH) return errorResult('invalid_arguments', `location 超过 ${MAX_LOCATION_LENGTH} 个字符。`);
  const days = args.days ?? DEFAULT_FORECAST_DAYS;
  const timeout = makeCombinedTimeoutSignal(ctx.signal, WEATHER_TIMEOUT_MS);
  const sources = [];
  const retrievedAt = new Date().toISOString();
  const searchTerm = geocodingSearchTerm(query);
  try {
    let geocodeUrl = buildGeocodingUrl(searchTerm, 'zh');
    sources.push({ url: geocodeUrl, retrieved_at: retrievedAt });
    let geocode = await fetchJson(geocodeUrl, ctx, timeout);
    if (!geocode.ok) return geocode.error;
    let selection = chooseGeocodingCandidate(geocode.payload?.results ?? [], query);

    // Open-Meteo's result labels are localized, but a second English lookup helps
    // with translated names or qualifiers that the localized index cannot match.
    if (selection.kind === 'not_found' && (hasChinese(query) || splitQueryParts(query).length > 1)) {
      geocodeUrl = buildGeocodingUrl(searchTerm, 'en');
      sources.push({ url: geocodeUrl, retrieved_at: retrievedAt });
      geocode = await fetchJson(geocodeUrl, ctx, timeout);
      if (!geocode.ok) return geocode.error;
      selection = chooseGeocodingCandidate(geocode.payload?.results ?? [], query);
    }
    if (selection.kind === 'not_found') {
      return errorResult('location_not_found', `找不到地点：${query}。`, { sources });
    }
    if (selection.kind === 'ambiguous') {
      return errorResult('ambiguous_location', `地点“${query}”有多个匹配，请选择具体城市。`, {
        candidates: selection.candidates.map((candidate) => ({
          label: candidateLabel(candidate),
          name: candidate.name,
          admin1: candidate.admin1 ?? null,
          admin2: candidate.admin2 ?? null,
          country: candidate.country,
          feature_code: candidate.feature_code ?? null,
          population: candidate.population,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
        })),
        sources,
      });
    }

    const candidate = selection.candidate;
    const forecastUrl = buildForecastUrl(candidate, days);
    sources.push({ url: forecastUrl, retrieved_at: retrievedAt });
    const forecast = await fetchJson(forecastUrl, ctx, timeout);
    if (!forecast.ok) return forecast.error;
    const payloadValidation = validateWeatherPayload(forecast.payload, days);
    if (payloadValidation) return payloadValidation;
    return compactWeather(forecast.payload, candidate, days, query, sources, retrievedAt);
  } finally {
    timeout.cleanup();
  }
}

class ExpressionParser {
  constructor(expression) {
    this.tokens = tokenize(expression);
    this.index = 0;
    this.depth = 0;
  }

  peek() {
    return this.tokens[this.index] ?? null;
  }

  consume(expected = undefined) {
    const token = this.peek();
    if (expected !== undefined && token !== expected) {
      throw new Error(`expected_${expected}`);
    }
    if (token !== null) this.index += 1;
    return token;
  }

  parse() {
    const value = this.parseExpression();
    if (this.peek() !== null) throw new Error('unexpected_token');
    return value;
  }

  parseExpression() {
    let value = this.parseTerm();
    while (this.peek() === '+' || this.peek() === '-') {
      const operator = this.consume();
      const right = this.parseTerm();
      value = operator === '+' ? value + right : value - right;
      assertFinite(value);
    }
    return value;
  }

  parseTerm() {
    let value = this.parseUnary();
    while (true) {
      const operator = this.peek();
      if (operator !== '*' && operator !== '/' && operator !== '%') break;
      if (operator === '%' && !this.nextTokenStartsPrimary(1)) break;
      this.consume();
      const right = this.parseUnary();
      if (operator === '*') value *= right;
      else if (operator === '/') {
        if (right === 0) throw new Error('division_by_zero');
        value /= right;
      } else {
        if (right === 0) throw new Error('modulo_by_zero');
        value %= right;
      }
      assertFinite(value);
    }
    return value;
  }

  nextTokenStartsPrimary(offset = 0) {
    const token = this.tokens[this.index + offset];
    return token === '(' || typeof token === 'number' || (typeof token === 'string' && /^(?:\d|\.)/u.test(token));
  }

  parseUnary() {
    if (this.peek() === '+') {
      this.consume();
      return this.parseUnary();
    }
    if (this.peek() === '-') {
      this.consume();
      const value = -this.parseUnary();
      assertFinite(value);
      return value;
    }
    return this.parsePower();
  }

  parsePower() {
    let value = this.parsePostfix();
    if (this.peek() === '^') {
      this.consume();
      const exponent = this.parseUnary();
      if (Math.abs(exponent) > 1000) throw new Error('exponent_too_large');
      value = value ** exponent;
      assertFinite(value);
    }
    return value;
  }

  parsePostfix() {
    let value = this.parsePrimary();
    while (this.peek() === '%' && !this.nextTokenStartsPrimary(1)) {
      this.consume();
      value /= 100;
      assertFinite(value);
    }
    return value;
  }

  parsePrimary() {
    const token = this.peek();
    if (token === '(') {
      this.consume();
      this.depth += 1;
      if (this.depth > 50) throw new Error('parentheses_too_deep');
      const value = this.parseExpression();
      this.consume(')');
      this.depth -= 1;
      return value;
    }
    if (typeof token === 'number') {
      this.consume();
      return token;
    }
    throw new Error('expected_number');
  }
}

function tokenize(expression) {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const character = expression[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if ('+-*/^()%'.includes(character)) {
      tokens.push(character);
      index += 1;
      continue;
    }
    if (/\d|\./u.test(character)) {
      const start = index;
      let digitsBefore = 0;
      while (/\d/u.test(expression[index] ?? '')) {
        index += 1;
        digitsBefore += 1;
      }
      let digitsAfter = 0;
      if (expression[index] === '.') {
        index += 1;
        while (/\d/u.test(expression[index] ?? '')) {
          index += 1;
          digitsAfter += 1;
        }
      }
      if (digitsBefore === 0 && digitsAfter === 0) throw new Error('invalid_number');
      const raw = expression.slice(start, index);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('invalid_number');
      tokens.push(value);
      continue;
    }
    throw new Error('invalid_character');
  }
  if (tokens.length === 0) throw new Error('empty_expression');
  if (tokens.length > 200) throw new Error('expression_too_complex');
  return tokens;
}

function assertFinite(value) {
  if (!Number.isFinite(value)) throw new Error('non_finite_result');
}

function calculate(args) {
  const validation = validateArgs('calculate', args);
  if (validation) return validation;
  if (typeof args.expression !== 'string') return errorResult('invalid_arguments', 'expression 必须是字符串。');
  if (args.expression.trim().length === 0) return errorResult('invalid_arguments', 'expression 不能为空。');
  if (args.expression.length > MAX_EXPRESSION_LENGTH) return errorResult('invalid_arguments', `expression 超过 ${MAX_EXPRESSION_LENGTH} 个字符。`);
  try {
    const value = new ExpressionParser(args.expression).parse();
    assertFinite(value);
    return { ok: true, expression: args.expression, value };
  } catch (error) {
    const code = error instanceof Error && error.message ? error.message : 'invalid_expression';
    const messages = {
      division_by_zero: '算式不能除以零。',
      modulo_by_zero: '算式不能对零取模。',
      invalid_character: '算式包含不支持的字符。',
      invalid_number: '算式包含无效数字。',
      empty_expression: '算式不能为空。',
      unexpected_token: '算式中有多余内容。',
      expected_number: '算式缺少数字。',
      exponent_too_large: '乘方指数过大。',
      parentheses_too_deep: '算式括号嵌套过深。',
      expression_too_complex: '算式过于复杂。',
      non_finite_result: '算式结果超出可表示范围。',
    };
    if (code.startsWith('expected_')) return errorResult('invalid_expression', '算式语法错误。');
    return errorResult(code === 'invalid_character' ? code : 'invalid_expression', messages[code] ?? '算式语法错误。');
  }
}

export async function executeTool(name, args, context = {
  timeZone: DEFAULT_TIME_ZONE,
  city: '',
  signal: undefined,
}) {
  if (typeof name !== 'string' || !TOOL_NAMES.has(name)) return errorResult('unknown_tool', `未知工具：${String(name)}。`);
  const ctx = normalizeContext(context);
  if (name === 'get_current_time') return getCurrentTime(args, ctx);
  if (name === 'get_weather') return getWeather(args, ctx);
  return calculate(args);
}

export const __internal = {
  buildGeocodingUrl,
  buildForecastUrl,
  chooseGeocodingCandidate,
  geocodingSearchTerm,
  tokenize,
};
