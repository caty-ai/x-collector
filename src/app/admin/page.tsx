import Link from "next/link";

import StudioAppShell from "@/components/app-shell/StudioAppShell";
import { getMasthead } from "@/lib/masthead";

const legacyRedirects = [
  "/sources → /settings",
  "/alert-sources → /settings?tab=alerts",
  "/fb-sources → /settings?tab=facebook",
  "/ig-sources → /settings?tab=instagram",
  "/reddit-sources → /settings?tab=reddit",
  "/qiita-sources → /settings?tab=qiita",
  "/gh-sources → /settings?tab=github",
  "/candidates → /settings?tab=candidates",
];

export default function AdminPage() {
  const canonicalRoutes = [
    { href: "/feed", label: "フィード", detail: "収集データの横断ビュー" },
    { href: "/calendar", label: getMasthead(), detail: "日次ニュース閲覧" },
    { href: "/settings", label: "設定", detail: "ソース管理 / 候補発見" },
    { href: "/explorer", label: "エクスプローラー", detail: "BFF接続確認" },
  ];
  const updatedAt = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  return (
    <StudioAppShell
      title="Admin"
      description="運用ステータスと主要導線を確認する管理ページです。"
    >
      <div className="space-y-6">
        <section className="border border-hairline bg-paper p-4">
          <h3 className="text-sm font-semibold">P0 UI Hardening Status</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>✅ 認証ミドルウェアを主要ルート/旧V1ルートへ拡張</li>
            <li>✅ /settings にソース管理タブを統合</li>
            <li>✅ 主要レガシールートを安全な遷移先へリダイレクト</li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Updated: {updatedAt} JST</p>
        </section>

        <section className="border border-hairline bg-paper p-4">
          <h3 className="text-sm font-semibold">Canonical Routes</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {canonicalRoutes.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className="border border-hairline bg-paper p-3 text-sm hover:border-ink"
              >
                <p className="font-medium">{route.label}</p>
                <p className="text-xs text-muted-foreground">{route.detail}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="border border-hairline bg-paper p-4">
          <h3 className="text-sm font-semibold">Legacy Redirect Map</h3>
          <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            {legacyRedirects.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
    </StudioAppShell>
  );
}
