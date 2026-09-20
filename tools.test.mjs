import assert from 'node:assert/strict';
import test from 'node:test';

import { __internal, executeTool, toolDefinitions } from './tools.mjs';

test('tool definitions use strict Responses function schemas', () => {
  assert.deepEqual(toolDefinitions.map((tool) => tool.name), [
    'get_current_time',
    'get_weather',
    'calculate',
  ]);
  for (const tool of toolDefinitions) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.strict, true);
    assert.equal(tool.parameters.type, 'object');
    assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual(tool.parameters.required, Object.keys(tool.parameters.properties));
  }
  assert.deepEqual(toolDefinitions[1].parameters.properties.days.type, ['integer', 'null']);
});

test('calculate observes precedence, parentheses, powers, percentages, and modulo', async () => {
  assert.equal((await executeTool('calculate', { expression: '2 + 3 * 4' })).value, 14);
  assert.equal((await executeTool('calculate', { expression: '(2 + 3) * 4' })).value, 20);
  assert.equal((await executeTool('calculate', { expression: '2 ^ 3 ^ 2' })).value, 512);
  assert.equal((await executeTool('calculate', { expression: '50%' })).value, 0.5);
  assert.equal((await executeTool('calculate', { expression: '10 % 3' })).value, 1);
  assert.equal((await executeTool('calculate', { expression: '-2 ^ 2' })).value, -4);
});

test('calculate rejects code injection and unsafe or invalid arithmetic', async () => {
  for (const expression of [
    'process.exit()',
    '1; 2',
    'Function("return 1")()',
    '1 / 0',
    '2 ** 3',
    '9 ^ 1001',
  ]) {
    const result = await executeTool('calculate', { expression });
    assert.equal(result.ok, false, expression);
    assert.ok(result.error?.code, expression);
  }
  const unknown = await executeTool('missing_tool', {});
  assert.equal(unknown.error.code, 'unknown_tool');
  const extra = await executeTool('calculate', { expression: '1+1', extra: true });
  assert.equal(extra.error.code, 'invalid_arguments');
});

