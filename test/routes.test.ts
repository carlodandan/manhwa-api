// test/routes.test.ts
//
// Route-level tests that exercise the worker end to end without touching the
// upstream site: request validation, method handling, CORS and the error
// envelope all resolve before any outbound fetch is attempted.

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://api.test';

async function get(path: string, init?: RequestInit) {
	return SELF.fetch(`${ORIGIN}${path}`, init);
}

describe('endpoint index', () => {
	it('describes the versioned endpoints and is cacheable', async () => {
		const response = await get('/');
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('application/json');
		expect(response.headers.get('Cache-Control')).toContain('s-maxage=');
		expect(response.headers.get('ETag')).toMatch(/^W\//);

		const body = (await response.json()) as { version: string; endpoints: { path: string }[] };
		expect(body.version).toBe('v1');
		expect(body.endpoints.map((e) => e.path)).toContain('/v1/manhwa/{slug}');
	});

	it('answers a matching If-None-Match with 304', async () => {
		const first = await get('/');
		const etag = first.headers.get('ETag') ?? '';
		const second = await get('/', { headers: { 'If-None-Match': etag } });
		expect(second.status).toBe(304);
	});
});

describe('request validation', () => {
	it('rejects a too-short search term before any upstream call', async () => {
		const response = await get('/v1/search?term=a');
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe('term_too_short');
	});

	it('rejects a missing search term', async () => {
		expect((await get('/v1/search')).status).toBe(400);
	});

	it('rejects an over-long search term', async () => {
		const response = await get(`/v1/search?term=${'x'.repeat(200)}`);
		expect(response.status).toBe(400);
	});

	it('rejects an unknown ranking period', async () => {
		const response = await get('/v1/home?period=1y');
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe('invalid_period');
	});

	it('rejects malformed pagination', async () => {
		expect((await get('/v1/manhwa/alpha-x1/chapters?page=0')).status).toBe(400);
		expect((await get('/v1/manhwa/alpha-x1/chapters?page=abc')).status).toBe(400);
	});

	it('rejects a slug containing separators', async () => {
		// Traversal-shaped input never reaches an outbound fetch.
		const response = await get('/v1/manhwa/%2E%2E%2Fadmin');
		expect(response.status).toBe(400);
	});

	it('never leaks upstream detail in an error body', async () => {
		const response = await get('/v1/search?term=a');
		const text = await response.text();
		expect(text).not.toContain('mgeko');
		expect(text).not.toContain('http');
	});

	it('marks error responses no-store', async () => {
		const response = await get('/v1/search?term=a');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});
});

describe('method handling', () => {
	it('answers preflight with 204 and the CORS headers', async () => {
		const response = await get('/v1/home', { method: 'OPTIONS' });
		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
		expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
	});

	it('serves HEAD as a bodiless GET rather than 405', async () => {
		const response = await get('/', { method: 'HEAD' });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('');
		expect(response.headers.get('ETag')).toMatch(/^W\//);
	});

	it('rejects writes with 405 and an Allow header', async () => {
		const response = await get('/v1/home', { method: 'POST' });
		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toContain('GET');
	});
});

describe('unknown routes', () => {
	it('returns a JSON 404 envelope', async () => {
		const response = await get('/nope');
		expect(response.status).toBe(404);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe('not_found');
	});
});

describe('origin allowlist', () => {
	// ALLOWED_ORIGINS in wrangler.jsonc; matching is exact.
	const ALLOWED = 'https://panelrift.pages.dev';

	it('echoes the allowed origin and marks the response as varying on it', async () => {
		const response = await get('/', { headers: { Origin: ALLOWED } });
		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED);
		expect(response.headers.get('Vary')).toBe('Origin');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	});

	it('withholds the CORS header from every other origin', async () => {
		for (const origin of [
			'https://evil.example',
			// Suffix and case variants must not slip past an exact match.
			`${ALLOWED}.evil.example`,
			'https://PANELRIFT.pages.dev',
		]) {
			const response = await get('/', { headers: { Origin: origin } });
			expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
			// Vary is still required, or a shared cache can replay this to ALLOWED.
			expect(response.headers.get('Vary')).toBe('Origin');
		}
	});

	it('refuses the preflight for a disallowed origin', async () => {
		const response = await get('/v1/home', {
			method: 'OPTIONS',
			headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
		});
		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('applies the allowlist to error responses too', async () => {
		const allowed = await get('/v1/search?term=a', { headers: { Origin: ALLOWED } });
		expect(allowed.status).toBe(400);
		expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED);

		const denied = await get('/v1/search?term=a', { headers: { Origin: 'https://evil.example' } });
		expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('applies the allowlist to the 405 short-circuit, which bypasses Hono', async () => {
		const allowed = await get('/v1/home', { method: 'POST', headers: { Origin: ALLOWED } });
		expect(allowed.status).toBe(405);
		expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED);

		const denied = await get('/v1/home', { method: 'POST', headers: { Origin: 'https://evil.example' } });
		expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});
});
