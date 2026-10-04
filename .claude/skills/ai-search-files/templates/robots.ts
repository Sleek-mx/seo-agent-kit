// app/robots.ts : let search and AI crawlers in, point them at the sitemap and llms.txt.
import type { MetadataRoute } from 'next';

const SITE = (process.env.SITE_URL ?? 'https://www.example.com').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/', '/dashboard/'] },
      // AI crawlers: allowed explicitly so a blanket rule elsewhere never blocks them.
      { userAgent: ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Bingbot'], allow: '/' },
    ],
    sitemap: [`${SITE}/sitemap.xml`],
    host: SITE,
  };
}
