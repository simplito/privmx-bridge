/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { Crypto } from "../../utils/crypto/Crypto";
import { ECUtils } from "../../utils/crypto/ECUtils";
import { ByteWriter } from "./keytree/ByteWriter";

/** A space's recipients, whole: what its document holds and what `rosterHash` binds. */
export interface Roster {
    groups: types.cloud.SpaceStatementGroup[];
    users: types.cloud.SpaceStatementUser[];
}

type Deltas = Pick<types.cloud.SpaceStatement, "addedGroups"|"addedUsers"|"removedGroups"|"removedUsers"|"refreshedGroups">;

/**
 * One signed entry of a space's history: who its recipients are after a change, which version of its key
 * they hold, and who made the change in which standing. The bytes are the ones the Endpoint signs and replays;
 * the bridge checks that an entry continues the history and describes the state it stores, and leaves the
 * question of whether the signer was entitled to the readers.
 */
export class SpaceStatement {
    
    static readonly OP_CODES: Record<types.cloud.SpaceStatementOp, number> = {create: 1, add: 2, remove: 3, rotate: 4};
    
    private static sorted<T>(list: T[], id: (x: T) => string): T[] {
        return [...list].sort((a, b) => Buffer.compare(Buffer.from(id(a), "utf8"), Buffer.from(id(b), "utf8")));
    }
    
    /** A refreshed group carries no role, so its entry has none. */
    private static groupList(writer: ByteWriter, groups: (Omit<types.cloud.SpaceStatementGroup, "role">&{role?: string})[], withRole: boolean) {
        writer.u32(groups.length);
        for (const g of SpaceStatement.sorted(groups, x => x.groupId)) {
            writer.lp(g.groupId);
            if (withRole) {
                writer.lp(g.role!);
            }
            writer.u64(g.groupKeyVersion).lp(g.groupPubKey);
        }
        return writer;
    }
    
    private static userList(writer: ByteWriter, users: types.cloud.SpaceStatementUser[]) {
        writer.u32(users.length);
        for (const u of SpaceStatement.sorted(users, x => x.userId)) {
            writer.lp(u.userId).lp(u.pubKey).lp(u.role);
        }
        return writer;
    }
    
    private static idList(writer: ByteWriter, ids: string[]) {
        writer.u32(ids.length);
        for (const id of SpaceStatement.sorted(ids, x => x)) {
            writer.lp(id);
        }
        return writer;
    }
    
    /** The whole roster, sorted by id byte-wise, so the order on the wire does not matter. */
    static rosterHash(roster: Roster): Buffer {
        const writer = SpaceStatement.groupList(new ByteWriter().tag("pmx-space-roster-v1"), roster.groups, true);
        return Crypto.sha256(SpaceStatement.userList(writer, roster.users).bytes());
    }
    
    /** The bytes the author signs (the signature is over their SHA-256): statement version 2, every list sorted by id. */
    static signedBytes(st: Omit<types.cloud.SpaceStatement, "signature"|"viaSignature">): Buffer {
        const prevDigest = Buffer.from(st.prevDigest, "hex");
        const writer = new ByteWriter()
            .tag("pmx-space-statement")
            .u8(2)
            .lp(st.spaceId)
            .lp(st.contextId)
            .u64(st.seq)
            .u32(prevDigest.length)
            .raw(prevDigest)
            .u8(SpaceStatement.OP_CODES[st.op])
            .u64(st.date)
            .u64(st.keyVersion)
            .raw(Buffer.from(st.keyCommit, "hex"))
            .raw(Buffer.from(st.rosterHash, "hex"));
        SpaceStatement.groupList(writer, st.addedGroups, true);
        SpaceStatement.userList(writer, st.addedUsers);
        SpaceStatement.idList(writer, st.removedGroups);
        SpaceStatement.idList(writer, st.removedUsers);
        SpaceStatement.groupList(writer, st.refreshedGroups, false);
        return writer.lp(st.signer).lp(st.signerPubKey).lp(st.via).bytes();
    }
    
    /** What a member of the group `via` signs with the group's own key: this statement, and nothing else. */
    static viaBytes(st: Omit<types.cloud.SpaceStatement, "signature"|"viaSignature">): Buffer {
        return new ByteWriter().tag("pmx-space-via").raw(Crypto.sha256(SpaceStatement.signedBytes(st))).bytes();
    }
    
    /** Identity of a statement as signed - what the next one names as `prevDigest`. Hex. */
    static digest(st: types.cloud.SpaceStatement): string {
        return Crypto.sha256(Buffer.concat([
            SpaceStatement.signedBytes(st), Buffer.from(st.signature, "base64"), Buffer.from(st.viaSignature, "base64"),
        ])).toString("hex");
    }
    
