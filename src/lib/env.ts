// src/lib/env.ts

/**
 * Runtime configuration and bindings.
 *
 * The generated `worker-configuration.d.ts` declares `Env` from wrangler.jsonc.
 * This module narrows it into validated, typed config so handlers never parse
 * strings themselves.
 */
export interface Config {
	baseUrl: string;
	timeoutMs: number;
	allowedOrigins: '*' | string[];
}

const DEFAULT_BASE_URL = 'https://www.mgeko.cc';
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * The vars this module reads.
 *
 * Declared structurally rather than as `Partial<Env>` because `wrangler types`
 * narrows vars to the literal values in wrangler.jsonc, which would reject any
 * other string a caller (or a test) supplies.
 */
export interface ConfigVars {
	UPSTREAM_BASE_URL?: string;
	UPSTREAM_TIMEOUT_MS?: string;
	ALLOWED_ORIGINS?: string;
}

export function readConfig(env: ConfigVars): Config {
	const baseUrl = (env.UPSTREAM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

	const parsedTimeout = Number.parseInt(env.UPSTREAM_TIMEOUT_MS ?? '', 10);
	const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS;

	const rawOrigins = (env.ALLOWED_ORIGINS ?? '').trim();
	const allowedOrigins =
		rawOrigins === '*'
			? '*'
			: rawOrigins
					.split(',')
					.map((origin) => origin.trim())
					.filter(Boolean);

	return { baseUrl, timeoutMs, allowedOrigins };
}

/**
 * A Cloudflare rate limit binding. Declared locally because the binding is
 * configured under `unsafe` and is not always present in generated types.
 */
export interface RateLimitBinding {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Bindings {
	READ_LIMITER?: RateLimitBinding;
	SEARCH_LIMITER?: RateLimitBinding;
	UPSTREAM_LIMITER?: RateLimitBinding;
}

/** Hono generic parameter: what `c.env` and `c.var` hold. */
export interface AppEnv {
	Bindings: Env & Bindings;
	Variables: {
		config: Config;
		requestId: string;
	};
}
