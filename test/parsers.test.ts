// test/parsers.test.ts

import { describe, expect, it } from 'vitest';
import { parseSearchHtml } from '../src/parsers/search';
import { parseManhwaHtml } from '../src/parsers/manhwa';
import { parseChapterListHtml, numberFromId } from '../src/parsers/chapterList';
import { parseChapterHtml } from '../src/parsers/chapter';
import { readConfig } from '../src/lib/env';
import { SEARCH_HTML } from './fixtures/search';
import { MANHWA_DETAIL_HTML } from './fixtures/manhwaDetail';
import { ALL_CHAPTERS_HTML } from './fixtures/allChapters';
import { READER_HTML, READER_HTML_NO_IMAGES } from './fixtures/reader';

const BASE = 'https://upstream.example.test';
// Built through readConfig rather than hand-rolled, so these tests run against the
// real cover defaults and would catch a change to either of them.
const CONFIG = readConfig({ UPSTREAM_BASE_URL: BASE });
/** Where a `/media/` cover ends up once the proxy prefix is applied. */
const PROXIED = 'https://imgsrv5.com/avatar/288x412/media/manga_covers';

describe('parseSearch', () => {
	it('extracts every well-formed result and skips the broken one', async () => {
		const results = await parseSearchHtml(SEARCH_HTML, CONFIG);
		expect(results).toHaveLength(2);
	});

	it('decodes HTML entities in titles', async () => {
		const [first] = await parseSearchHtml(SEARCH_HTML, CONFIG);
		// Regression: entities used to reach clients as literal &amp; / &#39;.
		expect(first?.title).toBe("Alpha & Omega's Tale");
	});

	it('derives the slug from the href and routes covers through the image proxy', async () => {
		const [first, second] = await parseSearchHtml(SEARCH_HTML, CONFIG);
		expect(first?.slug).toBe('alpha-tale-x1');
		// Not a /media/ path, so the proxy scheme is not known to apply: left alone.
		expect(first?.cover_url).toBe('https://cdn.example.test/covers/alpha.jpg');
		expect(second?.slug).toBe('beta-journey-x2');
		// Resolving this against BASE instead would 404 for a good share of series.
		expect(second?.cover_url).toBe(`${PROXIED}/beta.png`);
	});

	it('splits the stats block into chapter, date and rating', async () => {
		const [first] = await parseSearchHtml(SEARCH_HTML, CONFIG);
		expect(first?.latest_chapter).toBe('Chapter 128');
		expect(first?.last_updated).toBe('3 hours ago');
		expect(first?.rating).toBe(8.7);
	});

	it('returns null rather than NaN when the rating span is absent', async () => {
		const [, second] = await parseSearchHtml(SEARCH_HTML, CONFIG);
		expect(second?.rating).toBeNull();
		expect(second?.last_updated).toBe('2 days ago');
	});

	it('returns an empty list for markup with no results', async () => {
		expect(await parseSearchHtml('<ul class="novel-list"></ul>', CONFIG)).toEqual([]);
	});
});

describe('parseManhwa', () => {
	it('extracts the core detail fields', async () => {
		const manhwa = await parseManhwaHtml(MANHWA_DETAIL_HTML, 'alpha-tale-x1', CONFIG);
		expect(manhwa.title).toBe("Alpha & Omega's Tale");
		expect(manhwa.slug).toBe('alpha-tale-x1');
		expect(manhwa.author).toBe('Some Author');
		expect(manhwa.status).toBe('Completed');
		expect(manhwa.alternative_title).toContain('Alpha to Omega');
	});

	it('prefers data-src over the lazy-load placeholder and proxies it', async () => {
		const manhwa = await parseManhwaHtml(MANHWA_DETAIL_HTML, 'alpha-tale-x1', CONFIG);
		expect(manhwa.cover_url).toBe(`${PROXIED}/alpha.jpg`);
	});

	it('reports no cover at all when only the placeholder is present', async () => {
		// A detail page that never got a real cover: upstream leaves the shared
		// placeholder in `src` and omits `data-src`. Passing that through would show
		// readers upstream's grey box instead of the frontend's own empty state.
		const html = MANHWA_DETAIL_HTML.replace(/data-src="[^"]*"/, '');
		const manhwa = await parseManhwaHtml(html, 'alpha-tale-x1', CONFIG);
		expect(manhwa.cover_url).toBeNull();
	});

	it('splits rating from vote count', async () => {
		const manhwa = await parseManhwaHtml(MANHWA_DETAIL_HTML, 'alpha-tale-x1', CONFIG);
		expect(manhwa.rating).toBe(8.7);
		expect(manhwa.rating_count).toBe(12345);
	});

	it('strips Material Icons ligature text out of stat values', async () => {
		const manhwa = await parseManhwaHtml(MANHWA_DETAIL_HTML, 'alpha-tale-x1', CONFIG);
		// Without stripping, these read "visibility 4.2M" / "bookmark 88.1K".
		expect(manhwa.views).toBe('4.2M');
		expect(manhwa.bookmarks).toBe('88.1K');
		expect(manhwa.chapter_count).toBe('205');
	});

	it('collects trimmed, de-duplicated genres', async () => {
		const manhwa = await parseManhwaHtml(MANHWA_DETAIL_HTML, 'alpha-tale-x1', CONFIG);
		expect(manhwa.genres).toEqual(['Action', 'Fantasy', 'Manhwa']);
	});

	it('keeps the whole description across text nodes and drops the boilerplate prefix', async () => {
		const manhwa = await parseManhwaHtml(MANHWA_DETAIL_HTML, 'alpha-tale-x1', CONFIG);
		expect(manhwa.description?.startsWith('A quiet clerk')).toBe(true);
		expect(manhwa.description).toContain('—');
		expect(manhwa.description).toContain("isn't");
	});

	it('reports its chapter list as truncated', async () => {
		const manhwa = await parseManhwaHtml(MANHWA_DETAIL_HTML, 'alpha-tale-x1', CONFIG);
		expect(manhwa.chapters).toHaveLength(2);
		expect(manhwa.chapters_truncated).toBe(true);
		expect(manhwa.last_updated).toBe('2 years ago');
	});

	it('separates the chapter label from the nested date span', async () => {
		const manhwa = await parseManhwaHtml(MANHWA_DETAIL_HTML, 'alpha-tale-x1', CONFIG);
		expect(manhwa.chapters[0]).toMatchObject({
			number: '205',
			id: 'alpha-tale-chapter-205-eng-li',
			date: '2 years ago',
		});
	});
});

