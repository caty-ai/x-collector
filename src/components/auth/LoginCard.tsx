"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect } from "react";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { Headline } from "@/components/ui/Headline";
import { Rule } from "@/components/ui/Rule";
import { WiredButton } from "@/components/ui/WiredButton";

type LoginCardProps = {
  callbackUrl: string;
};

export default function LoginCard({ callbackUrl }: LoginCardProps) {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(callbackUrl);
    }
  }, [callbackUrl, router, status]);

  return (
    <section className="grid w-full gap-5 border border-hairline bg-paper p-6 text-ink">
      <div>
        <Eyebrow>Auth.js · Google OAuth</Eyebrow>
        <Headline level="sm" as="h1" className="mt-2">
          Login
        </Headline>
      </div>
      <Rule />
      <p className="font-sans text-sm text-ink-soft">
        Sign in with your Google account to access protected routes: /calendar, /explorer, /sources, /admin.
      </p>

      <div className="flex flex-wrap gap-2">
        {session?.user ? (
          <>
            <WiredButton
              type="button"
              onClick={() => router.replace(callbackUrl)}
            >
              Continue
            </WiredButton>
            <WiredButton
              variant="outline"
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              Logout
            </WiredButton>
          </>
        ) : (
          <WiredButton
            type="button"
            disabled={status === "loading"}
            onClick={() => signIn("google", { callbackUrl })}
            className="disabled:opacity-70"
          >
            {status === "loading" ? "Checking session..." : "Continue with Google"}
          </WiredButton>
        )}

        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center border border-ink bg-paper px-5 py-3 font-sans text-wired-button-md font-bold uppercase text-ink"
        >
          Back
        </Link>
      </div>
    </section>
  );
}
