import { Eyebrow } from "@/components/ui/Eyebrow";
import { Headline } from "@/components/ui/Headline";
import { Rule } from "@/components/ui/Rule";
import { WiredButton } from "@/components/ui/WiredButton";

type NewspaperLoginPageProps = {
  searchParams?: {
    error?: string;
  };
};

export default function NewspaperLoginPage({ searchParams }: NewspaperLoginPageProps) {
  const hasError = searchParams?.error === "1";

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-8 text-ink">
      <form
        method="POST"
        action="/api/np-login"
        className="grid w-full max-w-sm gap-5 border border-hairline bg-paper p-6"
      >
        <div>
          <Eyebrow>Shared Reader</Eyebrow>
          <Headline level="sm" as="h1" className="mt-2">
            合言葉でログイン
          </Headline>
        </div>
        <Rule />
        {hasError ? (
          <p className="border border-ink p-3 font-sans text-wired-meta font-bold uppercase text-ink">
            IDまたはパスワードが違います
          </p>
        ) : null}
        <label className="grid gap-2 font-sans text-wired-eyebrow font-bold uppercase text-ink">
          <span>ID</span>
          <input
            name="id"
            type="text"
            autoComplete="username"
            required
            className="w-full border border-ink bg-paper px-4 py-3 font-sans text-base font-normal text-ink"
          />
        </label>
        <label className="grid gap-2 font-sans text-wired-eyebrow font-bold uppercase text-ink">
          <span>パスワード</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full border border-ink bg-paper px-4 py-3 font-sans text-base font-normal text-ink"
          />
        </label>
        <WiredButton type="submit" className="w-full">
          送信
        </WiredButton>
      </form>
    </main>
  );
}
