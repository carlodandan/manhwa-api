// src/handlers/mostViewed.ts

import { BASE_URL, absoluteUrl } from '../utils';

/**
 * Fetch the most-viewed manhwa list for a given period.
 */
export async function fetchMostViewed(period: string): Promise<any> {
  const url = `${BASE_URL}/api/most-viewed/?period=${period}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch most-viewed (${period}): ${response.status}`);
  }

  const data = await response.json();

  // Normalize cover_url to absolute
  if (data.manhwa && Array.isArray(data.manhwa)) {
    data.manhwa = data.manhwa.map((manhwa: any) => ({
      ...manhwa,
      cover_url: absoluteUrl(manhwa.cover_url),
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