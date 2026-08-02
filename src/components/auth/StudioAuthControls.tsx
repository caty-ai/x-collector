"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

import { WiredButton } from "@/components/ui/WiredButton";

export default function StudioAuthControls() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <span className="border border-hairline bg-paper px-3 py-1.5 font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">
        Auth...
      </span>
    );
  }

  if (session?.user) {
    const label = session.user.email || session.user.name || "Signed in";

    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-[220px] truncate font-sans text-wired-meta uppercase tracking-widest text-ink-soft sm:inline">{label}</span>
        <WiredButton
          variant="outline"
          size="compact"
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-wired-meta tracking-widest"
        >
          Logout
        </WiredButton>
      </div>
    );
  }

  return (
    <Link
      href="/login"
      className="border border-ink bg-paper px-3 py-1.5 font-sans text-wired-meta font-bold uppercase tracking-widest text-ink"
    >
      Login
    </Link>
  );
}
