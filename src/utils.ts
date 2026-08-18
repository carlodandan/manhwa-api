// src/utils.ts

export const BASE_URL = 'https://www.mgeko.cc';

/**
 * Remove HTML tags, collapse whitespace, and trim.
 */
export function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert a possibly relative URL to an absolute one using BASE_URL.
 */
export function absoluteUrl(path: string): string {
  return new URL(path, BASE_URL).toString();
}