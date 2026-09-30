// Tiny stand-in for a platform icon: a favicon in a circle. Replace with your own brand icons.
const DOMAINS: Record<string, string> = {
  youtube: "youtube.com", threads: "threads.net", instagram: "instagram.com", facebook: "facebook.com",
  twitter: "x.com", linkedin: "linkedin.com", tiktok: "tiktok.com",
};

export function PlatformDot({ platform, size = 20 }: { platform: string; size?: number }) {
  const domain = DOMAINS[platform] ?? `${platform}.com`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt={platform}
      width={size}
      height={size}
      className="rounded-full bg-white object-contain p-[2px] ring-1 ring-black/[.12]"
    />
  );
}
