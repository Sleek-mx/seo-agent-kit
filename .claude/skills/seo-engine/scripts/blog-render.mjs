import { readFileSync } from 'node:fs';
import path from 'node:path';

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function inline(value) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+|\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function renderMarkdown(markdown) {
  const blocks = [];
  let paragraph = [];
  let list = [];
  let listType = '';
  let code = [];
  let inCode = false;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push(`<${listType}>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</${listType}>`);
    list = [];
    listType = '';
  };
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (line.trim().startsWith('```')) {
      flushParagraph(); flushList();
      if (inCode) {
        blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      blocks.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const number = line.match(/^\d+\.\s+(.+)$/);
    if (bullet || number) {
      flushParagraph();
      const nextType = bullet ? 'ul' : 'ol';
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      list.push((bullet || number)[1]);
      continue;
    }
    if (line.startsWith('> ')) {
      flushParagraph(); flushList();
      blocks.push(`<blockquote><p>${inline(line.slice(2))}</p></blockquote>`);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph(); flushList();
  if (inCode) throw new Error('Unclosed Markdown code fence');
  return blocks.join('\n');
}

export function renderArticle(worktree, slug, date, draft) {
  const template = readFileSync(path.join(worktree, 'templates/blog-article.html'), 'utf8');
  const values = {
    TITLE: escapeHtml(draft.title.trim()),
    DESCRIPTION: escapeHtml(draft.excerpt.trim()),
    SLUG: slug,
    DATE: date,
    BODY: renderMarkdown(draft.body.trim()),
  };
  for (const key of Object.keys(values)) {
    if (!template.includes(`{{${key}}}`)) throw new Error(`Article template missing {{${key}}}`);
  }
  return template.replace(/{{(TITLE|DESCRIPTION|SLUG|DATE|BODY)}}/g, (_, key) => values[key]);
}

export function updateArchive(indexHtml, slug, date, draft) {
  const marker = /<!-- BLOG_POSTS_START -->([\s\S]*?)<!-- BLOG_POSTS_END -->/;
  const match = indexHtml.match(marker);
  if (!match) throw new Error('Blog archive markers missing');
  const previous = match[1].includes('sa-blog-empty') ? '' : match[1].trim();
  const card = `<article class="sa-blog-card"><div class="sa-blog-card-date">${escapeHtml(date)}</div><h3><a href="/blog/${slug}.html">${escapeHtml(draft.title.trim())}</a></h3><p>${escapeHtml(draft.excerpt.trim())}</p><a class="sa-blog-card-link" href="/blog/${slug}.html">Read guide →</a></article>`;
  return indexHtml.replace(marker, () => `<!-- BLOG_POSTS_START -->\n          ${card}${previous ? `\n          ${previous}` : ''}\n          <!-- BLOG_POSTS_END -->`);
}
