import type { Metadata } from "next";
import "./globals.css";
import "./competition.css";
import "./experience.css";
import "./social.css";
import "./frontier.css";
import "./platform.css";
export const metadata: Metadata = {
  title: "DuelZone — Every millisecond matters.",
  description:
    "Physics, tactics and skill. Challenge friends, compete in Showdown and find your edge on DuelZone.",
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
