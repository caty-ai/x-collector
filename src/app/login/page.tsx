import LoginCard from "@/components/auth/LoginCard";

type LoginPageProps = {
  searchParams?: {
    callbackUrl?: string;
  };
};

function normalizeCallbackUrl(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const callbackUrl = normalizeCallbackUrl(searchParams?.callbackUrl);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-8 text-ink">
      <div className="w-full max-w-sm">
        <LoginCard callbackUrl={callbackUrl} />
      </div>
    </main>
  );
}
