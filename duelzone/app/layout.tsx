import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "DuelZone — Every millisecond matters.",
  description:
    "Pure skill. Real opponents. Four fast, competitive 1v1 games. Find your edge on DuelZone.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
