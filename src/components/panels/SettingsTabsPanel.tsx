"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SETTINGS_TABS, SettingsTabId } from "@/lib/settings-tabs";

const XTwitterPanel = dynamic(() => import("@/components/panels/XTwitterPanel"), { ssr: false });
const IgSourcesPanel = dynamic(() => import("@/components/panels/IgSourcesPanel"), { ssr: false });
const FbSourcesPanel = dynamic(() => import("@/components/panels/FbSourcesPanel"), { ssr: false });
const RedditSourcesPanel = dynamic(() => import("@/components/panels/RedditSourcesPanel"), { ssr: false });
const QiitaSourcesPanel = dynamic(() => import("@/components/panels/QiitaSourcesPanel"), { ssr: false });
const GhSourcesPanel = dynamic(() => import("@/components/panels/GhSourcesPanel"), { ssr: false });
const AlertSourcesPanel = dynamic(() => import("@/components/panels/AlertSourcesPanel"), { ssr: false });
const CandidatesPanel = dynamic(() => import("@/components/panels/CandidatesPanel"), { ssr: false });

type SettingsTabsPanelProps = {
  initialTab: SettingsTabId;
};

export default function SettingsTabsPanel({ initialTab }: SettingsTabsPanelProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  function handleTabChange(nextTab: SettingsTabId) {
    setActiveTab(nextTab);
    router.replace(`/settings?tab=${nextTab}`, { scroll: false });
  }

  return (
    <>
      <div className="border-b border-hairline">
        <div className="-mb-px flex flex-wrap gap-4">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b px-0 py-3 font-sans text-wired-eyebrow font-bold uppercase tracking-widest transition-colors ${
                activeTab === tab.id
                  ? "border-link text-ink"
                  : "border-transparent text-ink-soft hover:border-hairline hover:text-ink"
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {activeTab === "twitter" && <XTwitterPanel />}
        {activeTab === "instagram" && <IgSourcesPanel />}
        {activeTab === "facebook" && <FbSourcesPanel />}
        {activeTab === "reddit" && <RedditSourcesPanel />}
        {activeTab === "qiita" && <QiitaSourcesPanel />}
        {activeTab === "github" && <GhSourcesPanel />}
        {activeTab === "alerts" && <AlertSourcesPanel />}
        {activeTab === "candidates" && <CandidatesPanel />}
      </div>
    </>
  );
}