    /** The header byte is held to what the native Endpoint verifies, as for a group's statement. */
    private static verify(pubKey: string, signature: string, bytes: Buffer): boolean {
        try {
            const header = Buffer.from(signature, "base64")[0];
            return header >= 27 && header <= 42 && ECUtils.verifySignature2(pubKey as types.core.EccPubKey, signature as types.core.EccSignature, Crypto.sha256(bytes));
        }
        catch {
            return false;
        }
    }
    
    /** Against the key the statement names itself; that it is the caller's key is checked beside this. */
    static verifySignature(st: types.cloud.SpaceStatement): boolean {
        return SpaceStatement.verify(st.signerPubKey, st.signature, SpaceStatement.signedBytes(st));
    }
    
    static verifyViaSignature(st: types.cloud.SpaceStatement, groupPubKey: types.cloud.GroupPubKey): boolean {
        return SpaceStatement.verify(groupPubKey, st.viaSignature, SpaceStatement.viaBytes(st));
    }
    
    /**
     * The roster after `st`, from the roster before it (empty at seq 1). Strict, as the Endpoint applies them: an
     * id at most once across the group lists and once across the user lists, nobody added who is there, nobody
     * removed or refreshed who is not, and a refresh only to a newer group epoch.
     * @returns the roster, or why the deltas do not apply
     */
    static applyDeltas(prior: Roster, st: Deltas): Roster|string {
        const groupIds = [...st.addedGroups.map(g => g.groupId), ...st.removedGroups, ...st.refreshedGroups.map(g => g.groupId)];
        const userIds = [...st.addedUsers.map(u => u.userId), ...st.removedUsers];
        if (new Set(groupIds).size !== groupIds.length || new Set(userIds).size !== userIds.length) {
            return "a recipient appears twice in the statement's deltas";
        }
        const group = (id: types.group.GroupId) => prior.groups.find(g => g.groupId === id);
        const user = (id: types.cloud.UserId) => prior.users.find(u => u.userId === id);
        if (st.addedGroups.some(g => group(g.groupId)) || st.addedUsers.some(u => user(u.userId))) {
            return "an added recipient is already in the space";
        }
        if (st.removedGroups.some(id => !group(id)) || st.removedUsers.some(id => !user(id))) {
            return "a removed recipient is not in the space";
        }
        for (const r of st.refreshedGroups) {
            const g = group(r.groupId);
            if (!g) {
                return "a refreshed group is not in the space";
            }
            if (r.groupKeyVersion <= g.groupKeyVersion) {
                return `group '${r.groupId}' is refreshed to epoch ${r.groupKeyVersion}, not past the ${g.groupKeyVersion} the space holds`;
            }
            if (r.groupPubKey === g.groupPubKey) {
                return `group '${r.groupId}' is refreshed to the key the space holds already`;
            }
        }
        const refreshed = new Map(st.refreshedGroups.map(r => [r.groupId, r]));
        const after: Roster = {
            groups: [
                ...prior.groups.filter(g => !st.removedGroups.includes(g.groupId)).map(g => {
                    const r = refreshed.get(g.groupId);
                    return r ? {...g, groupKeyVersion: r.groupKeyVersion, groupPubKey: r.groupPubKey} : g;
                }),
                ...st.addedGroups.map(g => ({groupId: g.groupId, role: g.role, groupKeyVersion: g.groupKeyVersion, groupPubKey: g.groupPubKey})),
            ],
            users: [
                ...prior.users.filter(u => !st.removedUsers.includes(u.userId)),
                ...st.addedUsers.map(u => ({userId: u.userId, pubKey: u.pubKey, role: u.role})),
            ],
        };
        return [...after.groups, ...after.users].some(r => r.role === "manager") ? after : "the space would be left without a manager";
    }
    
    /**
     * Which deltas an op may carry: a creation and an add only add (at least one recipient), a removal removes
     * at least one and may refresh the groups that stay, a rotation (a stale re-key included) only refreshes.
     * @returns why the deltas do not fit the op, or undefined
     */
    static opProblem(st: Deltas&{op: types.cloud.SpaceStatementOp}): string|undefined {
        const added = st.addedGroups.length + st.addedUsers.length;
        const removed = st.removedGroups.length + st.removedUsers.length;
        const refreshed = st.refreshedGroups.length;
        const fits = {
            create: added > 0 && removed === 0 && refreshed === 0,
            add: added > 0 && removed === 0 && refreshed === 0,
            remove: added === 0 && removed > 0,
            rotate: added === 0 && removed === 0,
        }[st.op];
        return fits ? undefined : `a '${st.op}' cannot carry these deltas`;
    }
}
