// src/index.ts

import { fetchAllMostViewed } from './handlers/mostViewed';
import { fetchWebtoon } from './handlers/webtoon';
import { fetchChapter } from './handlers/chapter';
import { searchWebtoon } from './handlers/search';

export default {
  async fetch(request: Request): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Only GET
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Root: return available endpoints
    if (path === '/') {
      return jsonResponse({
        endpoints: [
          {
            path: '/home',
            description: 'Most-viewed webtoon (periods: 1d, 1w, 1m)',
          },
          {
            path: '/webtoon/{slug}',
            description: 'Webtoon details by slug',
          },
          {
            path: '/reader/en/{slug}-chapter-{chapterNumber}',
            description: 'Chapter images and metadata',
          },
          {
            path: '/autocomplete?term={query}',
            description: 'Search webtoon by term',
          },
        ],
      }, 200, 3600); // Cache for 1 hour
    }

    // Cache for other endpoints
    const cache = caches.default;
    const cacheKey = new Request(request.url);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      let responseData: any;
      let cacheDuration = 300; // default 5 min

      if (path === '/home') {
        // Home: most-viewed
        responseData = await fetchAllMostViewed();
        cacheDuration = 300;
      } else if (path.startsWith('/webtoon/')) {
        // Webtoon detail
        const slug = path.split('/')[2];
        if (!slug) {
          return jsonResponse({ error: 'Invalid slug' }, 400);
        }
        responseData = await fetchWebtoon(slug);
        cacheDuration = 600;
      } else if (path.startsWith('/reader/en/')) {
        // Chapter reader
        const parts = path.split('/').filter(Boolean);
        if (parts.length < 3) {
          return jsonResponse({ error: 'Invalid chapter URL' }, 400);
        }
        const slugAndChapter = parts.slice(2).join('/');
        responseData = await fetchChapter(slugAndChapter);
        cacheDuration = 3600;
      } else if (path === '/autocomplete') {
        // Search autocomplete
        const term = url.searchParams.get('term') || '';
        responseData = await searchWebtoon(term);
        cacheDuration = 300;
      } else {
        return jsonResponse({ error: 'Not found' }, 404);
      }

      const response = jsonResponse(responseData, 200, cacheDuration);
      await cache.put(cacheKey, response.clone());
      return response;
    } catch (error: any) {
      return jsonResponse(
        { error: error.message || 'Internal server error' },
        500
      );
    }
  },
};

function jsonResponse(data: any, status: number, cacheDuration?: number): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (cacheDuration) {
    headers['Cache-Control'] = `public, max-age=${cacheDuration}`;
  }

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}