describe('parseChapterList', () => {
	it('extracts every chapter with its opaque id', async () => {
		const chapters = await parseChapterListHtml(ALL_CHAPTERS_HTML);
		expect(chapters).toHaveLength(3);
		expect(chapters.map((chapter) => chapter.id)).toEqual([
			'alpha-tale-chapter-206-side-story-eng-li',
			'alpha-tale-chapter-205-eng-li',
			'alpha-tale-chapter-204-eng-li',
		]);
	});

	it('normalises labels and strips the "Chapter:" prefix', async () => {
		const chapters = await parseChapterListHtml(ALL_CHAPTERS_HTML);
		expect(chapters[0]?.number).toBe('206-side-story');
		expect(chapters[1]?.number).toBe('205');
	});

	it('converts the a.m./p.m. datetime attribute to ISO 8601', async () => {
		const chapters = await parseChapterListHtml(ALL_CHAPTERS_HTML);
		expect(chapters[0]?.published_at).toMatch(/^2024-07-13T/);
		expect(chapters[1]?.published_at).toMatch(/^2024-07-1[01]T/);
	});

	it('falls back to the id when the label element is empty', async () => {
		const chapters = await parseChapterListHtml(ALL_CHAPTERS_HTML);
		expect(chapters[2]?.number).toBe('204');
		expect(chapters[2]?.published_at).toBeNull();
	});

	it('recovers a label from an id', () => {
		expect(numberFromId('alpha-tale-chapter-155-eng-li')).toBe('155');
		expect(numberFromId('alpha-tale-chapter-200-5-eng-li')).toBe('200-5');
		expect(numberFromId('not-a-chapter-id')).toBeNull();
	});
});

describe('parseChapter', () => {
	it('extracts page images in order, ignoring decorative ones', async () => {
		const chapter = await parseChapterHtml(READER_HTML, 'alpha-tale-chapter-205-eng-li', BASE);
		// Regression: the old sv2/comic/ filter matched nothing, so this was always [].
		expect(chapter.images).toEqual([
			'https://img.example.test/mg2/alpha/205/01.jpg',
			'https://img.example.test/mg2/alpha/205/02.jpg',
			`${BASE}/mg2/alpha/205/03.jpg`,
		]);
		expect(chapter.page_count).toBe(3);
	});

	it('extracts series and chapter headings', async () => {
		const chapter = await parseChapterHtml(READER_HTML, 'alpha-tale-chapter-205-eng-li', BASE);
		expect(chapter.manhwa_title).toBe("Alpha & Omega's Tale");
		expect(chapter.manhwa_slug).toBe('alpha-tale-x1');
		expect(chapter.chapter_title).toBe('Chapter 205');
	});

	it('extracts neighbours once despite duplicated nav blocks', async () => {
		const chapter = await parseChapterHtml(READER_HTML, 'alpha-tale-chapter-205-eng-li', BASE);
		expect(chapter.prev_chapter_id).toBe('alpha-tale-chapter-204-eng-li');
		expect(chapter.next_chapter_id).toBe('alpha-tale-chapter-206-side-story-eng-li');
	});

	it('reports no images when the image markup changes', async () => {
		const chapter = await parseChapterHtml(READER_HTML_NO_IMAGES, 'alpha-tale-chapter-205-eng-li', BASE);
		// The handler turns this into a 502 rather than a 200 with an empty array.
		expect(chapter.images).toEqual([]);
	});
});
