// src/handlers/webtoon.ts

import { BASE_URL, cleanText, absoluteUrl } from '../utils';

/**
 * Parse the webtoon detail HTML and extract structured data.
 */
export function parseWebtoonHtml(html: string): any {
  const result: any = {};

  // Title
  const titleMatch = html.match(/<h1[^>]*class="novel-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/);
  if (titleMatch) result.title = cleanText(titleMatch[1]);

  // Alternative title
  const altTitleMatch = html.match(/<h2[^>]*class="alternative-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/);
  if (altTitleMatch) result.alternative_title = cleanText(altTitleMatch[1]);

  // Author
  const authorMatch = html.match(/<span[^>]*itemprop="author"[^>]*>([\s\S]*?)<\/span>/);
  if (authorMatch) result.author = cleanText(authorMatch[1]);

  // Rating (number and count)
  const ratingMatch = html.match(/<strong>([\d.]+)<span[^>]*>\s*\(([\d,]+)\)\s*<\/span><\/strong>/);
  if (ratingMatch) {
    result.rating = parseFloat(ratingMatch[1]);
    result.rating_count = parseInt(ratingMatch[2].replace(/,/g, ''), 10);
  }

  // Status
  const statusMatch = html.match(/<strong class="(?:ongoing|completed|hiatus|dropped)">([^<]+)<\/strong>/);
  if (statusMatch) result.status = statusMatch[1].trim();

  // Cover image URL
  const coverMatch = html.match(/<img[^>]*class="lazy"[^>]*data-src="([^"]+)"/);
  if (coverMatch) result.cover_url = absoluteUrl(coverMatch[1]);

  // Categories / genres
  const categoriesSection = html.match(/<div class="categories">([\s\S]*?)<\/div>/);
  if (categoriesSection) {
    const genreMatches = categoriesSection[1].matchAll(/<a[^>]*>([^<]+)<\/a>/g);
    const genres: string[] = [];
    for (const match of genreMatches) {
      genres.push(cleanText(match[1]));
    }
    result.genres = genres;
  }

  // Description
  const descMatch = html.match(/<p class="description">([\s\S]*?)<\/p>/);
  if (descMatch) {
    result.description = cleanText(descMatch[1])
      .replace(/The Summary is\s*/, '')
      .trim();
  }

  // Stats: views, bookmarks, chapter count
  const statsSection = html.match(/<div class="header-stats">([\s\S]*?)<\/div>/);
  if (statsSection) {
    const statBlocks = statsSection[1].matchAll(/<span>([\s\S]*?)<\/span>/g);
    for (const block of statBlocks) {
      const strongText = block[1].match(/<strong>([\s\S]*?)<\/strong>/);
      const smallText = block[1].match(/<small>([^<]+)<\/small>/);
      if (strongText && smallText) {
        const label = smallText[1].trim().toLowerCase();
        const value = cleanText(strongText[1]);
        if (label === 'views') result.views = value;
        else if (label === 'bookmarked') result.bookmarks = value;
        else if (label === 'chapters') result.chapter_count = value;
      }
    }
  }

  // Last update
  const updMatch = html.match(/<div class="updinfo">[\s\S]*?<strong>([\s\S]*?)<\/strong>/);
  if (updMatch) result.last_updated = cleanText(updMatch[1]);

  // Chapters
  const chaptersList = html.match(/<ul class="chapter-list"[\s\S]*?<\/ul>/);
  if (chaptersList) {
    const chapterItems = chaptersList[0].matchAll(/<li[^>]*data-chapterno[^>]*>([\s\S]*?)<\/li>/g);
    const chapters: any[] = [];
    for (const item of chapterItems) {
      const block = item[1];
      const linkMatch = block.match(/<a href="([^"]+)"/);
      const numberMatch = block.match(/<div class="chapter-number"[^>]*>\s*([^<]+)/);
      const dateMatch = block.match(/<span class="chapter-stats"[^>]*>([\s\S]*?)<\/span>/);
      if (linkMatch && numberMatch) {
        chapters.push({
          number: cleanText(numberMatch[1]),
          link: absoluteUrl(linkMatch[1]),
          date: dateMatch ? cleanText(dateMatch[1]) : null,
        });
      }
    }
    result.chapters = chapters;
  }

  return result;
}

/**
 * Fetch and parse webtoon details by slug.
 */
export async function fetchWebtoon(slug: string): Promise<any> {
  const webtoonUrl = `${BASE_URL}/webtoon/${slug}/`;
  const response = await fetch(webtoonUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch webtoon (${slug}): ${response.status}`);
  }

  const html = await response.text();
  return parseWebtoonHtml(html);
}