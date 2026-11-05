import { and, exists, inArray, lt, not, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "../db/schema";

/** How long a client may sit unused before it is removed: a connection is begun and finished well within it. */
export const UNUSED_CLIENT_HOURS = 24;

/** Clients removed at a time, so the request that triggers it stays quick however many have piled up. */
const PRUNE_BATCH = 20;

/**
 * Removes clients registered (DCR) or fetched (CIMD) over a day ago that no one ever consented to
 * and that hold no token. Anyone may register a client without signing in, so this runs whenever a
 * new one may be stored, a bounded batch at a time, rather than on a schedule. A client removed here
 * registers again (DCR) or is fetched again (CIMD) on its next authorize.
 */
export async function pruneUnusedClients(db: Db, batch = PRUNE_BATCH): Promise<void> {
  const cutoff = new Date(Date.now() - UNUSED_CLIENT_HOURS * 60 * 60 * 1000);
  const usedBy = (table: typeof oauthConsent | typeof oauthRefreshToken | typeof oauthAccessToken) =>
    exists(db.select({ one: sql`1` }).from(table).where(sql`${table.clientId} = ${oauthClient.clientId}`));
  const unused = db
    .select({ id: oauthClient.id })
    .from(oauthClient)
    .where(
      and(
        // The provider writes these as UTC wall time without a zone, so the cutoff is compared the same way.
        lt(sql`coalesce(${oauthClient.updatedAt}, ${oauthClient.createdAt})`, sql`${cutoff.toISOString()}::timestamp`),
        not(usedBy(oauthConsent)),
        not(usedBy(oauthRefreshToken)),
        not(usedBy(oauthAccessToken)),
      ),
    )
    .limit(batch);
  await db.delete(oauthClient).where(inArray(oauthClient.id, unused));
}
