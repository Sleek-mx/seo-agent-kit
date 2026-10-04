// One-off (re-runnable): add your YouTube channel link to every published blog post that
// has none, just above the closing CTA section. Dry run by default; --apply to write.
//
//   node --env-file=.env .claude/skills/seo-engine/scripts/add-youtube-links.mjs [--apply]
import { listArticles, cosApi, closeDb, CONFIG } from "./lib.mjs";

const APPLY = process.argv.includes("--apply");
const YT = CONFIG.youtube_channel;
if (!YT) { console.error("set youtube_channel in seo.config.json"); process.exit(1); }
const block = `<p>Prefer to watch? The <a href="${YT}">YouTube channel</a> walks through builds like this one, start to finish.</p>\n`;
const needle = YT.replace(/^https?:\/\/(www\.)?/, "");

const arts = (await listArticles()).filter((a) => /publish/.test(a.status || "publish"));
let n = 0;
for (const a of arts) {
  const full = await cosApi("GET", `/v1/blog/articles/${a.id}`);
  const html = (full.article ?? full).bodyHtml || "";
  if (html.includes(needle)) continue;
  const heads = [...html.matchAll(/<h2[^>]*>/gi)];
  const cta = heads.reverse().find((m) => /get started|try it|start |sign up|create your/i.test(html.slice(m.index, m.index + 120))) || heads[0];
  const at = cta ? cta.index : html.length;
  n++;
  console.log(`${APPLY ? "patch" : "would patch"} #${a.id} ${a.slug}`);
  if (APPLY) await cosApi("PATCH", `/v1/blog/articles/${a.id}`, { bodyHtml: html.slice(0, at) + block + html.slice(at) });
}
console.log(`${n} of ${arts.length} posts ${APPLY ? "patched" : "need a YouTube link"}`);
await closeDb();
