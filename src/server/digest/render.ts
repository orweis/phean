import { pluralize } from "@/lib/format";
import { routes } from "@/lib/routes";

import { digestSubject, type Digest, type DigestSection } from "../domain/digest";
import type { Email } from "./email";

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/*
 * Mail clients ignore stylesheets and custom properties, so the email carries literal colours:
 * the light appearance's ink, muted, rule and accent, and ember for what waits on a person.
 */
const INK = "#1f1530";
const MUTED = "#615a74";
const RULE = "#e3dfeb";
const ACCENT = "#5b2fd0";
const WAIT = "#b4581c";
const LATE = "#b42332";

interface Part {
  title: string;
  color: string;
  section: DigestSection;
  more: string;
}

/** The digest as an email: the same sections as the page, every line a link into the app. */
export function renderDigestEmail(digest: Digest, baseUrl: string, to: string): Email {
  const slug = digest.tenant.slug;
  const absolute = (path: string) => `${baseUrl}${path}`;
  const parts: Part[] = [
    { title: "Waiting on you", color: WAIT, section: digest.waiting, more: absolute(routes.decisions(slug)) },
    { title: "Late", color: LATE, section: digest.late, more: absolute(routes.board(slug)) },
    { title: "Done since yesterday", color: ACCENT, section: digest.finished, more: absolute(routes.timeline(slug)) },
  ].filter((part) => part.section.count > 0);
  const manage = absolute(routes.digest(slug));
  const open = absolute(routes.workspace(slug));
  const captured = digest.captured ? `${pluralize(digest.captured, "task")} came in.` : "";

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f5fb;font-family:-apple-system,'Segoe UI',Inter,sans-serif;color:${INK}">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${RULE};border-radius:14px">
<tr><td style="padding:24px 24px 8px">
<p style="margin:0;font-size:13px;color:${MUTED}">Morning digest</p>
<h1 style="margin:4px 0 0;font-size:22px;line-height:28px"><a href="${open}" style="color:${INK};text-decoration:none">${escape(digest.tenant.name)}</a></h1>
${captured ? `<p style="margin:8px 0 0;font-size:14px;color:${MUTED}">${captured}</p>` : ""}
</td></tr>
${parts
  .map(
    (part) => `<tr><td style="padding:16px 24px 4px">
<h2 style="margin:0 0 4px;font-size:15px;color:${part.color}">${part.title} (${part.section.count})</h2>
${part.section.items
  .map(
    (item) => `<p style="margin:0;padding:8px 0;border-bottom:1px solid ${RULE};font-size:14px;line-height:20px"><a href="${absolute(item.href)}" style="color:${INK};font-weight:600;text-decoration:none">${escape(item.title)}</a><br><span style="color:${MUTED};font-size:13px">${escape(item.detail)}</span></p>`,
  )
  .join("")}
${part.section.count > part.section.items.length ? `<p style="margin:8px 0 0;font-size:13px"><a href="${part.more}" style="color:${ACCENT}">And ${part.section.count - part.section.items.length} more</a></p>` : ""}
</td></tr>`,
  )
  .join("")}
<tr><td style="padding:20px 24px 24px;font-size:12px;color:${MUTED}">
<a href="${open}" style="color:${ACCENT};font-weight:600">Open ${escape(digest.tenant.name)}</a> · <a href="${manage}" style="color:${MUTED}">Change or stop this digest</a>
</td></tr>
</table></body></html>`;

  const text = [
    `${digest.tenant.name}: morning digest`,
    captured,
    ...parts.map(
      (part) =>
        `${part.title} (${part.section.count})\n${part.section.items.map((item) => `- ${item.title}\n  ${item.detail}\n  ${absolute(item.href)}`).join("\n")}${
          part.section.count > part.section.items.length ? `\n  And ${part.section.count - part.section.items.length} more: ${part.more}` : ""
        }`,
    ),
    `Open ${digest.tenant.name}: ${open}`,
    `Change or stop this digest: ${manage}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { to, subject: digestSubject(digest), html, text };
}
