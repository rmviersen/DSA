import Link from "next/link";
import "./globals.css";

export const metadata = { title: "DSA" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <strong>DSA</strong>
          <Link href="/players">Top Players</Link>
          <Link href="/prospects">Top Prospects</Link>
          <Link href="/draft">Top Draftees</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
