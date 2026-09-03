"use client";

import { useEffect } from "react";

let widgetMountChain: Promise<void> = Promise.resolve();

function removeWidgetDom(script: HTMLScriptElement | null): void {
  script?.remove();
  document.getElementById("askai-widget-root")?.remove();
  document.getElementById("askai-newspaper-overrides")?.remove();
}

function injectNewspaperOverrides(): void {
  if (document.getElementById("askai-newspaper-overrides")) return;

  const style = document.createElement("style");
  style.id = "askai-newspaper-overrides";
  style.textContent = [
    "#askai-widget-root .askai-launcher{border-radius:0;box-shadow:none;border:1px solid #000}",
    "#askai-widget-root .askai-panel{border-radius:0;box-shadow:none;border:1px solid #000;max-height:calc(100dvh - 120px);overflow:auto}",
    "#askai-widget-root .askai-button{border-radius:0}",
  ].join("\n");
  document.head.appendChild(style);
}

type AskAiBannerProps = {
  pageUrl: string;
  question: string;
  label?: string;
};

export function AskAiBanner({
  pageUrl,
  question,
  label = "この日の新聞をAIに聞く",
}: AskAiBannerProps) {
  useEffect(() => {
    let cancelled = false;
    let didLoad = false;
    let script: HTMLScriptElement | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const operation = widgetMountChain
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return;

        document.getElementById("askai-widget-root")?.remove();

        const nextScript = document.createElement("script");
        script = nextScript;
        nextScript.src = "/calendar/ask-ai-widget.js";
        nextScript.async = true;
        nextScript.dataset.revealAfter = "400";
        nextScript.dataset.label = label;
        nextScript.dataset.question = question;
        nextScript.dataset.url = pageUrl;
        nextScript.dataset.color = "#000000";
        nextScript.dataset.position = "right";
        nextScript.dataset.services = "chatgpt,claude,perplexity,gemini";

        const loadOrError = new Promise<void>((resolve) => {
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            if (fallbackTimer !== null) {
              clearTimeout(fallbackTimer);
              fallbackTimer = null;
            }
            resolve();
          };
          nextScript.addEventListener(
            "load",
            () => {
              didLoad = true;
              // A detached script can still execute, so remove DOM it creates after cancellation.
              if (cancelled) removeWidgetDom(nextScript);
              settle();
            },
            { once: true },
          );
          nextScript.addEventListener(
            "error",
            () => {
              if (cancelled) removeWidgetDom(nextScript);
              settle();
            },
            { once: true },
          );
        });
        const fallback = new Promise<void>((resolve) => {
          fallbackTimer = setTimeout(() => {
            fallbackTimer = null;
            resolve();
          }, 5000);
        });

        document.body.appendChild(nextScript);
        await Promise.race([loadOrError, fallback]);

        if (cancelled) {
          removeWidgetDom(nextScript);
          return;
        }
        if (!didLoad) {
          cancelled = true;
          nextScript.remove();
          return;
        }

        injectNewspaperOverrides();
      });

    widgetMountChain = operation;

    return () => {
      cancelled = true;
      // The vendored widget has no unmount API. Its document listeners become inert after the root is removed.
      removeWidgetDom(script);
    };
  }, [label, pageUrl, question]);

  return null;
}
