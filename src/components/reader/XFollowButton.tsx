import React from "react";
import Script from "next/script";

export function XFollowButton({ handle }: { handle: string }) {
  return (
    <>
      <div className="flex flex-col items-center gap-2">
        <a href={`https://x.com/intent/follow?screen_name=${encodeURIComponent(handle)}`}
          className="twitter-follow-button inline-flex items-center justify-center border border-ink bg-paper px-4 py-3 font-sans text-wired-eyebrow font-bold uppercase text-ink hover:bg-ink hover:text-paper"
          data-screen-name={handle} data-show-count="false" data-size="large" data-lang="ja"
          target="_blank" rel="noopener noreferrer">@{handle} をフォロー</a>
      </div>
      <Script src="https://platform.x.com/widgets.js" strategy="afterInteractive" charSet="utf-8" />
    </>
  );
}