test('get_current_time uses the requested timezone and actual clock value', async () => {
  const result = await executeTool(
    'get_current_time',
    { time_zone: 'Asia/Shanghai' },
    { now: new Date('2026-09-20T00:00:00.000Z') },
  );
  assert.equal(result.ok, true);
  assert.equal(result.local, '2026-09-20 08:00:00');
  assert.equal(result.weekday, '星期日');
  assert.equal(result.time_zone, 'Asia/Shanghai');

  const invalid = await executeTool('get_current_time', { time_zone: 'Not/A_Timezone' });
  assert.equal(invalid.error.code, 'invalid_time_zone');
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test('get_weather uses bounded Open-Meteo requests and returns compact current and daily data', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://geocoding-api.open-meteo.com/')) {
      return jsonResponse({
        results: [{
          name: '上海',
          country: '中国',
          country_code: 'CN',
          admin1: '上海市',
          latitude: 31.2304,
          longitude: 121.4737,
          timezone: 'Asia/Shanghai',
        }],
      });
    }
    assert.ok(String(url).startsWith('https://api.open-meteo.com/'));
    return jsonResponse({
      timezone: 'Asia/Shanghai',
      current: {
        time: '2026-09-20T12:00',
        temperature_2m: 26.4,
        relative_humidity_2m: 70,
        apparent_temperature: 28.1,
        is_day: 1,
        precipitation: 0.1,
        rain: 0.1,
        weather_code: 61,
        wind_speed_10m: 11.2,
      },
      daily: {
        time: ['2026-09-20', '2026-09-21'],
        temperature_2m_max: [28, 29],
        temperature_2m_min: [23, 24],
        precipitation_probability_max: [60, 35],
        precipitation_sum: [2.1, 0.3],
        rain_sum: [2.1, 0.3],
        weather_code: [61, 2],
      },
    });
  };

  const result = await executeTool('get_weather', { location: '上海', days: 2 }, { fetch });
  assert.equal(result.ok, true);
  assert.equal(result.location.name, '上海');
  assert.equal(result.current.temperature_c, 26.4);
  assert.equal(result.current.condition, '小雨');
  assert.equal(result.daily.length, 2);
  assert.equal(result.daily[0].precipitation_probability_max_percent, 60);
  assert.equal(result.sources.length, 2);
  assert.match(result.sources[0].url, /^https:\/\/geocoding-api\.open-meteo\.com\//);
  assert.match(result.sources[1].url, /^https:\/\/api\.open-meteo\.com\//);
  assert.ok(result.retrieved_at);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.ok(call.options.signal instanceof AbortSignal);
});

test('get_weather asks for clarification for ambiguous locations and needs a location when none is available', async () => {
  const fetch = async (url) => {
    assert.match(String(url), /^https:\/\/geocoding-api\.open-meteo\.com\//);
    return jsonResponse({
      results: [
        { name: 'Springfield', country: 'United States', admin1: 'Illinois', latitude: 39.8, longitude: -89.6 },
        { name: 'Springfield', country: 'United States', admin1: 'Missouri', latitude: 37.2, longitude: -93.3 },
      ],
    });
  };
  const ambiguous = await executeTool('get_weather', { location: 'Springfield', days: 1 }, { fetch });
  assert.equal(ambiguous.error.code, 'ambiguous_location');
  assert.equal(ambiguous.error.details.candidates.length, 2);

  const missing = await executeTool('get_weather', { location: null, days: null }, { fetch });
  assert.equal(missing.error.code, 'needs_location');
});

test('geocoding prefers a dominant major city over same-name villages', () => {
  const selection = __internal.chooseGeocodingCandidate([
    {
      name: '上海', country: '中国', admin1: '上海市', admin2: '上海市',
      feature_code: 'PPLA', population: 24_874_500, latitude: 31.22222, longitude: 121.45806,
    },
    { name: '上海', country: '中国', admin1: '浙江', admin2: '绍兴市', feature_code: 'PPL', latitude: 29.32955, longitude: 121.05804 },
    { name: '上海', country: '中国', admin1: '云南', admin2: '丽江市', feature_code: 'PPL', latitude: 27.0741, longitude: 100.107 },
  ], '上海');
  assert.equal(selection.kind, 'selected');
  assert.equal(selection.candidate.admin1, '上海市');

  const qualified = __internal.chooseGeocodingCandidate([
    { name: 'Springfield', country: 'United States', admin1: 'Illinois', latitude: 39.8, longitude: -89.6 },
    { name: 'Springfield', country: 'United States', admin1: 'Missouri', latitude: 37.2, longitude: -93.3 },
  ], 'Springfield, Illinois');
  assert.equal(qualified.kind, 'selected');
  assert.equal(qualified.candidate.admin1, 'Illinois');
});

test('geocoding normalizes Chinese suffixes and fails closed on unrelated or unqualified results', () => {
  assert.equal(__internal.geocodingSearchTerm('上海市'), '上海');
  assert.equal(__internal.geocodingSearchTerm('上海市，中国'), '上海');
  assert.equal(__internal.geocodingSearchTerm('Springfield, Illinois'), 'Springfield');

  const unrelated = __internal.chooseGeocodingCandidate([
    { name: 'Unrelated Place', country: 'United States', latitude: 40, longitude: -90 },
  ], '上海市');
  assert.equal(unrelated.kind, 'not_found');

  const wrongCountry = __internal.chooseGeocodingCandidate([
    { name: 'Shanghai', country: 'United States', admin1: 'Illinois', latitude: 41, longitude: -90 },
  ], '上海，中国');
  assert.equal(wrongCountry.kind, 'not_found');
});

test('get_weather validates day bounds before any network request', async () => {
  let called = false;
  const fetch = async () => {
    called = true;
    return jsonResponse({});
  };
  const result = await executeTool('get_weather', { location: '上海', days: 8 }, { fetch });
  assert.equal(result.error.code, 'invalid_arguments');
  assert.equal(called, false);
});
