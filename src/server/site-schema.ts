import { GITHUB_URL } from "@/components/site/site-links";
import { routes } from "@/lib/routes";

import { appUrl } from "./config";

/*
 * Who and what Phean is, as schema.org data, for search engines and answer engines. The words match
 * the landing page's: no ratings, prices or customers are claimed, because none exist.
 */

export const SITE_DESCRIPTION =
  "Phean is the decision center for AI agents and personal assistants: a shared task and goal ledger, served over MCP, where agents capture, claim and finish the work and every decision that needs a person waits in one place.";

export function organizationSchema() {
  const base = appUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${base}/#organization`,
    name: "Phean",
    url: `${base}/`,
    logo: `${base}/icon.svg`,
    sameAs: [GITHUB_URL],
  };
}

export function websiteSchema() {
  const base = appUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${base}/#website`,
    name: "Phean",
    url: `${base}/`,
    description: SITE_DESCRIPTION,
    publisher: { "@id": `${base}/#organization` },
    inLanguage: "en",
  };
}

export function softwareSchema() {
  const base = appUrl();
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${base}/#software`,
    name: "Phean",
    url: `${base}/`,
    description: SITE_DESCRIPTION,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Task management for AI agents",
    operatingSystem: "Web",
    license: "https://opensource.org/licenses/MIT",
    codeRepository: GITHUB_URL,
    isAccessibleForFree: true,
    publisher: { "@id": `${base}/#organization` },
    featureList: [
      "Shared task and goal ledger for AI agents over MCP",
      "Decisions inbox: agents ask people one structured question with options",
      "Exclusive task claims so agents never collide",
      "Shared long-term memory across agents",
      "Goals only people can approve",
      "Webhooks and a realtime stream to wake waiting agents",
      "Morning digest of what agents did and what waits on you",
    ],
    softwareHelp: { "@type": "WebPage", url: `${base}${routes.docs()}` },
  };
}

/** A trail of pages from the home page down, for a BreadcrumbList. */
export function breadcrumbSchema(trail: { name: string; path: string }[]) {
  const base = appUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: "Phean", path: "/" }, ...trail].map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${base}${crumb.path}`,
    })),
  };
}

/** A docs page as a TechArticle, with its place in the site. */
export function docSchema(title: string, description: string, path: string, trail: { name: string; path: string }[]) {
  const base = appUrl();
  return [
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: title,
      description,
      url: `${base}${path}`,
      inLanguage: "en",
      isPartOf: { "@id": `${base}/#website` },
      about: { "@id": `${base}/#software` },
      publisher: { "@id": `${base}/#organization` },
    },
    breadcrumbSchema([...trail, { name: title, path }]),
  ];
}
