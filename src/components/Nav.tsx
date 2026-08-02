"use client";

import { usePathname } from "next/navigation";

const contentItems = [
  { href: "/", label: "Tweets" },
  { href: "/alerts", label: "Alerts" },
  { href: "/fb-posts", label: "Facebook" },
  { href: "/reddit-posts", label: "Reddit" },
  { href: "/qiita-items", label: "Qiita" },
  { href: "/gh-items", label: "GitHub" },
  { href: "/ig-posts", label: "Instagram" },
  { href: "/or-models", label: "Models" },
];

export default function Nav() {
  const pathname = usePathname();
  const isSettings = pathname === "/settings";

  return (
    <nav className="mb-8 flex flex-wrap items-center gap-4 border-b border-hairline">
      {contentItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <a
            key={item.href}
            href={item.href}
            className={`border-b px-0 py-3 font-sans text-wired-eyebrow font-bold uppercase tracking-widest transition-colors ${
              isActive
                ? "border-link text-ink"
                : "border-transparent text-ink-soft hover:border-hairline hover:text-ink"
            }`}
          >
            {item.label}
          </a>
        );
      })}
      <div className="flex-1" />
      <a
        href="/settings"
        className={`border-b px-0 py-3 font-sans text-wired-eyebrow font-bold uppercase tracking-widest transition-colors ${
          isSettings
            ? "border-link text-ink"
            : "border-transparent text-ink-soft hover:border-hairline hover:text-ink"
        }`}
      >
        設定
      </a>
    </nav>
  );
}
