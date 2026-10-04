// app/sitemap.ts : every blog post is in the sitemap with its real lastModified, so Google and
// Bing re-crawl edited posts. Add your static pages to STATIC.
import type { MetadataRoute } from 'next';
import { listPosts } from '@/lib/wp-blog';

const SITE = (process.env.SITE_URL ?? 'https://www.example.com').replace(/\/$/, '');
const STATIC = ['/', '/sign-up', '/docs', '/blog/'];
export const revalidate = 600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await listPosts();
  return [
    ...STATIC.map((p) => ({ url: `${SITE}${p}`, changeFrequency: 'weekly' as const, priority: p === '/' ? 1 : 0.7 })),
    ...posts.map((p) => ({ url: `${SITE}/blog/${p.slug}/`, lastModified: p.modified, changeFrequency: 'monthly' as const, priority: 0.6 })),
  ];
}
