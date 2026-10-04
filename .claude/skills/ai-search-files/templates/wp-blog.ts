// Server-only reads of a WordPress blog through its public REST API, for a Next.js app that renders
// the blog in its own design. Set BLOG_ORIGIN to where wp-json answers (e.g. https://www.example.com
// when WordPress lives at /blog, or https://blog.example.com).
const ORIGIN = (process.env.BLOG_ORIGIN ?? 'https://www.example.com').replace(/\/$/, '');
const WP_PATH = process.env.BLOG_WP_PATH ?? '/blog'; // '' when WordPress is at the origin root
const REVALIDATE = 120;

export type BlogPost = { id: number; slug: string; title: string; excerpt: string; html: string; date: string; modified: string; tags: string[]; cover: string | null };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#8217;|&#039;|&rsquo;/g, '’').replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&ldquo;/g, '“').replace(/&#8221;|&rdquo;/g, '”')
    .replace(/&#8211;|&ndash;/g, '-').replace(/&#8212;|&mdash;/g, '-').replace(/&#8230;|&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
const stripTags = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

type WpPost = {
  id: number; slug: string; date: string; date_gmt?: string; modified: string; modified_gmt?: string;
  title?: { rendered?: string }; excerpt?: { rendered?: string }; content?: { rendered?: string };
  _embedded?: { 'wp:term'?: { taxonomy?: string; name?: string }[][]; 'wp:featuredmedia'?: { source_url?: string }[] };
};

function toPost(p: WpPost): BlogPost {
  return {
    id: p.id, slug: p.slug,
    title: stripTags(p.title?.rendered ?? ''),
    excerpt: stripTags(p.excerpt?.rendered ?? '').replace(/\s*\[…\]\s*$/, '…'),
    html: p.content?.rendered ?? '',
    date: p.date_gmt ? `${p.date_gmt}Z` : p.date,
    modified: p.modified_gmt ? `${p.modified_gmt}Z` : p.modified,
    tags: (p._embedded?.['wp:term'] ?? []).flat().filter((t) => t?.taxonomy === 'post_tag').map((t) => decodeEntities(String(t.name))),
    cover: p._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? null,
  };
}

async function wp(path: string): Promise<WpPost[]> {
  try {
    const res = await fetch(`${ORIGIN}${WP_PATH}/wp-json/wp/v2${path}`, { next: { revalidate: REVALIDATE }, signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as WpPost[]) : [];
  } catch {
    return []; // blog unreachable: render empty, retry on the next revalidation
  }
}

/** Every published post, newest first (pages through 100 at a time). */
export async function listPosts(): Promise<BlogPost[]> {
  const out: BlogPost[] = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await wp(`/posts?per_page=100&page=${page}&_embed=wp:term,wp:featuredmedia`);
    out.push(...batch.map(toPost));
    if (batch.length < 100) break;
  }
  return out;
}

export async function getPost(slug: string): Promise<BlogPost | null> {
  const [p] = await wp(`/posts?slug=${encodeURIComponent(slug)}&_embed=wp:term,wp:featuredmedia`);
  return p ? toPost(p) : null;
}
