/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as mongodb from "mongodb";
import { IOC } from "../../service/ioc/IOC";
import { MigrationId } from "./MigrationManager";
import { GroupStateRepository } from "../../service/cloud/GroupStateRepository";
import * as types from "../../types";
import * as db from "../Model";

/** The two per-epoch arrays a group document carried before `groupEpochKey` existed. */
interface LegacyGroup {
    _id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    keyVersion: number;
    keyHistory?: types.cloud.GroupPubKeyAtEpoch[];
    groupKeys?: types.cloud.GroupKeysEntry[];
}

/**
 * Moves `keyHistory` and `groupKeys` off the group document into `groupEpochKey`, one row per `(groupId, epoch)`.
 * Both grew with every rotation until the document reached Mongo's 16 MB ceiling and every CAS on it failed.
 *
 * Every group, not only those carrying either field: a group that never rotated has neither, and still needs the
 * row of its current epoch — from the document's own `groupPubKey`, as `createGroup` and every rotation now write
 * one — or its first rotation would leave `keyHistory` without it. Rows are `$set` upserts by derived id, so a
 * re-run adds nothing and drops nothing.
 */
export class Migration073GroupEpochKeys {
    
    static id = <MigrationId>"Migration_073_GroupEpochKeys";
    /** One transaction over every group could outlive Mongo's 60 s limit; each group's writes are idempotent. */
    static transaction = false;
    
    static async go(ioc: IOC, session: mongodb.ClientSession|undefined): Promise<void> {
        const dbManager = ioc.getMongoDbManager();
        const epochKeys = await dbManager.createOrGetCollection<Omit<db.group.GroupEpochKey, "id">>(GroupStateRepository.EPOCH_KEY_COLLECTION_NAME);
        // Reading a group's rows and cutting an era (a range delete below the floor).
        await epochKeys.createIndex({groupId: 1, keyVersion: 1});
        // A new epoch's key checked against every earlier one's (T4-24) without scanning the group's rows.
        await epochKeys.createIndex({groupId: 1, groupPubKey: 1});
        const groups = await dbManager.createOrGetCollection<LegacyGroup>("group");
        const legacy = groups.find({}, {session, projection: {groupPubKey: 1, keyVersion: 1, keyHistory: 1, groupKeys: 1}});
        for await (const group of legacy) {
            const rows = Migration073GroupEpochKeys.rowsOf(group);
            await epochKeys.bulkWrite(rows.map(row => ({
                updateOne: {filter: {_id: GroupStateRepository.epochKeyId(row.groupId, row.keyVersion)}, update: {$set: row}, upsert: true},
            })), {session});
            await groups.updateOne({_id: group._id}, {$unset: {keyHistory: "", groupKeys: ""}}, {session});
        }
    }
    
    static rowsOf(group: LegacyGroup): Omit<db.group.GroupEpochKey, "id">[] {
        const rows = new Map<number, Omit<db.group.GroupEpochKey, "id">>();
        const row = (keyVersion: number) => {
            const existing = rows.get(keyVersion) ?? {groupId: group._id, keyVersion};
            rows.set(keyVersion, existing);
            return existing;
        };
        for (const entry of group.keyHistory ?? []) {
            row(entry.keyVersion).groupPubKey = entry.groupPubKey;
        }
        row(group.keyVersion).groupPubKey = group.groupPubKey;
        for (const key of (group.groupKeys ?? []).flatMap(entry => entry.keys)) {
            // Every self-addressed entry names its epoch; one that does not cannot be filed and is dropped.
            if (key.groupEpoch !== undefined) {
                row(key.groupEpoch).groupKey = key;
            }
        }
        return [...rows.values()].sort((a, b) => a.keyVersion - b.keyVersion);
    }
}
