import { PCM_WORKLET_SOURCE } from "@/lib/ai/pcm-worklet";

export const dynamic = "force-static";

export function GET() {
  return new Response(PCM_WORKLET_SOURCE, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" } });
}
