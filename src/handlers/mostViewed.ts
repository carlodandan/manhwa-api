// src/handlers/mostViewed.ts

import { BASE_URL, absoluteUrl } from '../utils';

/**
 * Fetch the most-viewed webtoon list for a given period.
 */
export async function fetchMostViewed(period: string): Promise<any> {
  const url = `${BASE_URL}/api/most-viewed/?period=${period}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch most-viewed (${period}): ${response.status}`);
  }

  const data = await response.json();

  // Normalize cover_url to absolute
  if (data.webtoon && Array.isArray(data.webtoon)) {
    data.webtoon = data.webtoon.map((webtoon: any) => ({
      ...webtoon,
      cover_url: absoluteUrl(webtoon.cover_url),
    }));
  }

  return data;
}

/**
 * Fetch all three periods concurrently.
 */
export async function fetchAllMostViewed(): Promise<Record<string, any>> {
  const [day, week, month] = await Promise.all([
    fetchMostViewed('1d'),
    fetchMostViewed('1w'),
    fetchMostViewed('1m'),
  ]);

  return {
    '1d': day,
    '1w': week,
    '1m': month,
  };
}