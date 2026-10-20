"use client";
import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { ArrowUpRight, ArrowRight, Search, Bookmark, X, Globe2, Scan, Layers3, Link2, Check, Clock3, LoaderCircle, SlidersHorizontal, Compass, ShieldCheck, RotateCcw, CircleHelp } from "lucide-react";
import { platforms, type Discovery, type Account } from "@/lib/discovery";
import { PlatformIcon } from "./platform-icon";

type View = "discover" | "saved";
function readList(key: string): string[] {
  try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value.filter(v => typeof v === "string").slice(0, 20) : []; } catch { return []; }
}
function Orbit({ accounts, label, decorative = false }: { accounts?: Account[]; label?: string; decorative?: boolean }) {
  const nodes = decorative ? platforms.slice(0, 8).map(p => ({ platform: p.id, username: p.name, url: "" })) : accounts || [];
  const ref = useRef<HTMLDivElement>(null);
  return <div className={`orbit ${decorative ? "decorative" : "result-orbit"}`} ref={ref} onPointerMove={e => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    ref.current?.style.setProperty("--mx", `${(e.clientX - r.left - r.width / 2) * .025}px`);
    ref.current?.style.setProperty("--my", `${(e.clientY - r.top - r.height / 2) * .025}px`);
  }} onPointerLeave={() => { ref.current?.style.setProperty("--mx", "0px"); ref.current?.style.setProperty("--my", "0px"); }}>
    <div className="orbit-ring orbit-inner" /><div className="orbit-ring orbit-middle" /><div className="orbit-ring orbit-outer" />
    <div className="axis axis-x" /><div className="axis axis-y" />
    <svg className="connections" viewBox="0 0 600 420" preserveAspectRatio="none" aria-hidden="true">
      {nodes.map((n, i) => { const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2; return <g key={`${n.platform}-${i}`}><line x1="300" y1="210" x2={300 + Math.cos(angle) * 222} y2={210 + Math.sin(angle) * 154} stroke="currentColor" strokeDasharray={i % 2 ? "3 6" : undefined} /><circle r="2.5" fill="#9d8bfa"><animateMotion dur={`${5 + i}s`} repeatCount="indefinite" path={`M300,210 L${300 + Math.cos(angle) * 222},${210 + Math.sin(angle) * 154}`} /></circle></g>; })}
    </svg>
    <div className="orbit-core"><div className="core-mark"><Scan size={28} /></div><span>{label || "Your next discovery"}</span><small>{decorative ? "ONE SEARCH. EVERY CONNECTION." : `${nodes.length} PUBLIC PROFILES`}</small></div>
    {nodes.map((n, i) => { const angle = i / nodes.length * Math.PI * 2 - Math.PI / 2; const p = platforms.find(p => p.id === n.platform)!; const style = { left: `${50 + Math.cos(angle) * 37}%`, top: `${50 + Math.sin(angle) * 36.7}%`, "--platform": p.color, "--delay": `${i * -.7}s` } as CSSProperties;
      return decorative ? <div key={n.platform} className="orbit-node" style={style}><PlatformIcon id={n.platform} size={23} /><span>{p.name}</span></div> : <a key={n.url} className="orbit-node" style={style} href={n.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.name}: ${n.username}`}><PlatformIcon id={n.platform} size={23} /><span>@{n.username}</span></a>;
    })}
    <span className="orbit-coordinate coordinate-a">ATLAS / 001</span><span className="orbit-coordinate coordinate-b">CONNECTED BY CURIOSITY</span>
  </div>;
}
export default function Atlas() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Discovery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [view, setView] = useState<View>("discover");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const suggestions = recent.filter(q => q.toLowerCase().includes(query.toLowerCase()) && q.toLowerCase() !== query.toLowerCase()).slice(0, 4);
  useEffect(() => {
    setRecent(readList("atlas-recent")); setSaved(readList("atlas-saved"));
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) { setQuery(q); void search(q); }
    const pop = () => { const value = new URLSearchParams(window.location.search).get("q"); if (value) { setQuery(value); void search(value, false); } else { controller.current?.abort(); requestId.current++; setLoading(false); setResult(null); setError(null); setQuery(""); } };
    window.addEventListener("popstate", pop);
    return () => { controller.current?.abort(); window.removeEventListener("popstate", pop); };
    // The initial URL is read once; later navigation uses popstate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 3200); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { if (modal) dialog.current?.showModal(); else dialog.current?.close(); }, [modal]);
  function persist(key: string, values: string[]) { try { localStorage.setItem(key, JSON.stringify(values)); } catch { setToast("Browser storage is unavailable. Changes will last for this session."); } }
  async function search(value: string, updateUrl = true) {
    const q = value.trim().replace(/^@/, "");
    if (q.length < 2 || q.length > 80) { setError({ message: "Enter a name or username between 2 and 80 characters." }); return; }
    controller.current?.abort(); controller.current = new AbortController();
    const id = ++requestId.current;
    setQuery(q); setFocused(false); setView("discover"); setLoading(true); setError(null); setResult(null); setFilter("all"); setSelected([]); setConfirmed(false);
    if (updateUrl) window.history.pushState({}, "", `/?q=${encodeURIComponent(q)}`);
    const next = [q, ...readList("atlas-recent").filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    setRecent(next); persist("atlas-recent", next);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.current.signal });
      const data = await response.json() as Discovery & { error?: string; code?: string };
      if (id !== requestId.current) return;
      if (!response.ok) setError({ message: data.error || "Something interrupted discovery.", code: data.code });
      else setResult(data);
    } catch (e) { if (id === requestId.current && !(e instanceof Error && e.name === "AbortError")) setError({ message: "We couldn’t reach SocialAtlas. Check your connection and try again." }); }
    finally { if (id === requestId.current) setLoading(false); }
  }
  function home() { controller.current?.abort(); requestId.current++; setLoading(false); setView("discover"); setResult(null); setError(null); setQuery(""); window.history.pushState({}, "", "/"); }
  function favorite(q: string) { const next = saved.includes(q) ? saved.filter(s => s !== q) : [q, ...saved].slice(0, 20); setSaved(next); persist("atlas-saved", next); }
  async function share() { try { await navigator.clipboard.writeText(window.location.href); setToast("Search link copied. Results refresh when opened."); } catch { setToast("Copy the link from your browser’s address bar to share."); } }
  const showSelection = !!result && result.accounts.length > 0 && !confirmed;
  const chooseIdentity = !!result?.candidates?.length && result.candidates.length > 1 && !result.identity;
  const visibleAccounts = result?.accounts.filter(a => (confirmed ? selected.includes(a.url) : true) && (filter === "all" || a.platform === filter)) || [];
  const showLanding = !loading && !error && !result && view === "discover";
  return <MotionConfig reducedMotion="user"><div className="app-shell">
    <header className="header"><a className="brand" href="/" onClick={e => { e.preventDefault(); home(); }} aria-label="SocialAtlas home"><span className="brand-symbol"><Globe2 size={23} /></span>Social<span>Atlas</span><span className="beta">BETA</span></a>
      <nav aria-label="Main navigation"><button className={view === "discover" ? "nav-item active" : "nav-item"} onClick={() => setView("discover")}><Compass size={15} />Discover</button><button className={view === "saved" ? "nav-item active" : "nav-item"} onClick={() => setView("saved")}><Bookmark size={15} />Saved<span className="nav-count">{saved.length}</span></button></nav>
      <button className="about-button" onClick={() => setModal(true)}>How it works<ArrowUpRight size={15} /></button>
    </header>
    <main id="main">
      {view === "saved" ? <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="saved-page"><span className="eyebrow">YOUR PERSONAL ATLAS</span><h1>Worth keeping<br /><span>in your orbit.</span></h1><p>Saved searches stay in this browser. Open one to discover fresh public results.</p>{saved.length ? <div className="saved-grid">{saved.map(q => <article className="saved-card" key={q}><span className="avatar-letter">{q.slice(0, 1).toUpperCase()}</span><button onClick={() => void search(q)}><strong>{q}</strong><span>Rediscover profiles <ArrowUpRight size={15} /></span></button><button className="icon-button" aria-label={`Remove ${q} from saved`} onClick={() => favorite(q)}><X size={17} /></button></article>)}</div> : <div className="empty-panel"><Bookmark size={30} /><h2>Your collection starts with a discovery.</h2><p>Save a search from its results to keep it close.</p><button className="primary" onClick={home}>Find someone <ArrowRight size={16} /></button></div>}</motion.section> : <>
      <section className={showLanding ? "hero" : "hero compact"}>
        {showLanding && <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65 }} className="hero-copy"><div className="eyebrow"><span className="live-dot" /> THE INTERNET IS CONNECTED. EXPLORE IT.</div><h1>Explore Their<br /><span>Social Universe.</span></h1><p>Discover the public profiles behind the people you follow.<br className="desktop-break" /> Start with a public figure’s name or creator alias.</p><div className="free-note">Free Wikidata discovery · No API key needed<span>Coverage depends on community records. Not every person or account is listed.</span></div></motion.div>}
        <motion.div layout className="search-area"><form className={`search-box ${focused ? "is-focused" : ""}`} onSubmit={(e: FormEvent) => { e.preventDefault(); void search(activeSuggestion >= 0 && focused ? suggestions[activeSuggestion] : query); }}>
          <Search size={21} className="search-icon" /><input ref={searchInput} value={query} onChange={e => { setQuery(e.target.value); setActiveSuggestion(-1); }} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)} onKeyDown={e => { if (e.key === "ArrowDown" && suggestions.length) { e.preventDefault(); setActiveSuggestion(i => (i + 1) % suggestions.length); } if (e.key === "ArrowUp" && suggestions.length) { e.preventDefault(); setActiveSuggestion(i => (i - 1 + suggestions.length) % suggestions.length); } if (e.key === "Escape") setFocused(false); }} placeholder="Enter a name or @username" aria-label="Search for a public figure or username" role="combobox" aria-autocomplete="list" aria-expanded={focused && suggestions.length > 0} aria-controls="recent-suggestions" aria-activedescendant={activeSuggestion >= 0 ? `suggestion-${activeSuggestion}` : undefined} maxLength={80} required minLength={2} autoComplete="off" /><kbd>↵</kbd><button className="search-submit" type="submit" aria-label={loading ? "Searching" : "Explore profiles"} disabled={loading}>{loading ? <LoaderCircle className="spin" size={18} /> : <><span>Explore</span><ArrowRight size={18} /></>}</button>
        </form>{focused && suggestions.length > 0 && <div className="suggestions" id="recent-suggestions" role="listbox" aria-label="Recent searches">{suggestions.map((s, i) => <button type="button" role="option" aria-selected={i === activeSuggestion} id={`suggestion-${i}`} className={i === activeSuggestion ? "selected" : ""} key={s} onMouseDown={e => e.preventDefault()} onClick={() => void search(s)}><Clock3 size={15} />{s}<small>Recent search</small></button>)}</div>}
        {showLanding && <div className="try-row"><span>Start with a name</span>{["Jynxzi", "Marques Brownlee", "Pokimane"].map(q => <button key={q} onClick={() => void search(q)}>{q}<ArrowUpRight size={11} /></button>)}</div>}</motion.div>
      </section>
      {showLanding && <motion.section className="exploration" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .25, duration: .8 }}><div className="exploration-heading"><span><span className="tiny-cross">+</span> A WORLD BEYOND THE BIO</span><span>11 PLATFORMS. ONE PERSPECTIVE.</span></div><Orbit decorative /><div className="orbit-caption"><span className="live-dot" />A map of possibilities. Your search makes the connections.</div>
        <div className="principles"><article><span className="feature-icon"><Scan size={18} /></span><div><h3>Follow the connections</h3><p>Find public accounts across the platforms you love.</p></div></article><article><span className="feature-icon"><ShieldCheck size={18} /></span><div><h3>Clarity over guesswork</h3><p>See the evidence. Know how confident a match is.</p></div></article><article><span className="feature-icon"><Bookmark size={18} /></span><div><h3>Keep your people close</h3><p>Save discoveries. Come back whenever curiosity calls.</p></div></article></div>
      </motion.section>}
      {showLanding && recent.length > 0 && <section className="recent-section"><div><span className="eyebrow">RECENT EXPLORATIONS</span><button className="text-button" onClick={() => { setRecent([]); persist("atlas-recent", []); }}>Clear history</button></div><div className="recent-chips">{recent.map(q => <button key={q} onClick={() => void search(q)}><Clock3 size={14} />{q}<ArrowUpRight size={13} /></button>)}</div></section>}
      <AnimatePresence mode="wait">
        {loading && <motion.section key="loading" className="state-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-live="polite"><div className="scan-loader"><Scan size={32} /></div><span className="eyebrow">DISCOVERY IN PROGRESS</span><h2>Tracing the public connections.</h2><p>Looking up public records for “{query}”.</p><div className="skeleton-grid">{[0, 1, 2].map(i => <div className="skeleton" key={i}><i /><b /><span /></div>)}</div></motion.section>}
        {error && <motion.section key="error" className="state-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} role="alert"><div className="state-icon"><Link2 size={27} /></div><span className="eyebrow">{error.code === "NOT_CONFIGURED" ? "SEARCH CONNECTION REQUIRED" : "A PAUSE IN DISCOVERY"}</span><h2>{error.code === "NOT_CONFIGURED" ? "Ready to explore. Connect a search provider." : "We couldn’t finish this search."}</h2><p>{error.message}</p><div className="state-actions"><button className="primary" onClick={() => void search(query)}><RotateCcw size={15} />Try again</button><button className="secondary" onClick={home}>Back to discovery</button></div></motion.section>}
        {result && <motion.section key="results" className="results" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
          <div className="result-header"><div><span className="eyebrow">{result.provider === "wikidata" ? "FREE DISCOVERY · WIKIDATA" : "PUBLIC WEB DISCOVERY · BRAVE"}</span><h1>{result.identity?.name || result.query}<span className="result-dot">.</span></h1><p>{chooseIdentity ? `${result.candidates!.length} matching entries` : `${result.accounts.length} recorded profile${result.accounts.length === 1 ? "" : "s"}`} · {new Date(result.searchedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{result.cached ? " · Cached" : ""}</p></div><div className="result-actions"><button className="secondary" onClick={() => favorite(result.query)}><Bookmark size={16} fill={saved.includes(result.query) ? "currentColor" : "none"} />{saved.includes(result.query) ? "Saved" : "Save search"}</button><button className="icon-button" onClick={() => void share()} aria-label="Copy shareable search link"><Link2 size={18} /></button></div></div>
          {result.identity && <div className="record-note"><div><a href={result.identity.sourceUrl} target="_blank" rel="noopener noreferrer">Wikidata entry {result.identity.id} <ArrowUpRight size={14} /></a>{result.identity.description && <p>{result.identity.description}</p>}</div>{(result.candidates?.length || 0) > 1 && <button className="text-button" onClick={() => { setResult({ ...result, identity: undefined, accounts: [] }); setSelected([]); setConfirmed(false); setFilter("all"); }}>Choose another entry</button>}</div>}
          {chooseIdentity ? <div className="identity-picker"><h2>Which entry do you mean?</h2><p>Choose one record. Accounts from different entries are kept separate.</p><div className="identity-grid">{result.candidates!.map(person => <article className="identity-card" key={person.id}><span className="eyebrow">{person.id}</span><h3>{person.name}</h3><p>{person.description || "No description available in Wikidata."}</p><span>{person.accounts.length} recorded profile{person.accounts.length === 1 ? "" : "s"}</span><button className="primary" onClick={() => { setResult({ ...result, identity: person, accounts: person.accounts }); setSelected([]); setConfirmed(false); setFilter("all"); }}>Choose {person.name}<ArrowRight size={16} /></button><a href={person.sourceUrl} target="_blank" rel="noopener noreferrer">View source entry <ArrowUpRight size={14} /></a></article>)}</div></div> : !result.accounts.length ? <div className="empty-panel"><Search size={30} /><h2>No recorded accounts found.</h2><p>{result.provider === "wikidata" ? "The free source only includes accounts recorded in Wikidata. Try a public figure’s name, a known creator alias, or another spelling. An empty result does not mean the person has no social accounts." : "Try an exact username, a different spelling, or a better-known public name. Private and unindexed accounts won’t appear here."}</p><button className="primary" onClick={() => searchInput.current?.focus()}>Refine your search<ArrowRight size={16} /></button></div> : <>
          {showSelection ? <div className="identity-note"><div><Layers3 size={22} /><div><h3>{result.provider === "brave" && result.ambiguous ? "More than one identity may be here." : "Choose the accounts you recognize."}</h3><p>Public records do not prove ownership. Open the source profiles, then select the accounts to include in your constellation.</p></div></div><button className="primary" disabled={!selected.length} onClick={() => setConfirmed(true)}>Build constellation ({selected.length})<ArrowRight size={16} /></button></div> : <><Orbit accounts={result.accounts.filter(a => selected.includes(a.url))} label={result.identity?.name || result.query} /><button className="text-button" onClick={() => setConfirmed(false)}>Edit selected accounts</button></>}
          <div className="filter-row"><span><SlidersHorizontal size={16} />Profiles</span><div aria-label="Filter by platform"><button className={filter === "all" ? "filter active" : "filter"} onClick={() => setFilter("all")}>All platforms</button>{platforms.filter(p => result.accounts.some(a => a.platform === p.id)).map(p => <button key={p.id} className={filter === p.id ? "filter active" : "filter"} onClick={() => setFilter(p.id)}><PlatformIcon id={p.id} size={13} />{p.name}</button>)}</div></div>
          <div className="account-grid">{visibleAccounts.map((a, i) => { const p = platforms.find(p => p.id === a.platform)!; return <motion.article key={a.url} className="account-card" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * .04, .4) }} style={{ "--platform": p.color } as CSSProperties}><div className="card-top"><span className="platform-badge"><PlatformIcon id={a.platform} size={23} /></span><span>{p.name}</span>{showSelection && <label className="select-account"><input type="checkbox" aria-label={`Include ${p.name} @${a.username}`} checked={selected.includes(a.url)} onChange={e => setSelected(s => e.target.checked ? [...s, a.url] : s.filter(url => url !== a.url))} /><span>Select</span></label>}</div><a className="account-link" href={a.url} target="_blank" rel="noopener noreferrer"><h3>@{a.username}<ArrowUpRight size={19} /></h3><p>{a.title}</p></a><div className="confidence"><span className={a.confidence === "Strong match" ? "confidence-dot strong" : "confidence-dot"} />{a.confidence}</div><p className="evidence">{a.evidence}</p><div className="card-sources"><a className="source-link" href={a.url} target="_blank" rel="noopener noreferrer">Open profile <ArrowUpRight size={14} /></a>{a.sourceUrl && <a className="source-link" href={a.sourceUrl} target="_blank" rel="noopener noreferrer">Wikidata source <ArrowUpRight size={14} /></a>}</div></motion.article>; })}</div>
          {!visibleAccounts.length && <p className="filter-empty">No selected accounts on this platform. Choose another filter.</p>}
          <p className="data-note"><ShieldCheck size={14} />{result.provider === "wikidata" ? "Free, community-maintained Wikidata records. Links may be missing or outdated. No ownership verification or follower counts." : "Public search results only. Follower counts, verification and portraits are omitted when unconfirmed."}</p></>}
        </motion.section>}
      </AnimatePresence>
      </>}
    </main>
    <footer><a className="footer-brand" href="/" onClick={e => { e.preventDefault(); home(); }}><Globe2 size={16} />SocialAtlas</a><span>A world of people. Connected.</span><button onClick={() => setModal(true)}><CircleHelp size={14} />About the atlas</button><span className="footer-meta">BUILT FOR THE CURIOUS <span>↗</span></span></footer>
    <dialog aria-label="How SocialAtlas works" ref={dialog} onCancel={() => setModal(false)} onClick={e => { if (e.target === e.currentTarget) setModal(false); }}><div className="dialog-content"><button className="icon-button dialog-close" aria-label="Close information" onClick={() => setModal(false)}><X size={20} /></button><span className="eyebrow">THE METHOD BEHIND THE MAP</span><h2>Public connections.<br />Free to discover.</h2><ol><li><strong>Start with Wikidata</strong><p>The default search uses Wikidata’s free public API, with no API key. It looks up names and creator aliases, then reads recorded social accounts. Coverage is limited to entries in Wikidata; it is not a search of every username on the internet.</p></li><li><strong>Understand the source</strong><p>Wikidata records are community-maintained and may be incomplete or outdated. They are not verified ownership. If several entries match, choose one before viewing its accounts. Each account links to its source record.</p></li><li><strong>Make your own constellation</strong><p>Choose the accounts you recognize. A person may have several accounts on one platform. Your selection is a personal collection, not a verification claim.</p></li></ol><div className="privacy-note"><ShieldCheck size={18} /><p>Queries go to the server and Wikidata by default. The site owner can optionally enable Brave Search. Recent searches and favorites stay in this browser. Shared links include the search query and rerun the search. Free-source results may be cached briefly to reduce requests.</p></div></div></dialog>
    <AnimatePresence>{toast && <motion.div className="toast" role="status" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Check size={16} />{toast}</motion.div>}</AnimatePresence>
  </div></MotionConfig>;
}



