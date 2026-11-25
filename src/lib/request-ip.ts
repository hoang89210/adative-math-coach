/**
 * Client IP for rate limits. Prefer platform-provided headers; if only
 * X-Forwarded-For is present, use the last hop (the first hop is client-spoofable).
 */
export function getClientIp(request: Request): string {
  const vercel = firstHop(request.headers.get("x-vercel-forwarded-for"));
  if (vercel) return vercel;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }

  return "unknown";
}

function firstHop(header: string | null): string | null {
  if (!header) return null;
  const hop = header.split(",")[0]?.trim();
  return hop || null;
}
