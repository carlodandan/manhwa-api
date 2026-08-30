// src/handlers/browse.ts

import type { CoverConfig } from '../lib/covers';
import type { Config, RateLimitBinding } from '../lib/env';
import { parseError } from '../lib/errors';
import { fetchUpstreamJson } from '../lib/upstream';
import { parseComicCardsHtml } from '../parsers/browse';
import type { BrowseList } from '../types';

/** Upstream's sort key for this listing. */
export const RECENTLY_ADDED = 'recently_added';

/**
 * The browse endpoint answers with JSON, not a page: an HTML fragment of cards
 * plus the paginator's own counts. `page` is validated to a bounded integer
 * before it reaches here, so interpolating it needs no further escaping.
 */
function browsePath(page: number): string {
	return `/browse-comics/data/?sort=${RECENTLY_ADDED}&page=${page}`;
}

/**
 * Upstream's browse payload. `results_html` is the grid; the rest is the Django
 * paginator's state, which is cheaper to pass through than to recompute.
 */
interface UpstreamBrowse {
	results_html?: unknown;
	total_results?: unknown;
	page?: unknown;
	num_pages?: unknown;
}

const int = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null);

/**
 * Normalise a browse payload into the public shape.
 *
 * Exported so the envelope handling and the empty-page rule can be tested with
 * no network access.
 */
export async function normalizeBrowse(payload: UpstreamBrowse, page: number, config: CoverConfig): Promise<BrowseList> {
	if (typeof payload.results_html !== 'string') {
		throw parseError('the recently-added listing', 'no "results_html" string in the browse payload');
	}

	const results = await parseComicCardsHtml(payload.results_html, config);
	const totalPages = int(payload.num_pages);

	// Zero cards on a page upstream itself claims exists means the card markup
	// changed. A page past the end is a different thing and stays a valid empty
	// answer rather than a 502.
	if (results.length === 0 && (totalPages === null || page <= totalPages)) {
		throw parseError('any series from the recently-added listing', browsePath(page));
	}

	return {
		sort: RECENTLY_ADDED,
		// Upstream's echo is what it actually served, which may differ from the ask.
		page: int(payload.page) ?? page,
		count: results.length,
		total: int(payload.total_results),
		total_pages: totalPages,
		results,
	};
}

/** Fetch one page of the recently-added listing. */
export async function fetchRecentlyAdded(page: number, config: Config, limiter?: RateLimitBinding): Promise<BrowseList> {
	const payload = await fetchUpstreamJson<UpstreamBrowse>(browsePath(page), config, {
		describe: `Recently-added page ${page}`,
		accept: 'json',
		limiter,
	});

	return normalizeBrowse(payload, page, config);
}
