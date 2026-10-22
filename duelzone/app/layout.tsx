import type { Metadata } from "next";
import "./globals.css";
import "./competition.css";
import "./experience.css";
import "./social.css";
import "./frontier.css";
import "./platform.css";
import "./identity.css";
export const metadata: Metadata = {
  title: "DuelZone — Find your next rivalry.",
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
      <head>
        <link
          rel="preload"
          href="/fonts/manrope-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
