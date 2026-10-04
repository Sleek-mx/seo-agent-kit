import { listPosts } from './wp-blog';

// llms.txt (https://llmstxt.org): a plain-text map of your site for AI assistants and answer engines
// (ChatGPT, Claude, Perplexity, Copilot). Generated on request from the live post list, so every new
// blog post appears here automatically. llms-full.txt adds the full text of every article.
const SITE = (process.env.SITE_URL ?? 'https://www.example.com').replace(/\/$/, '');
const NAME = 'Your Product';
const SUMMARY = 'One paragraph: what the product does, for whom, where it runs, and the starting price. Facts only.';

// Your key pages. Add docs pages here (or generate them from your docs route list).
const PAGES: [string, string, string][] = [
  ['Home', '/', 'what it is, pricing, sign up'],
  ['Sign up', '/sign-up', 'create an account'],
  ['Docs', '/docs', 'setup and API reference'],
];

export async function buildLlmsTxt(full: boolean): Promise<string> {
  const posts = await listPosts();
  const out: string[] = [`# ${NAME}`, '', `> ${SUMMARY}`, '', '## Start here', ''];
  for (const [title, path, note] of PAGES) out.push(`- [${title}](${SITE}${path}): ${note}`);
  out.push('', '## Blog', '');
  for (const p of posts) out.push(`- [${p.title}](${SITE}/blog/${p.slug}/)${p.excerpt ? `: ${p.excerpt}` : ''}`);
  if (full) {
    out.push('', '## Blog articles (full text)', '');
    for (const p of posts) {
      const text = p.html
        .replace(/<figure[\s\S]*?<\/figure>/gi, '')
        .replace(/<h2[^>]*>/gi, '\n### ').replace(/<h3[^>]*>/gi, '\n#### ')
        .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/(p|h2|h3|pre|ul|ol)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
        .replace(/\n{3,}/g, '\n\n').trim();
      out.push(`## ${p.title}`, '', `Source: ${SITE}/blog/${p.slug}/ (updated ${p.modified.slice(0, 10)})`, '', text, '');
    }
  }
  out.push('', '## Optional', '', `- [Sitemap](${SITE}/sitemap.xml)`, `- [Full text of every blog article](${SITE}/llms-full.txt)`);
  return out.join('\n') + '\n';
}
