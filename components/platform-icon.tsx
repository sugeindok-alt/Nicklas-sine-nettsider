import { siTwitch, siYoutube, siInstagram, siTiktok, siX, siKick, siFacebook, siReddit, siThreads, siSnapchat, siDiscord } from "simple-icons";
const icons = { twitch: siTwitch, youtube: siYoutube, instagram: siInstagram, tiktok: siTiktok, x: siX, kick: siKick, facebook: siFacebook, reddit: siReddit, threads: siThreads, snapchat: siSnapchat, discord: siDiscord };
export function PlatformIcon({ id, size = 20 }: { id: string; size?: number }) {
  const icon = icons[id as keyof typeof icons];
  return icon ? <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={icon.path} /></svg> : null;
}
