/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";
import * as contextApi from "./ContextApiTypes";
import * as db from "../../../db/Model";

export class GroupConverter {
    
    /** The whole group: document plus state. `state` is passed in, not fetched, so a caller that does not need
     *  it cannot pay for it by accident. */
    convertGroup(user: types.cloud.UserId, group: db.group.Group, state: db.group.GroupState): contextApi.GroupInfo {
        const res: contextApi.GroupInfo = {
            id: group.id,
            groupPubKey: group.groupPubKey,
            contextId: group.contextId,
            type: group.type,
            createDate: group.createDate,
            creator: group.creator,
            lastModificationDate: group.lastModificationDate,
            lastModifier: group.lastModifier,
            data: state.history.map(x => ({keyId: x.keyId, data: x.data})),
            users: group.users,
            managers: group.managers,
            keys: (group.keys.find(x => x.user === user)?.keys) || [],
            version: group.version,
            keyVersion: group.keyVersion ?? 0,
            keyHistory: group.keyHistory ?? [],
            policy: group.policy || {},
            history: state.history.map(x => this.convertHistoryEntry(x)),
            groupKeys: group.groupKeys ?? [],
        };
        if (group.clientResourceId) {
            res.resourceId = group.clientResourceId;
        }
        this.addTreeState(res, group, state.tree, user);
        return res;
    }
    
    /**
     * What a listing serves: identity, roster, epoch. A page of a hundred groups through `convertGroup` would
     * carry a hundred trees and histories; a client that wants state asks for one group.
     */
    convertGroupSummary(group: db.group.GroupSummaryFields): contextApi.GroupSummary {
        const res: contextApi.GroupSummary = {
            id: group.id,
            groupPubKey: group.groupPubKey,
            contextId: group.contextId,
            type: group.type,
            createDate: group.createDate,
            creator: group.creator,
            lastModificationDate: group.lastModificationDate,
            lastModifier: group.lastModifier,
            users: group.users,
            managers: group.managers,
            version: group.version,
            keyVersion: group.keyVersion ?? 0,
            policy: group.policy || {},
        };
        if (group.clientResourceId) {
            res.resourceId = group.clientResourceId;
        }
        return res;
    }
    
    /**
     * Serves the tree state, flattened, plus the caller's own leaf.
     *
     * The archive is deliberately *not* included: it grows with the group's entire history, while a client needs
     * it only when reaching for an older epoch. `groupGetKeyArchive` serves it on demand instead.
     */
    private addTreeState(res: contextApi.GroupInfo, group: db.group.Group, tree: types.cloud.GroupTreeState|null, user: types.cloud.UserId) {
        if (!tree) {
            return;
        }
        res.numLeaves = tree.numLeaves;
        res.leafAssignment = tree.leafAssignment;
        res.treeNodes = tree.nodes;
        res.treeEdges = tree.edges;
        res.eraFloor = group.eraFloor ?? 1;
        if (group.archivePrunedBelow !== undefined) {
            res.archivePrunedBelow = group.archivePrunedBelow;
        }
        const position = tree.leafAssignment.indexOf(user);
        if (position >= 0) {
            res.ownLeafPosition = position;
        }
    }
    
    convertKeyArchive(group: db.group.Group, rungs: types.cloud.GroupArchiveRung[]): contextApi.GroupGetKeyArchiveResult {
        const res: contextApi.GroupGetKeyArchiveResult = {
            keyVersion: group.keyVersion ?? 0,
            eraFloor: group.eraFloor ?? 1,
            keyHistory: group.keyHistory ?? [],
            rungs: rungs,
        };
        if (group.archivePrunedBelow !== undefined) {
            res.archivePrunedBelow = group.archivePrunedBelow;
        }
        return res;
    }
    
    private convertHistoryEntry(entry: db.group.GroupHistoryEntry): contextApi.GroupHistoryEntryInfo {
        const res: contextApi.GroupHistoryEntryInfo = {
            keyId: entry.keyId,
            groupPubKey: entry.groupPubKey,
            users: entry.users,
            managers: entry.managers,
            created: entry.created,
            author: entry.author,
        };
        if (entry.confirmationTag !== undefined) {
            res.confirmationTag = entry.confirmationTag;
        }
        return res;
    }
}
