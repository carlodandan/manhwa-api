// src/middleware.ts

import type { Context, ErrorHandler, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { cacheControl, cacheKeyFor, cacheLookup, cacheStore, POLICIES, weakETag, type Deferrable } from './lib/cache';
import { readConfig, type AppEnv, type RateLimitBinding } from './lib/env';
import { ApiError, tooManyRequests } from './lib/errors';
import type { ApiErrorBody } from './types';

/** Attach parsed config and a request id for correlating logs. */
export const withConfig: MiddlewareHandler<AppEnv> = async (c, next) => {
	c.set('config', readConfig(c.env));
	c.set('requestId', c.req.header('cf-ray') ?? crypto.randomUUID());
	await next();
};

/**
 * CORS and security headers.
 *
 * `ALLOWED_ORIGINS` defaults to "*" because this is a public read-only API; set it
 * to an explicit list to stop other sites building against your worker.
 *
 * Applied by both the middleware and the error handler, because Hono produces
 * error responses outside the normal middleware unwind.
 */
function applyStandardHeaders(c: Context<AppEnv>): void {
	const { allowedOrigins } = c.get('config') ?? readConfig(c.env);
	const origin = c.req.header('Origin');

	if (allowedOrigins === '*') {
		c.header('Access-Control-Allow-Origin', '*');
	} else if (origin && allowedOrigins.includes(origin)) {
		c.header('Access-Control-Allow-Origin', origin);
		// Responses now differ by Origin, so caches must key on it.
		c.header('Vary', 'Origin');
	}

	c.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
	c.header('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
	c.header('Access-Control-Expose-Headers', 'ETag, Retry-After');
	c.header('Access-Control-Max-Age', '86400');
	c.header('X-Content-Type-Options', 'nosniff');
}

export const withCors: MiddlewareHandler<AppEnv> = async (c, next) => {
	await next();
	applyStandardHeaders(c);
};

/**
 * Per-IP rate limiting.
 *
 * Keyed on CF-Connecting-IP, which the edge sets and clients cannot spoof.
 * Counters are per-colo rather than global; that is enough to stop runaway
 * clients and accidental loops, not a determined distributed attacker.
 */
export function withRateLimit(pick: (env: AppEnv['Bindings']) => RateLimitBinding | undefined): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const limiter = pick(c.env);
		if (!limiter) {
			// Binding absent (e.g. local dev without unsafe bindings). Fail open
			// rather than making the API unusable, but say so in the logs.
			console.log(JSON.stringify({ level: 'warn', msg: 'rate limiter binding missing' }));
			return next();
		}

		const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
		const { success } = await limiter.limit({ key: ip });
		if (!success) throw tooManyRequests();

		return next();
	};
}

/**
 * Map thrown errors onto the response envelope, keeping internals in the logs.
 *
 * Registered via `app.onError`, not as try/catch middleware: Hono turns a handler
 * throw into a response inside its own dispatch, so a wrapping middleware's catch
 * block never sees it and every 400 came back as a 500.
 */
export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
	const api =
		error instanceof ApiError
			? error
			: new ApiError(
					500,
					'internal_error',
					'Internal server error',
					error instanceof Error ? `${error.name}: ${error.message}` : String(error),
				);

	console.log(
		JSON.stringify({
			level: api.status >= 500 ? 'error' : 'warn',
			requestId: c.get('requestId'),
			path: new URL(c.req.url).pathname,
			status: api.status,
			code: api.code,
			// Detail is logged, never returned: it carries upstream URLs.
			detail: api.detail,
		}),
	);

	const body: ApiErrorBody = { error: { code: api.code, message: api.message } };
	c.status(api.status as ContentfulStatusCode);
	c.header('Content-Type', 'application/json; charset=utf-8');

	if (api.status === 429) c.header('Retry-After', '60');
	// Negative-cache 404s so a bad slug requested in a loop stops hitting upstream.
	if (api.status === 404) c.header('Cache-Control', cacheControl(POLICIES.notFound));
	else c.header('Cache-Control', 'no-store');

	applyStandardHeaders(c);

	return c.body(JSON.stringify(body));
};

/**
 * Edge cache read-through.
 *
 * Reminder: `caches.default` silently does nothing on *.workers.dev. On a custom
 * domain this is what keeps a cache miss — and therefore an upstream fetch — off
 * the hot path for repeat requests.
 */
export const withEdgeCache: MiddlewareHandler<AppEnv> = async (c, next) => {
	const key = cacheKeyFor(c.req.raw);
	const hit = await cacheLookup(key);

	if (hit) {
		const etag = hit.headers.get('ETag');
		if (etag && c.req.header('If-None-Match') === etag) {
			return new Response(null, { status: 304, headers: hit.headers });
		}
		const headers = new Headers(hit.headers);
		headers.set('X-Cache', 'HIT');
		return new Response(hit.body, { status: hit.status, headers });
	}

	await next();

	if (c.res.ok) {
		let ctx: Deferrable | undefined;
		try {
			ctx = c.executionCtx;
		} catch {
			ctx = undefined; // Not available in some test environments.
		}
		cacheStore(ctx, key, c.res);
		c.header('X-Cache', 'MISS');
	}
};

/** Serialise a payload as JSON with a cache policy and an ETag. */
export async function jsonWithCache<T>(
	c: Parameters<MiddlewareHandler<AppEnv>>[0],
	payload: T,
	policy: (typeof POLICIES)[keyof typeof POLICIES],
): Promise<Response> {
	const body = JSON.stringify(payload);
	const etag = await weakETag(body);

	if (c.req.header('If-None-Match') === etag) {
		c.status(304);
		c.header('ETag', etag);
		c.header('Cache-Control', cacheControl(policy));
		return c.body(null);
	}

	c.header('Content-Type', 'application/json; charset=utf-8');
	c.header('Cache-Control', cacheControl(policy));
	c.header('ETag', etag);
	return c.body(body);
}
