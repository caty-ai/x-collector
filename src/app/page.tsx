import StudioAppShell from "@/components/app-shell/StudioAppShell";
import FeedListPanel from "@/components/panels/FeedListPanel";

type DashboardHomePageProps = {
  searchParams?: {
    platform?: string;
  };
};

export default function DashboardHomePage({ searchParams }: DashboardHomePageProps) {
  return (
    <StudioAppShell
      title="フィード — 収集データ一覧"
      description="BFF経由で収集データを取得し、プラットフォーム・キーワード・日付（JST）で絞り込みます。"
    >
      <FeedListPanel initialPlatform={searchParams?.platform} />
    </StudioAppShell>
  );
}
