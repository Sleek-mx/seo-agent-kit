// JSON-LD for a blog article page: BlogPosting + BreadcrumbList, plus FAQPage when the post has a
// FAQ section. Render with:
//   <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd(post)) }} />
import { decodeEntities, type BlogPost } from './wp-blog';

const SITE = (process.env.SITE_URL ?? 'https://www.example.com').replace(/\/$/, '');
const ORG = { '@type': 'Organization', name: 'Your Product', url: SITE };

/** Q&A pairs from the post's FAQ section: the <h3> questions (and their answers up to the next
 *  heading) under an <h2> that says FAQ / frequently asked / questions. */
export function extractFaq(html: string): { q: string; a: string }[] {
  const text = (h: string) => decodeEntities(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const sec = html.match(/<h2[^>]*>[^<]*(?:FAQ|frequently asked|questions)[^<]*<\/h2>([\s\S]*?)(?=<h2|$)/i);
  if (!sec) return [];
  const out: { q: string; a: string }[] = [];
  for (const m of sec[1].matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|$)/gi)) {
    const q = text(m[1]), a = text(m[2]);
    if (q && a) out.push({ q, a: a.slice(0, 1000) });
  }
  return out.slice(0, 10);
}

export function articleJsonLd(post: BlogPost): Record<string, unknown>[] {
  const url = `${SITE}/blog/${post.slug}/`;
  const ld: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: post.title, description: post.excerpt, image: post.cover ?? undefined,
      datePublished: post.date, dateModified: post.modified, mainEntityOfPage: url, keywords: post.tags.join(', '),
      author: ORG, publisher: ORG,
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: ORG.name, item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog/` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    },
  ];
  const faq = extractFaq(post.html);
  if (faq.length >= 2) {
    ld.push({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    });
  }
  return ld;
}
