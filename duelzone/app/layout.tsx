import type { Metadata } from "next";
import "./globals.css";
import "./competition.css";
import "./experience.css";
import "./social.css";
export const metadata: Metadata = {
  title: "DuelZone — Every millisecond matters.",
  description:
    "Nine skill-based multiplayer games. Dodge, capture, aim and outthink your rival. Find your edge on DuelZone.",
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
