// test/normalize.test.ts

import { describe, expect, it } from 'vitest';
import { normalizeRanking } from '../src/handlers/home';
import { readConfig } from '../src/lib/env';
import { absoluteUrl, cleanText, decodeEntities, toInteger, toNumber } from '../src/lib/html';
import { parsePagination, parseSearchTerm, parseSlug, parseChapterId } from '../src/lib/validate';
import { cacheKeyFor } from '../src/lib/cache';

const BASE = 'https://upstream.example.test';

describe('normalizeRanking', () => {
	it('reads the list from the "manga" key upstream actually uses', () => {
		const result = normalizeRanking({ manga: [{ name: 'Alpha', slug: 'alpha-x1', cover_url: '/media/a.png' }], period: '1d' }, '1d', BASE);
		expect(result.period).toBe('1d');
		expect(result.manhwa).toHaveLength(1);
		expect(result.manhwa[0]?.title).toBe('Alpha');
	});

	it('resolves relative cover URLs', () => {
		const result = normalizeRanking({ manga: [{ name: 'Alpha', slug: 'alpha-x1', cover_url: '/media/a.png' }] }, '1d', BASE);
		// Regression: this branch keyed off "manhwa" and never ran, so clients
		// received a bare path instead of a URL.
		expect(result.manhwa[0]?.cover_url).toBe(`${BASE}/media/a.png`);
	});

	it('still accepts a "manhwa" key if upstream ever renames it back', () => {
		const result = normalizeRanking({ manhwa: [{ name: 'Beta', slug: 'beta-x2' }] }, '1w', BASE);
		expect(result.manhwa[0]?.slug).toBe('beta-x2');
	});

	it('yields null covers instead of fabricating a URL', () => {
		const result = normalizeRanking({ manga: [{ name: 'Alpha', slug: 'alpha-x1' }] }, '1d', BASE);
		// The old absoluteUrl(undefined) produced "<base>/undefined".
		expect(result.manhwa[0]?.cover_url).toBeNull();
	});

	it('drops entries missing a title or slug', () => {
		const result = normalizeRanking({ manga: [{ name: 'Alpha', slug: 'alpha-x1' }, { name: 'No slug' }, {}, null] }, '1d', BASE);
		expect(result.manhwa).toHaveLength(1);
	});

	it('coerces a string rating and rejects junk', () => {
		const result = normalizeRanking(
			{
				manga: [
					{ name: 'A', slug: 'a', rating: '8.4' },
					{ name: 'B', slug: 'b', rating: 'n/a' },
				],
			},
			'1d',
			BASE,
		);
		expect(result.manhwa[0]?.rating).toBe(8.4);
		expect(result.manhwa[1]?.rating).toBeNull();
	});

	it('throws a 502 when the payload is not shaped like a ranking', () => {
		expect(() => normalizeRanking({ manga: 'nope' as unknown }, '1d', BASE)).toThrowError(/markup may have changed|ranking list/);
	});
});

describe('html helpers', () => {
	it('decodes named, decimal and hex entities', () => {
		// Escapes rather than literals: the difference between U+0020 and U+00A0 is
		// invisible in source and makes a failure impossible to read.
		expect(decodeEntities('a &amp; b &#39;c&#39; &#x2014; d')).toBe("a & b 'c' — d");
		expect(decodeEntities('x&nbsp;y')).toBe('x y');
		// cleanText then collapses the non-breaking space like any other whitespace.
		expect(cleanText('x&nbsp;&nbsp;y')).toBe('x y');
	});

	it('leaves unknown entities untouched', () => {
		expect(decodeEntities('&notreal; &#xZZZZ;')).toBe('&notreal; &#xZZZZ;');
	});

	it('collapses whitespace after decoding', () => {
		expect(cleanText('  Hello \n\t  &amp;  world  ')).toBe('Hello & world');
	});

	it('returns null for absent or unparseable URLs', () => {
		expect(absoluteUrl(null, BASE)).toBeNull();
		expect(absoluteUrl(undefined, BASE)).toBeNull();
		expect(absoluteUrl('   ', BASE)).toBeNull();
		expect(absoluteUrl('/x.png', BASE)).toBe(`${BASE}/x.png`);
		expect(absoluteUrl('https://other.test/x.png', BASE)).toBe('https://other.test/x.png');
	});

	it('returns null instead of NaN for numbers', () => {
		expect(toNumber('8.7')).toBe(8.7);
		expect(toNumber('1,234')).toBe(1234);
		expect(toNumber('n/a')).toBeNull();
		expect(toNumber(null)).toBeNull();
		expect(toInteger('12,345')).toBe(12345);
		expect(toInteger('')).toBeNull();
	});
});

