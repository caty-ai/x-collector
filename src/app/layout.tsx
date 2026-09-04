import AuthProvider from "@/components/auth/AuthProvider";

import "./globals.css";
import { PRODUCT_NAME } from "@/lib/branding";

export const metadata = { title: PRODUCT_NAME, description: "AI Tweet Intelligence Dashboard" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-background font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
