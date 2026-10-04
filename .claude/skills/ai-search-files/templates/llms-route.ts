// app/llms.txt/route.ts   (copy to app/llms-full.txt/route.ts too, with buildLlmsTxt(true))
import { buildLlmsTxt } from '@/lib/llms';

export const revalidate = 600;

export async function GET() {
  return new Response(await buildLlmsTxt(false), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
