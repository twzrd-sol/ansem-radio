import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { OFFICIAL_STREAMER } from "../chain/config";
import { seasonIndex, withdrawAvailableAt } from "../chain/season";
import { explainApiError, type ActivityInput } from "../data/api";
import { HubProvider, type HubLoad } from "../data/hub";
import { useLiveHub } from "../data/live";
import { useListing, useMarket, type Listing as ListingData, type Market as MarketData } from "../data/market";
import { buildSample, sampleListingDetail, sampleMarket, samplePositions } from "../data/sample";
import { stationAt, useStation } from "../data/station";
import { buildToday } from "../data/today";
import type { HubSnapshot } from "../data/types";
import { useWalletSession, WalletSessionProvider } from "../data/wallet-session";
import { seasonPhase } from "../data/season";
import { short } from "../lib/format";
import { Back } from "../screens/Back";
import { Board } from "../screens/Board";
import { Claim } from "../screens/Claim";
import { Lan } from "../screens/Lan";
import { Listing } from "../screens/Listing";
import { Market } from "../screens/Market";
import { Play } from "../screens/Play";
import { Positions } from "../screens/Positions";
import { Profile } from "../screens/Profile";
import { Icon, type IconName, LanMark, Skeleton } from "../ui/atoms";
import { HowItWorks, HowLink, PUBLIC_SOURCE } from "../ui/HowItWorks";
import { LanCompanion } from "../ui/LanCompanion";
import { IdentityLinks } from "../ui/IdentityLinks";
import { PreviewPanel } from "./PreviewPanel";
import { usePreview, writePreview, type PreviewState } from "./preview";
import { useRoute, type Tab } from "./route";

// The live backing flow (Solana Kit, Wallet Standard, Mobile Wallet Adapter) loads only on a backing screen.
const LiveBack = lazy(() => import("../screens/LiveBack").then((m) => ({ default: m.LiveBack })));

const TABS: Array<[Tab, string, string, IconName]> = [
  ["market", "#/", "Board", "board"],
  ["lan", "#/lan", "Radio LAN", "stream"],
  ["play", "#/play", "Play", "play"],
  ["positions", "#/positions", "Positions", "heart"],
  ["me", "#/me", "Me", "me"],
];

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Plan section 8: a red DEVNET ribbon on every on-chain screen while the hub runs on devnet. */
export const Ribbon = () => (
  <div className="ribbon" role="note">
    <span className="ribbon__word">DEVNET</span>
    <span className="ribbon__note">Test tokens with no real value. This flow uses Solana devnet.</span>
  </div>
);

/** The snapshot the screens render: fixtures only in ?preview=sample, the real state everywhere else. */
export function snapshotFor(preview: PreviewState, now: number): HubSnapshot {
  if (!preview.enabled || preview.scenario === "today") return buildToday();
  const sample = buildSample(now);
  return preview.joined || !sample.season ? sample : { ...sample, season: { ...sample.season, me: null } };
}

/** The board the screens render: fixtures only in ?preview=sample; the station's market everywhere else. */
export function marketFor(preview: PreviewState, now: number, live: MarketData | null): MarketData | null {
  if (!preview.enabled) return live;
  return preview.scenario === "sample" ? sampleMarket(now) : { network: "devnet", observedAt: null, slot: null, stale: false, generatedAt: Math.floor(now / 1000), listings: [] };
}

/** The start of the featured arena's next on-chain season (ms), or null while its schedule is unknown. */
export function nextSeasonAt(listing: ListingData | null, now: number): number | null {
  const a = listing?.arena;
  if (!a || a.closed) return null;
  const start = BigInt(a.seasonStart);
  const seconds = BigInt(a.seasonSeconds);
  const t = BigInt(Math.floor(now / 1000));
  return Number(withdrawAvailableAt(start, seconds, seasonIndex(start, seconds, t))) * 1000;
}

/** Where a backing screen points: the listing's registry pair, or the build's devnet mint for the featured listing. */
export function backingTarget(listing: ListingData | null, fallbackMint: string | null): { streamer: string; mint: string } | null {
  if (listing?.keys) return listing.keys;
  if (listing?.kind === "featured" && fallbackMint) return { streamer: OFFICIAL_STREAMER, mint: fallbackMint };
  return null;
}

export interface AppViewProps {
  wallet?: string | null;
  /** The build's devnet test mint (VITE_DEVNET_TEST_MINT), a dev fallback for the featured listing only. */
  fallbackMint?: string | null;
}

export function App({ wallet = null, fallbackMint = null }: AppViewProps) {
  return <WalletSessionProvider><AppShell wallet={wallet} fallbackMint={fallbackMint} /></WalletSessionProvider>;
}

