import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

import { decideTokenAccess, isAdminEmailAllowed, maskEmailForLog } from "@/lib/auth/admin";
import { authSecret } from "@/lib/auth/options";
import {
  decideReaderAccess,
  isNewspaperPublic,
  isReaderPath,
} from "@/lib/auth/public-newspaper";
import { SHARED_COOKIE_NAME, verifySharedCookie } from "@/lib/auth/shared-newspaper";

export default withAuth(
  async (req) => {
    const pathname = req.nextUrl.pathname;
    const email = typeof req.nextauth.token?.email === "string" ? req.nextauth.token.email : null;

    if (isReaderPath(pathname)) {
      const hasToken = req.nextauth.token != null;
      const tokenAllowlisted = hasToken && isAdminEmailAllowed(email);
      const isPublic = isNewspaperPublic();
      const hasSharedCookie =
        !isPublic && !tokenAllowlisted
          ? await verifySharedCookie(req.cookies.get(SHARED_COOKIE_NAME)?.value)
          : false;
      const decision = decideReaderAccess({
        pathname,
        hasToken,
        tokenAllowlisted,
        hasSharedCookie,
        isPublic,
      });

      return decision === "next"
        ? NextResponse.next()
        : NextResponse.redirect(new URL("/np-login", req.url));
    }

    if (pathname === "/np-login") return NextResponse.next();

    const decision = decideTokenAccess({ pathname, email });
    if (decision === "next") return NextResponse.next();

    console.warn(
      `[auth-admin] deny path=${pathname} email=${maskEmailForLog(email)} reason=allowlist_miss_or_unconfigured`,
    );

    if (decision === "forbidden_json") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return new NextResponse(
      "Forbidden: this account is not on the allowlist. Sign out at /api/auth/signout to switch accounts.",
      { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  },
  {
    pages: {
      signIn: "/login",
    },
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;
        if (pathname.startsWith("/api/admin/")) return true;
        if (pathname === "/calendar" || pathname.startsWith("/calendar/") || pathname === "/np-login") {
          return true;
        }
        return Boolean(token);
      },
    },
    secret: authSecret,
  },
);

export const config = {
  matcher: [
    "/api/admin/:path*",
    "/((?!login|api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json)$).*)",
  ],
};
