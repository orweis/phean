import { CopyButton } from "@/components/ui/copy-button";

/** Share a post: LinkedIn and X in a new tab, or copy its address. */
export function ShareLinks({ url, title }: { url: string; title: string }) {
  const targets = [
    { name: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` },
    { name: "X", href: `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}` },
  ];
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted">Share</span>
      {targets.map(({ name, href }) => (
        <a key={name} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-full bg-fill px-3 text-xs font-semibold text-ink hover:bg-rule">
          {name}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ))}
      <CopyButton value={url} label="Copy link" />
    </div>
  );
}
