/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ObjectRepositoryRead, Query, QueryResult } from "../../../db/ObjectRepository";

/** What every stored rung has, a group's or a space's; the rest (owner, author) is its owner's. */
export interface StoredRung {
    atKeyVersion: number;
    targetKeyVersion: number;
}

/** Reading a ladder's archive, for any owner of one: a group (`groupGetKeyArchive`) or a space (`spaceGetKeyArchive`). */
export class LadderArchive {
    
    /**
     * An owner's rungs with `atKeyVersion` in the window, ascending by `atKeyVersion` then `targetKeyVersion`. The window
     * goes into the query, so a short descent reads a few documents, not the whole archive. `minTarget` leaves out
     * rungs pointing below a floor; `limit` caps the page.
     */
    static async readRungs<K extends string|number, T extends StoredRung>(
        rungs: ObjectRepositoryRead<K, T>,
        owner: (q: Query<T>) => QueryResult,
        window: {from?: number, to?: number, minTarget?: number, limit?: number},
    ): Promise<T[]> {
        const query = rungs.query(q => {
            // `T[K]` of a generic `T` does not reduce to number: the fields are `StoredRung`'s.
            const r = q as unknown as Query<StoredRung>;
            return q.andList([
                owner(q),
                ...(window.from === undefined ? [] : [r.gte("atKeyVersion", window.from)]),
                ...(window.to === undefined ? [] : [r.lte("atKeyVersion", window.to)]),
                ...(window.minTarget === undefined ? [] : [r.gte("targetKeyVersion", window.minTarget)]),
            ]);
        }).sort("atKeyVersion", true);
        const page = await (window.limit === undefined ? query : query.limit(window.limit)).array();
        return page.sort((a, b) => a.atKeyVersion - b.atKeyVersion || a.targetKeyVersion - b.targetKeyVersion);
    }
    
    /**
     * A page of key versions `from`..`upTo` out of the window `fromKeyVersion`..`toKeyVersion` (default 1..current),
     * capped at the current version and at `limit` versions; `next` is where the following page starts, if any.
     */
    static versionPage(fromKeyVersion: number|undefined, toKeyVersion: number|undefined, currentKeyVersion: number, limit: number) {
        const from = fromKeyVersion ?? 1;
        const last = Math.min(toKeyVersion ?? currentKeyVersion, currentKeyVersion);
        const upTo = Math.min(last, from + limit - 1);
        return {from, upTo, empty: from > upTo, next: upTo < last ? upTo + 1 : undefined};
    }
}
