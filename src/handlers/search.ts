// src/handlers/search.ts

import { BASE_URL, cleanText, absoluteUrl } from '../utils';

/**
 * Parse the autocomplete HTML and return manhwa results.
 */
export function parseSearchHtml(html: string): any[] {
  const results: any[] = [];

  // Match each <li class="novel-item"> block
  const itemRegex = /<li class="novel-item">([\s\S]*?)<\/li>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(html)) !== null) {
    const block = match[1];

    // Extract the anchor tag and its attributes
    const anchorMatch = block.match(/<a[^>]*>/);
    if (!anchorMatch) continue;

    const anchorTag = anchorMatch[0];
    const hrefMatch = anchorTag.match(/href="([^"]*)"/);
    const titleAttrMatch = anchorTag.match(/title="([^"]*)"/);

    if (!hrefMatch || !titleAttrMatch) continue;

    const slug = hrefMatch[1].split('/').filter(Boolean).pop() || '';
    const title = titleAttrMatch[1].trim();

    // Cover image
    const imgMatch = block.match(/<img[^>]*src="([^"]*)"/);
    const cover = imgMatch ? imgMatch[1] : null;

    // Stats block
    const strongMatch = block.match(/<strong>([^<]*)<\/strong>/);
    const latestChapter = strongMatch ? cleanText(strongMatch[1]) : null;

    // Last updated: the span that starts with "·"
    const updatedMatch = block.match(/<span>\s*·\s*([^<]*)<\/span>/);
    const lastUpdated = updatedMatch ? cleanText(updatedMatch[1]) : null;

    // Rating
    const ratingMatch = block.match(/<span style="color:#f5a623;">★\s*([^<]*)<\/span>/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1].trim()) : null;

    results.push({
      title,
      slug,
      cover_url: cover ? absoluteUrl(cover) : null,
      latest_chapter: latestChapter,
      last_updated: lastUpdated,
      rating,
    });
  }

  return results;
}

/**
 * Fetch autocomplete suggestions for a search term.
 */
export async function searchManhwa(term: string): Promise<any[]> {
  const url = `${BASE_URL}/autocomplete?term=${encodeURIComponent(term)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Search failed (${term}): ${response.status}`);
  }

  const html = await response.text();
  return parseSearchHtml(html);
}