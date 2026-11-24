"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  applyAnalyticsIdentity,
  applyPageContext,
  consentCookie,
  flushAnalyticsQueue,
  pageContext,
  registrableDomain,
  redactLocation,
  setAnalyticsConsent,
  setAnalyticsIdentity,
  setAnalyticsPage,
  setAnalyticsSignedIn,
  track,
  trackPageView,
  type AnalyticsIdentityParams,
  type ConsentChoice,
} from "@/lib/analytics";
import { routes } from "@/lib/routes";

import { Button } from "./ui/button";

/**
 * Google Analytics, loaded only after the visitor accepts it (docs/ANALYTICS.md, "Consent"). Until
 * then no Google script runs and no request leaves the page. The bar asks once; `ConsentLink` (the
 * footer, /account) asks again. Consent Mode v2 keeps every ad signal denied either way.
 */

const OPEN_EVENT = "phean:analytics-consent";

/** Whether this deployment has analytics at all: `ConsentLink` shows only where there is a choice to make. */
let available = false;
const listeners = new Set<() => void>();
function setAvailable(value: boolean) {
  available = value;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const secure = () => location.protocol === "https:";

/** Removes GA's own cookies (`_ga`, `_ga_<id>`) when someone withdraws consent. */
function clearGoogleCookies() {
  const host = location.hostname;
  const domains = ["", host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
  for (const name of document.cookie.split(";").map((cookie) => cookie.split("=")[0]!.trim())) {
    if (!name.startsWith("_ga")) continue;
    for (const domain of domains) document.cookie = `${name}=; Path=/; Max-Age=0${domain ? `; Domain=${domain}` : ""}`;
  }
}

/** gtag.js's own off switch: while set, it sends nothing at all, not even cookieless pings. */
function setDisabled(measurementId: string, disabled: boolean) {
  (window as unknown as Record<string, boolean>)[`ga-disable-${measurementId}`] = disabled;
}

function initGtag(measurementId: string, debug: boolean) {
  setDisabled(measurementId, false);
  window.dataLayer = window.dataLayer ?? [];
  if (typeof window.gtag !== "function") {
    window.gtag = function gtag() {
      // gtag.js reads the Arguments object itself, not an array.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
  }
  const denied = { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" };
  window.gtag("consent", "default", denied);
  window.gtag("consent", "update", { ...denied, analytics_storage: "granted" });
  window.gtag("set", "ads_data_redaction", true);
  window.gtag("js", new Date());
  // Before anything is sent, so gtag never reports the raw address, title or referrer.
  const page = pageContext(null);
  window.gtag("set", page);
  window.gtag("config", measurementId, {
    send_page_view: false,
    ...page,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    ...(debug ? { debug_mode: true } : {}),
  });
  // gtag.js itself, added once by hand: a script element React renders is never run. Its id must never
  // be "gtag", or the element would shadow the function above.
  if (!document.getElementById("phean-gtag-loader")) {
    const script = document.createElement("script");
    script.id = "phean-gtag-loader";
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
  }
}

interface AnalyticsProps {
  measurementId: string;
  debug: boolean;
  /** The visitor's choice from the `phean-consent` cookie, or null when they have not been asked. */
  consent: ConsentChoice | null;
  /** Whether a session cookie came with the request. */
  signedIn: boolean;
}

/** The loader, the page views, outbound clicks and the consent bar. Rendered once, by the root layout, when GA is on. */
export function Analytics({ measurementId, debug, consent: initial, signedIn }: AnalyticsProps) {
  const [consent, setConsent] = useState<ConsentChoice | null>(initial);
  const [asking, setAsking] = useState(initial === null);
  const pathname = usePathname();
  const previous = useRef<string | null>(null);
  const started = useRef(false);
  const viewed = useRef<string | null>(null);

  useEffect(() => {
    setAvailable(true);
    const open = () => setAsking(true);
    window.addEventListener(OPEN_EVENT, open);
    return () => {
      setAvailable(false);
      window.removeEventListener(OPEN_EVENT, open);
    };
  }, []);

  useEffect(() => setAnalyticsSignedIn(signedIn), [signedIn]);

  useEffect(() => {
    setAnalyticsConsent(consent);
    if (consent !== "granted") return;
    if (!started.current) {
      started.current = true;
      initGtag(measurementId, debug);
      applyAnalyticsIdentity();
      flushAnalyticsQueue();
    } else {
      setDisabled(measurementId, false);
      window.gtag?.("consent", "update", { analytics_storage: "granted" });
    }
  }, [consent, measurementId, debug]);

  // One page_view per App Router navigation, a tick later so the page's own `AnalyticsPage` and `AnalyticsIdentity` are in place.
  useEffect(() => {
    if (consent !== "granted") return;
    // The new page's location now, before any of its events; its page_view a tick later, once per
    // page (accepting again after declining on the same page sends none).
    applyPageContext(previous.current);
    const timer = window.setTimeout(() => {
      if (viewed.current === pathname) return;
      viewed.current = pathname;
      trackPageView(previous.current);
      previous.current = redactLocation(window.location.pathname).path;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, consent]);

  // Outbound links: on the public site the link itself; in the app only its domain, since agents' links can be private.
  useEffect(() => {
    if (consent !== "granted") return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        return;
      }
      if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) return;
      const { surface } = redactLocation(location.pathname);
      const isPublic = surface === "marketing" || surface === "docs" || surface === "blog";
      track("click", { outbound: true, link_domain: isPublic ? url.hostname : registrableDomain(url.hostname), ...(isPublic ? { link_url: `${url.origin}${url.pathname}`.slice(0, 100) } : {}) });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [consent]);

  const choose = (choice: ConsentChoice) => {
    document.cookie = consentCookie(choice, secure());
    setAsking(false);
    if (choice === "denied" && consent === "granted") {
      track("consent_change", { analytics: "denied" });
      window.gtag?.("consent", "update", { analytics_storage: "denied" });
      setDisabled(measurementId, true);
      clearGoogleCookies();
    }
    setConsent(choice);
    if (choice === "granted") window.setTimeout(() => track("consent_change", { analytics: "granted" }), 0);
  };

  return (
    <>
      {asking && <ConsentBar onChoose={choose} current={consent} />}
    </>
  );
}

function ConsentBar({ onChoose, current }: { onChoose: (choice: ConsentChoice) => void; current: ConsentChoice | null }) {
  return (
    <section
      aria-label="Analytics"
      data-consent-bar=""
      className="glass-float fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-2xl flex-col gap-3 rounded-3xl px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:rounded-full sm:py-2 sm:pl-5 sm:pr-2"
    >
      <p className="min-w-0 flex-1 text-pretty leading-snug text-ink-2">
        Phean uses Google Analytics to learn how the site and app are used. No ads, no names or content.{" "}
        <Link href={routes.privacy()} className="link whitespace-nowrap">
          Privacy
        </Link>
        {current && <span className="sr-only"> Your current choice: {current === "granted" ? "allowed" : "declined"}.</span>}
      </p>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="ghost" onClick={() => onChoose("denied")} className="flex-1 sm:flex-none">
          Decline
        </Button>
        <Button size="sm" variant="primary" onClick={() => onChoose("granted")} className="flex-1 sm:flex-none">
          Accept
        </Button>
      </div>
    </section>
  );
}

/** "Analytics choice": opens the consent bar again. Renders nothing where the deployment has no analytics. */
export function ConsentLink({ className, children = "Analytics choice" }: { className?: string; children?: React.ReactNode }) {
  const on = useSyncExternalStore(subscribe, () => available, () => false);
  if (!on) return null;
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      {children}
    </button>
  );
}

/**
 * Who is viewing, for the app's pages: the hashed person and workspace and the role, computed on the
 * server. Cleared when the page leaves, so the public site's events never carry a workspace.
 */
export function AnalyticsIdentity(identity: AnalyticsIdentityParams) {
  const key = JSON.stringify(identity);
  useEffect(() => {
    setAnalyticsIdentity(JSON.parse(key) as AnalyticsIdentityParams);
    return () => setAnalyticsIdentity({});
  }, [key]);
  return null;
}

/** Extra `page_view` params for the page on screen: a doc's slug and section, a post's slug. Public values only. */
export function AnalyticsPage(params: Record<string, string>) {
  const key = JSON.stringify(params);
  useEffect(() => {
    setAnalyticsPage(JSON.parse(key) as Record<string, string>);
    return () => setAnalyticsPage({});
  }, [key]);
  return null;
}
