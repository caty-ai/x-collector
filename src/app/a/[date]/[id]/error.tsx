"use client";

import React, { createContext, useContext } from "react";

const ArticleBrandContext = createContext("");

// The server layout supplies env-driven branding to the client error boundary.
export function ArticleBrandProvider({ masthead, children }: { masthead: string; children: React.ReactNode }) {
  return <ArticleBrandContext.Provider value={masthead}>{children}</ArticleBrandContext.Provider>;
}

// Transient upstream failures and busy admission both retain HTTP 500 (load-shed).
export default function ArticleError() {
  const masthead = useContext(ArticleBrandContext);
  return (
    <main className="min-h-screen bg-paper px-4 py-12 text-ink">
      <div className="mx-auto max-w-3xl space-y-6">
        <a href="/calendar" className="font-wired-serif text-wired-display-md">{masthead}</a>
        <h1 className="font-wired-serif text-wired-display-sm">一時的に表示できません</h1>
        <p>しばらくしてから再試行してください。</p>
        <a href="/calendar" className="inline-block border border-ink px-4 py-3">最新号</a>
      </div>
    </main>
  );
}
