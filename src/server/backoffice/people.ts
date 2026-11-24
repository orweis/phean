import { sql } from "drizzle-orm";
import { z } from "zod";

import { queryRows } from "../db/raw";
import { platformAdminEmails } from "../config";
import { containsPattern, epochMs } from "./queries";
import { platformService } from "./service";

/** The most people one search lists. */
export const PEOPLE_LIMIT = 25;

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  twoFactor: boolean;
  createdAt: number;
  /** How they can sign in: `credential` (a password), `github`, `google`. */
  methods: string[];
  lastSessionAt: number | null;
  liveSessions: number;
  devices: number;
  platformAdmin: boolean;
  workspaces: { slug: string; name: string; role: string }[];
}

/**
 * People by email or name (the newest signups when there are no words): how they sign in, two-factor
 * on or off, their last session, devices and workspaces. Never a password, a two-factor secret, a
 * session token, an address or a push endpoint: only those facts about them.
 */
export const searchPeople = platformService(
  "view.people",
  z.object({ q: z.string().trim().max(120).optional() }),
  async (ctx, { q }) => {
    const where = q ? sql`where u.email ilike ${containsPattern(q)} or u.name ilike ${containsPattern(q)}` : sql``;
    const rows = await queryRows<Omit<PersonRow, "platformAdmin">>(
      ctx.db,
      sql`select u.id, u.name, u.email, u.email_verified as "emailVerified", coalesce(u.two_factor_enabled, false) as "twoFactor",
            ${epochMs(sql`u.created_at`)} as "createdAt",
            coalesce((select array_agg(distinct a.provider_id order by a.provider_id) from account a where a.user_id = u.id), '{}') as methods,
            (select ${epochMs(sql`max(s.updated_at)`)} from session s where s.user_id = u.id) as "lastSessionAt",
            (select count(*)::int from session s where s.user_id = u.id and s.expires_at > now()) as "liveSessions",
            (select count(*)::int from push_devices d where d.user_id = u.id) as devices,
            coalesce((select jsonb_agg(jsonb_build_object('slug', o.slug, 'name', o.name, 'role', m.role) order by m.created_at)
                      from member m join organization o on o.id = m.organization_id where m.user_id = u.id), '[]'::jsonb) as workspaces
          from "user" u ${where}
          order by u.created_at desc
          limit ${PEOPLE_LIMIT}`,
    );
    const admins = platformAdminEmails();
    const people: PersonRow[] = rows.map((row) => ({
      ...row,
      createdAt: Number(row.createdAt),
      lastSessionAt: row.lastSessionAt === null ? null : Number(row.lastSessionAt),
      liveSessions: Number(row.liveSessions),
      devices: Number(row.devices),
      platformAdmin: row.emailVerified && admins.has(row.email.toLowerCase()),
    }));
    return { people, limited: people.length === PEOPLE_LIMIT };
  },
  // One match is a lookup of that person; the trail names them.
  { subjectUserId: (_input, output) => (output.people.length === 1 ? output.people[0]!.id : undefined) },
);
