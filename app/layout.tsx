import type { Metadata } from "next";
import "./globals.css";
import "./light.css";
export const metadata: Metadata = { title: "SocialAtlas — A world of people. Connected.", description: "Discover the public profiles behind the people you follow. Explore their social universe with evidence-led account discovery." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;
}