function AppShell({ wallet: givenWallet = null, fallbackMint = null }: AppViewProps) {
  const session = useWalletSession();
  const wallet = session.wallet?.address ?? givenWallet;
  const route = useRoute();
  const preview = usePreview();
  const hub = useLiveHub(!preview.enabled);
  const market = useMarket(!preview.enabled);
  const slug = route.key === "s" ? route.arg : route.key === "back" ? route.arg || "radiolanlive" : null;
  const detail = useListing(slug, !preview.enabled && route.key === "s");
  const stationRead = useStation(!preview.enabled);
  const now = useNow(1000);
  const station = preview.enabled ? { status: "unknown" as const } : stationAt(stationRead, now);
  const [toastText, setToastText] = useState("");
  const [toastOn, setToastOn] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const view = useRef<HTMLElement>(null);

  const toast = useCallback((text: string) => {
    setToastText(text);
    setToastOn(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastOn(false), 2200);
  }, []);

  const previewSnapshot = useMemo(() => snapshotFor(preview, now), [preview, now]);
  const snapshot = preview.enabled ? previewSnapshot : hub.snapshot;
  const load: HubLoad = preview.enabled
    ? preview.data === "loading" ? { status: "loading" } : preview.data === "error" ? { status: "error", retry: () => writePreview({ ...preview, data: "ready" }) } : { status: "ready", snapshot }
    : hub.load === "ready" ? { status: "ready", snapshot } : hub.load === "error" ? { status: "error", retry: hub.refresh } : { status: "loading" };
  const state = load.status;
  const shown = load.status === "ready" ? load.snapshot : null;
  const retry = () => {
    if (preview.enabled) writePreview({ ...preview, data: "ready" });
    else {
      void hub.refresh();
      void market.refresh();
      void detail.refresh();
    }
  };
  const board = useMemo(() => marketFor(preview, now, market.market), [preview, now, market.market]);
  const boardLoad: "loading" | "error" | "ready" = preview.enabled ? (preview.data === "ready" ? "ready" : preview.data) : market.load;
  const joined = preview.enabled ? preview.joined : Boolean(hub.state?.me?.joined);
  // Joining creates the hub account first when there is none: one passkey prompt, then the season (plan section 3).
  const join = async () => {
    if (!shown?.season || seasonPhase(shown.season, now) !== "open") {
      toast("This season isn't open right now.");
      return;
    }
    if (preview.enabled) {
      writePreview({ ...preview, joined: true });
      toast("You're in. Free.");
      return;
    }
    try {
      if (!hub.state?.me) {
        toast("Creating your hub account with a passkey");
        await hub.api.register();
      }
      await hub.api.join();
      await hub.refresh();
      toast("You're in. Free.");
    } catch (error) {
      toast(explainApiError(error));
    }
  };
  const account = async (mode: "register" | "login") => {
    try {
      await (mode === "register" ? hub.api.register() : hub.api.login());
      await hub.refresh();
      toast(mode === "register" ? "Account created" : "Signed in");
    } catch (error) {
      toast(explainApiError(error));
    }
  };
  const signOut = async () => {
    try {
      await hub.api.logout();
    } finally {
      await hub.refresh();
    }
  };
  const submit = async (input: ActivityInput) => {
    try {
      await hub.api.submit(input);
    } catch (error) {
      throw new Error(explainApiError(error));
    }
    await hub.refresh();
  };
  // Reads a wallet's address for the positions screen; the wallet module loads only when tapped.
  const connectForPositions = async (): Promise<string | null> => {
    try {
      if (session.wallet) return session.wallet.address;
      const w = await import("../chain/wallet");
      if (/android/i.test(navigator.userAgent)) w.registerMobileWallet();
      const usable = w.listWallets();
      if (usable.length === 0) {
        toast("No Solana wallet was found in this browser.");
        return null;
      }
      const port = await w.connectWallet(usable[0]!);
      session.setWallet(port);
      return port.address;
    } catch (error) {
      toast(explainApiError(error));
      return null;
    }
  };

  // The title follows the listing's name once the board has it; scroll and focus move only on navigation, never on
  // the board's periodic refresh.
  const listingName = route.key === "s" && slug ? (board?.listings.find((l) => l.slug === slug)?.name ?? null) : null;
  useEffect(() => {
    document.title = `${listingName ?? route.title} · Radio LAN`;
  }, [route.title, listingName]);
  useEffect(() => {
    window.scrollTo(0, 0);
    view.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [route.key, route.arg]);

  const listingOf = (s: string | null) => (s ? (board?.listings.find((l) => l.slug === s) ?? null) : null);
  let screen: ReactNode;
  switch (route.key) {
    case "s": {
      const live = !preview.enabled && detail.load === "ready" && detail.detail?.listing.slug === slug ? detail.detail : null;
      const listing = live ? live.listing : preview.enabled && preview.scenario === "sample" && slug ? sampleListingDetail(now, slug)?.listing ?? null : listingOf(slug);
      const observed = live ?? (board ? { ...board } : null);
      const listingLoad = preview.enabled ? boardLoad : detail.load === "ready" || detail.load === "error" ? detail.load : board ? "ready" : market.load;
      screen = <Listing listing={listing} observed={observed} load={listingLoad} onRetry={retry} station={station} now={now} snapshot={shown} onJoin={() => void join()} slug={slug ?? ""} />;
      break;
    }
    case "lan":
      screen = <Lan snapshot={shown} load={state} onRetry={retry} station={station} />;
      break;
    case "play":
      screen = <Play key={`${shown?.season?.number ?? "none"}:${shown?.fan?.handle ?? "guest"}`} snapshot={shown} load={state} now={now} joined={joined} onJoin={() => void join()} onRetry={retry} toast={toast} submit={preview.enabled ? undefined : submit} nextSeasonAt={nextSeasonAt(listingOf("radiolanlive"), now)} />;
      break;
    case "board":
      screen = <Board snapshot={shown} load={state} joined={joined} onRetry={retry} />;
      break;
    case "positions":
      screen = <Positions listings={board?.listings ?? []} now={now} wallet={wallet} onConnect={preview.enabled ? undefined : connectForPositions} sample={preview.enabled && preview.scenario === "sample" ? samplePositions(now) : null} load={boardLoad} onRetry={retry} />;
      break;
    case "back": {
      const listing = listingOf(slug);
      const target = backingTarget(listing, fallbackMint);
      const live = preview.enabled ? undefined : (
        <Suspense fallback={<Skeleton kinds={["title", "block", "block"]} />}>
          <LiveBack target={target} slug={slug ?? "radiolanlive"} name={listing?.name ?? "Radio LAN"} allowSetup={listing?.kind === "featured" || (!listing && slug === "radiolanlive")} ready={market.load !== "loading"} boardError={market.load === "error"} onRetry={retry} />
        </Suspense>
      );
      screen = <Back snapshot={shown} load={state} preview={preview} now={now} onRetry={retry} live={live} slug={slug ?? "radiolanlive"} name={listing?.name ?? "Radio LAN"} />;
      break;
    }
    case "me":
      screen = <Profile snapshot={shown} load={state} backer={preview.enabled && preview.scenario === "sample" && preview.position !== "none"} wallet={wallet} onRetry={retry} onAccount={preview.enabled ? undefined : account} onSignOut={preview.enabled ? undefined : signOut} links={preview.enabled ? undefined : <IdentityLinks api={hub.api} accountId={hub.state?.me?.accountId ?? null} wallet={session.wallet} />} />;
      break;
    case "claim":
      screen = <Claim snapshot={shown} load={state} onRetry={retry} now={now} />;
      break;
    case "how":
      screen = <HowItWorks />;
      break;
    default:
      screen = <Market market={board} load={boardLoad} onRetry={retry} station={station} now={now} />;
  }

  return (
    <HubProvider value={load}>
      <a className="skip" href="#view" onClick={(e) => { e.preventDefault(); view.current?.focus(); }}>
        Skip to content
      </a>
      <div className="app">
        <header className="top">
          <a className="brand" href="#/" aria-label="Radio LAN home">
            <LanMark className="brand__mark" />
            <span className="brand__text">
              <span className="brand__name">Radio LAN</span>
              <span className="brand__by">by THE WZRD OF ZO</span>
            </span>
          </a>
          <nav className="top__nav" aria-label="Hub">
            {TABS.map(([tab, href, label]) => (
              <a key={tab} href={href} aria-current={route.tab === tab ? "page" : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <span className="top__spacer" />
          {!preview.enabled && <div className="header-wallet">{wallet ? <><a href="#/positions" title={wallet}><Icon name="wallet" size="sm" /><span>{short(wallet)}</span></a>{session.wallet && <button className="link-btn" type="button" onClick={() => session.setWallet(null)}>Disconnect</button>}</> : <a href="#/positions"><Icon name="wallet" size="sm" /><span>Wallet</span></a>}</div>}
          {preview.enabled && (
            <button className="preview-chip" type="button" aria-expanded={panelOpen} aria-controls="preview" onClick={() => setPanelOpen(!panelOpen)}>
              Preview
            </button>
          )}
        </header>
        {route.onchain && <Ribbon />}
        <main id="view" ref={view} className="view" tabIndex={-1}>
          <LanCompanion market={board} snapshot={shown} now={now} ready={boardLoad === "ready"} station={station} />
          {screen}
        </main>
        <footer className="foot">
          <span>Radio LAN by THE WZRD OF ZO</span>
          <span>Free to play</span>
          <a href="https://www.twitch.tv/radiolanlive" target="_blank" rel="noopener noreferrer">
            Watch on Twitch
          </a>
          <a href="/stream">Macro view</a>
          <HowLink />
          <a href={PUBLIC_SOURCE} target="_blank" rel="noopener noreferrer">MIT source</a>
        </footer>
        <nav className="tabs" aria-label="Hub">
          {TABS.map(([tab, href, label, icon]) => (
            <a key={tab} className="tab" href={href} aria-current={route.tab === tab ? "page" : undefined}>
              <Icon name={icon} />
              {label}
            </a>
          ))}
        </nav>
      </div>
      {preview.enabled && panelOpen && <PreviewPanel preview={preview} onClose={() => setPanelOpen(false)} />}
      <div className={toastOn ? "toast show" : "toast"} role="status" aria-live="polite">
        {toastText}
      </div>
    </HubProvider>
  );
}
