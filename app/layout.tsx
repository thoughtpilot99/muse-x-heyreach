import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { config, missingKeys } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ReachGuard",
  description: "Safe LinkedIn outreach for agencies: HeyReach sends, Muse Wonder guards accounts and answers replies.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/inbox", label: "Inbox" },
  { href: "/leads", label: "Leads" },
  { href: "/accounts", label: "Account safety" },
  { href: "/clients", label: "Clients" },
  { href: "/reports", label: "Reports" },
  { href: "/events", label: "Events" },
  { href: "/settings", label: "Settings" },
  { href: "/setup", label: "Setup" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  const missing = missingKeys();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold">
              Reach<span className="text-accent">Guard</span>
            </Link>
            <nav className="flex flex-wrap gap-4 text-sm text-muted">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-foreground">{n.label}</Link>
              ))}
            </nav>
          </div>
        </header>
        {missing.length > 0 && (
          <div className="border-b border-amber-500/40 bg-amber-500/10">
            <div className="mx-auto max-w-6xl px-4 py-2 text-sm">
              <strong>Not connected yet:</strong> connect {missing.map((m) => m.label).join(", ")} on the{" "}
              <Link href="/setup" className="underline">Setup</Link> page to start.
            </div>
          </div>
        )}
        {missing.length === 0 && !config.liveEnabled() && (
          <div className="border-b border-line bg-subtle">
            <div className="mx-auto max-w-6xl px-4 py-2 text-sm text-muted">
              <strong className="text-foreground">Live mode is off.</strong> ReachGuard drafts and checks everything, but adds nothing to HeyReach
              and sends no message until you turn live mode on in <Link href="/setup" className="underline">Setup</Link>.
            </div>
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
