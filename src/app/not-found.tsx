import React from "react";
import { getMasthead, getTagline } from "@/lib/masthead";

export function generateMetadata() {
  return { title: getMasthead(), description: getTagline() };
}

export default function NotFound() {
  return (
    <main className="min-h-screen bg-paper px-4 py-12 text-ink">
      <div className="mx-auto max-w-3xl space-y-6">
        <a href="/calendar" className="font-wired-serif text-wired-display-md">{getMasthead()}</a>
        <h1 className="font-wired-serif text-wired-display-sm">記事が見つかりません</h1>
        <p>指定された記事は公開範囲にないか、まだ利用できません。</p>
        <a href="/calendar" className="inline-block border border-ink px-4 py-3">最新号</a>
      </div>
    </main>
  );
}
