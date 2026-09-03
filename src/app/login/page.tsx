import LoginCard from "@/components/auth/LoginCard";

type LoginPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function normalizeCallbackUrl(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function describeLoginError(error: string | undefined): string | null {
  if (!error) return null;
  if (error === "AccessDenied") {
    return "This Google account is not on the allowlist. Ask the administrator to add your address, or sign in with a different account.";
  }
  return "Sign-in failed. Please try again.";
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const callbackUrl = normalizeCallbackUrl(firstSearchParam(searchParams?.callbackUrl));
  const errorMessage = describeLoginError(firstSearchParam(searchParams?.error));

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-8 text-ink">
      <div className="w-full max-w-sm">
        {errorMessage ? (
          <p role="alert" className="mb-4 border border-ink bg-paper p-4 font-sans text-sm text-ink">
            {errorMessage}
          </p>
        ) : null}
        <LoginCard callbackUrl={callbackUrl} />
      </div>
    </main>
  );
}
