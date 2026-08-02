export const SETTINGS_TABS = [
  { id: "twitter", label: "𝕏 Twitter", icon: "📡" },
  { id: "instagram", label: "Instagram", icon: "📸" },
  { id: "facebook", label: "Facebook", icon: "📘" },
  { id: "reddit", label: "Reddit", icon: "🟠" },
  { id: "qiita", label: "Qiita", icon: "📝" },
  { id: "github", label: "GitHub", icon: "🐙" },
  { id: "alerts", label: "Alerts / RSS / YouTube", icon: "📰" },
  { id: "candidates", label: "候補発見", icon: "🔍" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

const TAB_IDS = new Set<string>(SETTINGS_TABS.map((tab) => tab.id));

export function normalizeSettingsTab(raw: string | null | undefined): SettingsTabId {
  if (raw && TAB_IDS.has(raw)) {
    return raw as SettingsTabId;
  }

  return "twitter";
}
