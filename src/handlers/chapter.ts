// src/handlers/chapter.ts

import { BASE_URL, cleanText, absoluteUrl } from '../utils';

/**
 * Parse chapter HTML and extract structured data.
 */
export function parseChapterHtml(html: string): any {
  const result: any = {};

  // Manhwa title (inside <h1>)
  const titleMatch = html.match(/<h1>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
  if (titleMatch) {
    result.manhwa_title = cleanText(titleMatch[1]);
  }

  // Chapter title (inside <h2>)
  const chapterTitleMatch = html.match(/<h2>([\s\S]*?)<\/h2>/);
  if (chapterTitleMatch) {
    result.chapter_title = cleanText(chapterTitleMatch[1]);
  }

  // Navigation: find the bottom chapternav (there are two)
  const navBlocks = html.match(/<div class="chapternav skiptranslate"[\s\S]*?<\/div>/g);
  if (navBlocks && navBlocks.length >= 2) {
    const bottomNav = navBlocks[1]; // bottom one
    const prevMatch = bottomNav.match(/<a[^>]*class="prevchap[^"]*"[^>]*href="([^"]*)"/);
    if (prevMatch) {
      const href = prevMatch[1];
      result.prev_chapter_url = href === '#' ? null : absoluteUrl(href);
    }
    const nextMatch = bottomNav.match(/<a[^>]*class="nextchap[^"]*"[^>]*href="([^"]*)"/);
    if (nextMatch) {
      const href = nextMatch[1];
      result.next_chapter_url = href === '#' ? null : absoluteUrl(href);
    }
  }

  // Chapter list from <select> (use the first one, both have same options)
  const selectMatch = html.match(/<select[^>]*>([\s\S]*?)<\/select>/);
  if (selectMatch) {
    const options = selectMatch[1].match(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g);
    if (options) {
      result.chapters = options.map((opt) => {
        const valMatch = opt.match(/value="([^"]*)"/);
        const textMatch = opt.match(/>([\s\S]*?)<\/option>/);
        return {
          number: textMatch ? cleanText(textMatch[1]).replace(/^Chapter:\s*/, '') : null,
          url: valMatch && valMatch[1] ? absoluteUrl(valMatch[1]) : null,
        };
      }).filter(c => c.url);
    }
  }

  // Images: extract all <img> tags whose src contains "sv2/comic/" (manhwa pages)
  const allImgTags = html.match(/<img[^>]*src="([^"]*)"[^>]*>/g);
  if (allImgTags) {
    const images: string[] = [];
    for (const imgTag of allImgTags) {
      const srcMatch = imgTag.match(/src="([^"]*)"/);
      if (srcMatch) {
        const src = srcMatch[1];
        if (src.includes('sv2/comic/')) {
          images.push(src);
        }
      }
    }
    result.images = images;
  }

  return result;
}

/**
 * Fetch chapter HTML by its full slug-chapter segment.
 */
export async function fetchChapter(slugAndChapter: string): Promise<any> {
  const url = `${BASE_URL}/reader/en/${slugAndChapter}/`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch chapter (${slugAndChapter}): ${response.status}`);
  }

  const html = await response.text();
  return parseChapterHtml(html);
}