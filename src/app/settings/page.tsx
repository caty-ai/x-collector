import StudioAppShell from "@/components/app-shell/StudioAppShell";
import SettingsTabsPanel from "@/components/panels/SettingsTabsPanel";
import { normalizeSettingsTab } from "@/lib/settings-tabs";

type SettingsPageProps = {
  searchParams?: {
    tab?: string;
  };
};

export default function SettingsPage({ searchParams }: SettingsPageProps) {
  const initialTab = normalizeSettingsTab(searchParams?.tab);

  return (
    <StudioAppShell
      title="設定 — ソース管理"
      description="各プラットフォームのソース管理・候補発見をここで運用します。"
    >
      <SettingsTabsPanel initialTab={initialTab} />
    </StudioAppShell>
  );
}
