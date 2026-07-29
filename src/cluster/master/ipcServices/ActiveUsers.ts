/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IpcService } from "../../master/Decorators";
import { ApiMethod } from "../../../api/Decorators";
import * as types from "../../../types";
import * as db from "../../../db/Model";
import { DateUtils } from "../../../utils/DateUtils";

interface ContextUserStatusEvent {
    id: number;
    timestamp: types.core.Timestamp;
    host: types.core.Host;
    contextId: types.context.ContextId;
    userId: types.cloud.UserId;
    userPubKey: types.core.EccPubKey;
    action: "login"|"logout";
}

@IpcService
export class ActiveUsersMap {
    
    private usersSet: Map<`${types.core.Host}/${types.cloud.SolutionId}/${types.core.EccPubKey}`, {usage: number}> = new Map();
    private activeContextUsers: Map<types.context.ContextId, Set<types.core.EccPubKey>> = new Map();
    
    private contextUserCounters: Map<string, {usage: number, pubKey: types.core.EccPubKey}> = new Map();
    
    private events: ContextUserStatusEvent[] = [];
    private lastEventId: number = 0;
    private static readonly MAX_EVENTS_HISTORY = 2000;
    
    @ApiMethod({})
    async setUserAsActive(model: {host: types.core.Host, userPubkey: types.core.EccPubKey, solutionId: types.cloud.SolutionId}) {
        const entry = this.usersSet.get(`${model.host}/${model.solutionId}/${model.userPubkey}`);
        if (!entry) {
            this.usersSet.set(`${model.host}/${model.solutionId}/${model.userPubkey}`, {usage: 1});
            return {usage: 1};
        };
        entry.usage++;
        return entry;
    }
    
    @ApiMethod({})
    async addToActiveContextUsers(model: {userIdentities: {userPubKey: types.core.EccPubKey, contextId: types.context.ContextId}[]}) {
        for (const identity of model.userIdentities) {
            const entry = this.activeContextUsers.get(identity.contextId);
            if (!entry) {
                this.activeContextUsers.set(identity.contextId, new Set([identity.userPubKey]));
            }
            else {
                entry.add(identity.userPubKey);
            }
        }
    }
    
    @ApiMethod({})
    async removeFromActiveContextUsers(model: {userIdentities: {userPubKey: types.core.EccPubKey, contextId: types.context.ContextId}[]}) {
        for (const identity of model.userIdentities) {
            const entry = this.activeContextUsers.get(identity.contextId);
            if (!entry) {
                continue;
            }
            else {
                entry.delete(identity.userPubKey);
            }
        }
    }
    
    @ApiMethod({})
    async setUserAsInactive(model: {host: types.core.Host, userPubkey: types.core.EccPubKey, solutionId: types.cloud.SolutionId}) {
        const entry = this.usersSet.get(`${model.host}/${model.solutionId}/${model.userPubkey}`);
        if (!entry) {
            return {usage: 0};
        };
        if (entry.usage === 1) {
            this.usersSet.delete(`${model.host}/${model.solutionId}/${model.userPubkey}`);
            return {usage: 0};
        }
        else {
            entry.usage--;
            return entry;
        }
    }
    
    @ApiMethod({})
    async getUsersState(model: {host: types.core.Host, userPubkeys: types.core.EccPubKey[], solutionIds: types.cloud.SolutionId[]}): Promise<{userPubKey: types.core.EccPubKey, status: "active"|"inactive"}[]> {
        return model.userPubkeys.map(user => {
            return {
                userPubKey: user,
                status: this.isUserActive(model.host, user, model.solutionIds) ? "active" : "inactive",
            };
        });
    }
    
    @ApiMethod({})
    async isAnyUserActive(model: {users: db.context.ContextUser[], solutionId: types.cloud.SolutionId, host: types.core.Host}) {
        for (const user of model.users) {
            if (await this.isContextUserActive({host: model.host, user, solutionId: model.solutionId})) {
                return true;
            }
        }
        return false;
    }
    
    @ApiMethod({})
    async isContextUserActive(model: {host: types.core.Host, user: {userPubKey: types.core.EccPubKey}, solutionId: types.cloud.SolutionId}) {
        return !!this.usersSet.has(`${model.host}/${model.solutionId}/${model.user.userPubKey}`);
    }
    
    @ApiMethod({})
    async getActiveContextUsers(model: {contextId: types.context.ContextId}) {
        const userKeysSet = this.activeContextUsers.get(model.contextId);
        if (!userKeysSet) {
            return [];
        }
        return Array.from(userKeysSet);
    }
    
    @ApiMethod({})
    async registerContextUserStatusChange(model: {host: types.core.Host, contextId: types.context.ContextId, userIdentities: {userId: types.cloud.UserId, userPubKey: types.core.EccPubKey, action: "login"|"logout"}[]}) {
        const now = DateUtils.now();
        
        for (const identity of model.userIdentities) {
            const key = `${model.host}/${model.contextId}/${identity.userId}`;
            let entry = this.contextUserCounters.get(key);
            
            if (!entry) {
                entry = {usage: 0, pubKey: identity.userPubKey};
                this.contextUserCounters.set(key, entry);
            }
            
            const oldUsage = entry.usage;
            if (identity.action === "login") {
                entry.usage++;
            }
            else {
                entry.usage = Math.max(0, entry.usage - 1);
            }
            
            if (oldUsage === 0 && entry.usage > 0) {
                this.pushEvent(model.host, model.contextId, identity.userId, identity.userPubKey, "login", now);
            }
            else if (oldUsage > 0 && entry.usage === 0) {
                this.pushEvent(model.host, model.contextId, identity.userId, identity.userPubKey, "logout", now);
                this.contextUserCounters.delete(key);
            }
        }
    }
    
    private pushEvent(host: types.core.Host, contextId: types.context.ContextId, userId: types.cloud.UserId, userPubKey: types.core.EccPubKey, action: "login"|"logout", timestamp: types.core.Timestamp) {
        this.lastEventId++;
        this.events.push({
            id: this.lastEventId,
            timestamp,
            host,
            contextId,
            userId,
            userPubKey,
            action,
        });
        
        if (this.events.length > ActiveUsersMap.MAX_EVENTS_HISTORY) {
            this.events.shift();
        }
    }
    
    @ApiMethod({})
    async fetchContextUserStatusChanges(model: {lastEventId: number}) {
        const newEvents = this.events.filter(e => e.id > model.lastEventId);
        const groupedEvents: {host: types.core.Host, contextId: types.context.ContextId, changes: {userId: types.cloud.UserId, userPubKey: types.core.EccPubKey, action: "login"|"logout"}[]}[] = [];
        
        const groups = new Map<string, typeof groupedEvents[0]>();
        
        for (const evt of newEvents) {
            const key = `${evt.host}/${evt.contextId}`;
            let group = groups.get(key);
            if (!group) {
                group = {
                    host: evt.host,
                    contextId: evt.contextId,
                    changes: [],
                };
                groups.set(key, group);
                groupedEvents.push(group);
            }
            group.changes.push({
                userId: evt.userId,
                userPubKey: evt.userPubKey,
                action: evt.action,
            });
        }
        
        return {
            events: groupedEvents,
            lastEventId: this.lastEventId,
        };
    }
    
    isUserActive(host: types.core.Host, userPubkey: types.core.EccPubKey, solutionIds: types.cloud.SolutionId[]) {
        for (const solution of solutionIds) {
            const entry = this.usersSet.has(`${host}/${solution}/${userPubkey}`);
            if (entry) {
                return true;
            }
        }
        return false;
    }
}