"use client";
import { useState, type ChangeEvent } from "react";
import { Copy, ImagePlus, Check, Lock, ArrowUpRight } from "lucide-react";
import type { Player } from "@/lib/shared";
import { GAME_INFO, rankFor } from "@/lib/shared";
import { api } from "@/lib/client";
import type { Profile } from "./duelzone";
import { openFriends } from "./platform-center";
export function PlayerAvatar({
  player,
  className = "",
}: {
  player: Player;
  className?: string;
}) {
  return (
    <span
      className={`avatar ${className}`}
      style={{ color: player.accent, background: `${player.accent}15` }}
    >
      {player.avatar ? (
        <img src={player.avatar} alt="" />
      ) : (
        player.username.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
export function ProfileExtras({
  profile,
  own,
  onProfile,
  notify,
  onConnect,
}: {
  profile: Profile;
  own: boolean;
  onConnect: () => void;
  onProfile: (id: string) => void;
  notify: (s: string) => void;
}) {
  const points = profile.rankHistory || [],
    min = Math.min(...points.map((p) => p.rating), profile.rating.rating) - 30,
    max = Math.max(...points.map((p) => p.rating), profile.rating.rating) + 30;
  return (
    <>
      <div className="profile-toolbar">
        <button
          className="button secondary compact"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `${location.origin}/?player=${profile.player.id}#profile`,
              );
              notify("Profile link copied.");
            } catch {
              notify("Could not copy the profile link.");
            }
          }}
        >
          <Copy size={14} /> Share profile
        </button>
        {!own && (
          <button className="button primary compact" onClick={onConnect}>
            Connect & challenge <ArrowUpRight size={15} />
          </button>
        )}
      </div>
      <div className="profile-extra-grid">
        <section>
          <div className="section-heading">
            <h2>Rank over time</h2>
            <span className="small muted">Recorded ranked results</span>
          </div>
          {points.length ? (
            <>
              <svg
                viewBox="0 0 500 140"
                role="img"
                aria-label={`Rating history, ${points.length} results. Latest ${points.at(-1)?.rating} points.`}
                className="rank-chart"
              >
                <path
                  d="M10 120H490M10 65H490M10 10H490"
                  stroke="#333b42"
                  fill="none"
                />
                <polyline
                  fill="none"
                  stroke={profile.player.accent}
                  strokeWidth="2"
                  points={points
                    .map(
                      (p, i) =>
                        `${10 + (i / Math.max(1, points.length - 1)) * 480},${120 - ((p.rating - min) / (max - min)) * 110}`,
                    )
                    .join(" ")}
                />
                {points.map((p, i) => (
                  <circle
                    key={i}
                    cx={10 + (i / Math.max(1, points.length - 1)) * 480}
                    cy={120 - ((p.rating - min) / (max - min)) * 110}
                    r="3"
                    fill={profile.player.accent}
                  >
                    <title>
                      {new Date(p.created_at).toLocaleDateString()} · {p.rating}{" "}
                      RP · {p.season_id}
                    </title>
                  </circle>
                ))}
              </svg>
              <p className="small muted">
                {points[0].rating} → {points.at(-1)?.rating} RP · Last{" "}
                {points.length} ranked results
              </p>
            </>
          ) : (
            <p className="dashboard-empty">
              Complete a ranked match to start this timeline.
            </p>
          )}
          <div className="season-history">
            {profile.seasons
              ?.filter((s) => s.games > 0)
              .map((s) => (
                <div key={s.season_id}>
                  <span>{s.season_id}</span>
                  <b>
                    {rankFor(s.rating).name} · {s.rating} RP
                  </b>
                  <small>
                    {s.wins} wins / {s.games} matches
                  </small>
                </div>
              ))}
          </div>
        </section>
        <section>
          <div className="section-heading">
            <h2>Favorite disciplines</h2>
          </div>
          <div className="profile-favorites">
            {profile.favorites?.length ? (
              profile.favorites.map((g) => (
                <span key={g}>{GAME_INFO[g].name}</span>
              ))
            ) : (
              <p className="dashboard-empty">No favorites selected yet.</p>
            )}
          </div>
        </section>
      </div>
      <section className="profile-rivalries">
        <div className="section-heading">
          <h2>Built on rivalries</h2>
          <span className="small muted">Head-to-head results</span>
        </div>
        {profile.rivals?.length ? (
          <div>
            {profile.rivals.map((r) => (
              <button key={r.id} onClick={() => onProfile(r.id)}>
                <span className="avatar" style={{ color: r.accent }}>
                  {r.username.slice(0, 2)}
                </span>
                <span>
                  <b>{r.username}</b>
                  <small>
                    {r.played} duels · {r.played - r.wins - r.losses} draws
                  </small>
                </span>
                <strong>
                  {r.wins}
                  <small> W</small> — {r.losses}
                  <small> L</small>
                </strong>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        ) : (
          <p className="dashboard-empty">
            Face the same rival again to build your shared story.
          </p>
        )}
      </section>
    </>
  );
}
export function ProfileMediaEditor({
  user,
  profile,
  onSave,
  notify,
}: {
  user: Player;
  profile: Profile | null;
  onSave: (p: Player) => void;
  notify: (s: string) => void;
}) {
  const [avatar, setAvatar] = useState<string | undefined>(),
    [banner, setBanner] = useState<string | undefined>(),
    [cosmetic, setCosmetic] = useState(user.cosmetic || "graphite"),
    [busy, setBusy] = useState(false);
  async function file(
    e: ChangeEvent<HTMLInputElement>,
    kind: "avatar" | "banner",
  ) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
      f.size > 8 * 1024 * 1024
    ) {
      notify("Choose a PNG, JPEG or WebP smaller than 8 MB.");
      return;
    }
    const url = URL.createObjectURL(f);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = kind === "avatar" ? 256 : 1200;
      canvas.height = kind === "avatar" ? 256 : 320;
      const context = canvas.getContext("2d")!;
      const scale = Math.max(
        canvas.width / image.width,
        canvas.height / image.height,
      );
      context.drawImage(
        image,
        (canvas.width - image.width * scale) / 2,
        (canvas.height - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
      const value = canvas.toDataURL("image/webp", 0.75);
      if (value.length > (kind === "avatar" ? 110000 : 275000)) {
        notify("That image is too detailed. Try a smaller image.");
        return;
      }
      kind === "avatar" ? setAvatar(value) : setBanner(value);
    } catch {
      notify("That image could not be opened.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const peak = Math.max(
      1000,
      ...(profile?.seasons?.map((s) => s.rating) || []),
    ),
    level = profile?.progression.level || 1;
  return (
    <form
      className="panel settings-form form-stack profile-media-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await api("/profile/media", { avatar, banner, cosmetic });
          onSave(r.player);
          setAvatar(undefined);
          setBanner(undefined);
          notify("Your player identity is saved.");
        } catch (e) {
          notify((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Make it yours</h2>
      <div
        className={`profile-banner cosmetic-${cosmetic}`}
        style={
          (banner ?? user.banner)
            ? { backgroundImage: `url("${banner ?? user.banner}")` }
            : undefined
        }
      >
        <PlayerAvatar
          player={{ ...user, avatar: avatar ?? user.avatar }}
          className="profile-avatar"
        />
      </div>
      <div className="media-upload-grid">
        <label className="button secondary">
          <ImagePlus size={16} /> Custom avatar
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => void file(e, "avatar")}
          />
        </label>
        <label className="button secondary">
          <ImagePlus size={16} /> Custom banner
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => void file(e, "banner")}
          />
        </label>
      </div>
      <p className="small muted">
        PNG, JPEG or WebP · choose images you have permission to use. Images
        appear on your public profile.
      </p>
      <div className="social-inline">
        <button
          type="button"
          className="text-button muted"
          onClick={() => setAvatar("")}
        >
          Remove avatar
        </button>
        <button
          type="button"
          className="text-button muted"
          onClick={() => setBanner("")}
        >
          Remove banner
        </button>
      </div>
      <fieldset className="cosmetic-choices">
        <legend>Earned profile finishes</legend>
        {[
          {
            id: "graphite",
            name: "Graphite",
            hint: "Available to everyone",
            unlocked: true,
          },
          {
            id: "carbon",
            name: "Carbon",
            hint: "Reach level 3",
            unlocked: level >= 3,
          },
          {
            id: "laurel",
            name: "Laurel",
            hint: "Reach Silver in a season",
            unlocked: peak >= 1050,
          },
        ].map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={!c.unlocked}
            aria-pressed={cosmetic === c.id}
            onClick={() => setCosmetic(c.id)}
          >
            {!c.unlocked ? (
              <Lock size={14} />
            ) : cosmetic === c.id ? (
              <Check size={14} />
            ) : null}
            <span>
              {c.name}
              <small>{c.hint}</small>
            </span>
          </button>
        ))}
      </fieldset>
      <button className="button primary" disabled={busy}>
        Save appearance <Check size={16} />
      </button>
    </form>
  );
}
