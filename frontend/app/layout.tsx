import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
});

// Kept city-neutral on purpose: this metadata applies to every route
// (including /petah-tikva), and a demo-specific city name here would leak
// into the active Petah Tikva presentation path via the browser tab/meta
// description regardless of which page is actually showing. Route-specific
// demo context belongs in each page's own content, not shared layout metadata.
export const metadata: Metadata = {
  title: "מרחב תמחור גבאי",
  description: "כלי החלטת תמחור לדירות — ראיות שוק, אסטרטגיה עסקית ומחירון פרויקט",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full`}>
      <body className="min-h-full bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
