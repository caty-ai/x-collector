import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

import { isAdminEmailAllowed, isAdminRoute, maskEmailForLog } from "@/lib/auth/admin";
import { authSecret } from "@/lib/auth/options";
import { SHARED_COOKIE_NAME, verifySharedCookie } from "@/lib/auth/shared-newspaper";

export default withAuth(
  async (req) => {
    const pathname = req.nextUrl.pathname;

    if (pathname === "/calendar" || pathname.startsWith("/calendar/")) {
      if (req.nextauth.token) return NextResponse.next();

      const hasSharedAccess = await verifySharedCookie(req.cookies.get(SHARED_COOKIE_NAME)?.value);
      if (hasSharedAccess) return NextResponse.next();

      return NextResponse.redirect(new URL("/np-login", req.url));
    }

    if (!isAdminRoute(pathname)) return NextResponse.next();

    const email = typeof req.nextauth.token?.email === "string" ? req.nextauth.token.email : null;
    const allowed = isAdminEmailAllowed(email);

    if (allowed) return NextResponse.next();

    console.warn(
      `[auth-admin] deny path=${pathname} email=${maskEmailForLog(email)} reason=allowlist_miss_or_unconfigured`,
    );

    if (pathname.startsWith("/api/admin/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return new NextResponse("Forbidden", { status: 403 });
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
