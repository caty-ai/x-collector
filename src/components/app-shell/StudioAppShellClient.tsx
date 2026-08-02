"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import StudioAuthControls from "@/components/auth/StudioAuthControls";
import { Headline } from "@/components/ui/Headline";

type StudioAppShellClientProps = {
  title: string;
  description: string;
  masthead: string;
  productName: string;
  productSlug: string;
  children?: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  aliases?: string[];
};

type ThemeMode = "light" | "dark";

export default function StudioAppShellClient({
  title,
  description,
  masthead,
  productName,
  productSlug,
  children,
}: StudioAppShellClientProps) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = useMemo<NavItem[]>(
    () => [
      { href: "/feed", label: "フィード", aliases: ["/"] },
      { href: "/calendar", label: masthead },
      {
        href: "/settings",
        label: "設定",
        aliases: [
          "/sources",
          "/alert-sources",
          "/fb-sources",
          "/ig-sources",
          "/reddit-sources",
          "/qiita-sources",
          "/gh-sources",
          "/candidates",
        ],
      },
      { href: "/admin", label: "管理" },
    ],
    [masthead],
  );

  const routeLabels = useMemo<Record<string, string>>(
    () => ({
      "/": "フィード",
      "/feed": "フィード",
      "/calendar": masthead,
      "/settings": "設定",
      "/sources": "設定",
      "/alert-sources": "設定",
      "/fb-sources": "設定",
      "/ig-sources": "設定",
      "/reddit-sources": "設定",
      "/qiita-sources": "設定",
      "/gh-sources": "設定",
      "/candidates": "設定",
      "/explorer": "エクスプローラー",
      "/admin": "管理",
    }),
    [masthead],
  );

  useEffect(() => {
    // This key is intentionally brand-independent to preserve existing users' theme preferences.
    const saved = localStorage.getItem("x-collector-theme");
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const initial = saved === "dark" || saved === "light" ? saved : preferred;

    applyTheme(initial);
    setTheme(initial);
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  const breadcrumbItems = useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
      return [{ label: routeLabels["/"], href: "/" }];
    }

    return segments.map((segment, idx) => {
      const href = `/${segments.slice(0, idx + 1).join("/")}`;
      return {
        label: routeLabels[href] ?? segment,
        href,
      };
    });
  }, [pathname, routeLabels]);

  function applyTheme(nextTheme: ThemeMode) {
    const html = document.documentElement;
    html.classList.toggle("dark", nextTheme === "dark");
    // This key is intentionally brand-independent to preserve existing users' theme preferences.
    localStorage.setItem("x-collector-theme", nextTheme);
  }

  function toggleTheme() {
    const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  function isNavItemActive(item: NavItem) {
    return pathname === item.href || Boolean(item.aliases?.includes(pathname));
  }

  function renderNavLinks(onNavigate?: () => void) {
    return navItems.map((item) => {
      const isActive = isNavItemActive(item);
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className={`border-b px-0 py-3 font-sans text-wired-eyebrow font-bold uppercase tracking-widest transition-colors ${
            isActive
              ? "border-link text-paper"
              : "border-transparent text-paper/70 hover:border-hairline hover:text-paper"
          }`}
        >
          {item.label}
        </Link>
      );
    });
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      {isMobileMenuOpen && (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="fixed inset-0 z-30 bg-black/45"
            onClick={() => setIsMobileMenuOpen(false)}
          />

          <aside
            id="mobile-nav-drawer"
            className="fixed inset-y-0 left-0 z-40 flex w-72 max-w-[86vw] flex-col border-r border-ink bg-ink p-5 text-paper"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-sans text-wired-eyebrow font-bold uppercase tracking-widest text-paper/70">Studio Admin</p>
                <h2 className="mt-1 font-wired-serif text-wired-display-sm font-normal text-paper">{productSlug}</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="border border-hairline bg-ink px-2 py-1 font-sans text-wired-meta font-bold uppercase text-paper"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>

            <nav className="mt-6 flex flex-1 flex-col gap-1">{renderNavLinks(() => setIsMobileMenuOpen(false))}</nav>
          </aside>
        </div>
      )}

      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="hidden w-64 flex-col border-r border-ink bg-ink p-5 text-paper lg:flex">
          <p className="font-sans text-wired-eyebrow font-bold uppercase tracking-widest text-paper/70">Studio Admin</p>
          <h1 className="mt-2 font-wired-serif text-wired-display-md font-normal text-paper">{productSlug}</h1>

          <nav className="mt-8 flex flex-1 flex-col gap-1">{renderNavLinks()}</nav>

          <p className="font-sans text-wired-meta uppercase tracking-widest text-paper/60">{productName} v1</p>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-hairline bg-paper px-4 py-3 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="border border-ink bg-paper px-2 py-1 font-sans text-wired-meta font-bold uppercase lg:hidden"
                onClick={() => setIsMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                aria-controls="mobile-nav-drawer"
                aria-expanded={isMobileMenuOpen}
              >
                ☰
              </button>

              <div className="border border-hairline bg-paper px-2 py-1 font-sans text-wired-meta font-bold uppercase lg:hidden">Studio</div>
              <div className="flex-1">
                <p className="font-sans text-wired-eyebrow font-bold uppercase tracking-widest text-ink-soft">App Shell</p>
                <Headline level="sm" as="h2">
                  {title}
                </Headline>
              </div>

              <button
                type="button"
                onClick={toggleTheme}
                className="border border-ink bg-paper px-3 py-1.5 font-sans text-wired-meta font-bold uppercase"
                aria-label="Toggle dark mode"
              >
                {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
              </button>

              <StudioAuthControls />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
              <span className="font-bold">Breadcrumb:</span>
              {breadcrumbItems.map((item, idx) => (
                <span key={item.href} className="inline-flex items-center gap-1">
                  {idx > 0 && <span>/</span>}
                  <Link href={item.href} className="text-link underline decoration-link underline-offset-4">
                    {item.label.replace(/-/g, " ")}
                  </Link>
                </span>
              ))}
            </div>
          </header>

          <main className="flex-1 bg-paper px-4 py-6 lg:px-8">
            <section className="border border-hairline bg-paper p-6">
              <p className="font-sans text-wired-meta uppercase tracking-widest text-ink-soft">{description}</p>
              <div className="mt-5">{children}</div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