describe('validation', () => {
	it('accepts ordinary slugs and chapter ids', () => {
		expect(parseSlug('alpha-tale-x1')).toBe('alpha-tale-x1');
		expect(parseChapterId('alpha-tale-chapter-205-eng-li')).toBe('alpha-tale-chapter-205-eng-li');
	});

	it('rejects path traversal and separators', () => {
		for (const bad of ['../etc', 'a/b', '..', 'a b', '', 'a?b=1', 'a#b', '%2e%2e']) {
			expect(() => parseSlug(bad)).toThrowError();
		}
	});

	it('rejects percent-encoded traversal after decoding', () => {
		expect(() => parseSlug('%2E%2E%2Fadmin')).toThrowError();
	});

	it('bounds search terms at both ends', () => {
		expect(parseSearchTerm('  solo ')).toBe('solo');
		expect(() => parseSearchTerm('a')).toThrowError(/at least/);
		expect(() => parseSearchTerm(null)).toThrowError(/at least/);
		expect(() => parseSearchTerm('x'.repeat(101))).toThrowError(/at most/);
	});

	it('clamps per_page rather than rejecting it', () => {
		const url = new URL('https://api.test/v1/manhwa/a/chapters?page=2&per_page=99999');
		expect(parsePagination(url)).toEqual({ page: 2, perPage: 500 });
	});

	it('rejects non-numeric pagination', () => {
		expect(() => parsePagination(new URL('https://api.test/x?page=0'))).toThrowError();
		expect(() => parsePagination(new URL('https://api.test/x?page=abc'))).toThrowError();
	});
});

describe('cacheKeyFor', () => {
	it('drops params that do not affect the response', () => {
		const key = cacheKeyFor(new Request('https://api.test/v1/search?term=solo&utm_source=x&r=9'));
		// Without this, ?junk=N is an unbounded cache-buster straight to upstream.
		expect(key.url).toBe('https://api.test/v1/search?term=solo');
	});

	it('orders params so equivalent requests share one entry', () => {
		const a = cacheKeyFor(new Request('https://api.test/v1/manhwa/a/chapters?page=2&per_page=50'));
		const b = cacheKeyFor(new Request('https://api.test/v1/manhwa/a/chapters?per_page=50&page=2'));
		expect(a.url).toBe(b.url);
	});
});

describe('readConfig', () => {
	it('falls back to defaults for absent or invalid values', () => {
		const config = readConfig({});
		expect(config.baseUrl).toBe('https://www.mgeko.cc');
		expect(config.timeoutMs).toBe(8000);
		// Deny by default: an absent ALLOWED_ORIGINS must not silently open the API
		// to every site, so it resolves to an empty allowlist rather than "*".
		expect(config.allowedOrigins).toEqual([]);
	});

	it('opens up to any origin only when asked explicitly', () => {
		expect(readConfig({ ALLOWED_ORIGINS: '*' }).allowedOrigins).toBe('*');
	});

	it('parses an explicit origin allowlist and trims the base URL', () => {
		const config = readConfig({
			UPSTREAM_BASE_URL: 'https://example.test/',
			UPSTREAM_TIMEOUT_MS: '2500',
			ALLOWED_ORIGINS: 'https://a.test, https://b.test',
		});
		expect(config.baseUrl).toBe('https://example.test');
		expect(config.timeoutMs).toBe(2500);
		expect(config.allowedOrigins).toEqual(['https://a.test', 'https://b.test']);
	});

	it('ignores a non-numeric timeout', () => {
		expect(readConfig({ UPSTREAM_TIMEOUT_MS: 'soon' }).timeoutMs).toBe(8000);
	});
});
