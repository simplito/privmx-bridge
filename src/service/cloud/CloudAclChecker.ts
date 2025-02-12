/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../types";
import { AppException } from "../../api/AppException";

export type AclFunctionNameX =
    | "context/contextGetUsers"
    | "context/contextSendCustomNotification"
    | "context/READ"
    | "context/WRITE"
    | "context/ALL"
    | "thread/threadGet"
    | "thread/threadList"
    | "thread/threadListAll"
    | "thread/threadMessageGet"
    | "thread/threadMessagesGet"
    | "thread/threadMessagesGetMy"
    | "thread/READ"
    | "thread/threadCreate"
    | "thread/threadUpdate"
    | "thread/threadDelete"
    | "thread/threadDeleteMany"
    | "thread/threadMessageSend"
    | "thread/threadMessageUpdate"
    | "thread/threadMessageDelete"
    | "thread/threadMessageDeleteMany"
    | "thread/threadMessageDeleteOlderThan"
    | "thread/threadSendCustomNotification"
    | "thread/WRITE"
    | "thread/ALL"
    | "store/storeGet"
    | "store/storeList"
    | "store/storeListAll"
    | "store/storeFileGet"
    | "store/storeFileGetMany"
    | "store/storeFileList"
    | "store/storeFileListMy"
    | "store/storeFileRead"
    | "store/READ"
    | "store/storeCreate"
    | "store/storeUpdate"
    | "store/storeDelete"
    | "store/storeDeleteMany"
    | "store/storeFileCreate"
    | "store/storeFileWrite"
    | "store/storeFileUpdate"
    | "store/storeFileDelete"
    | "store/storeFileDeleteMany"
    | "store/storeFileDeleteOlderThan"
    | "store/storeSendCustomNotification"
    | "store/WRITE"
    | "store/ALL"
    | "inbox/inboxGet"
    | "inbox/inboxList"
    | "inbox/inboxListAll"
    | "inbox/READ"
    | "inbox/inboxCreate"
    | "inbox/inboxUpdate"
    | "inbox/inboxDelete"
    | "inbox/inboxDeleteMany"
    | "inbox/inboxSendCustomNotification"
    | "inbox/WRITE"
    | "inbox/ALL"
    | "stream/streamRoomGet"
    | "stream/streamRoomList"
    | "stream/streamRoomListAll"
    | "stream/READ"
    | "stream/streamRoomCreate"
    | "stream/streamRoomUpdate"
    | "stream/streamRoomDelete"
    | "stream/streamRoomDeleteMany"
    | "stream/streamSendCustomNotification"
    | "stream/WRITE"
    | "stream/ALL"
    | "READ"
    | "WRITE"
    | "ALL";

export class CloudAclChecker {
    
    private functions: types.cloud.AclFunctions;
    private groups = new Map<types.cloud.AclGroupName, types.cloud.AclFunctions>();
    
    constructor() {
        // ===================
        //        CONTEXT
        // ===================
        
        const contextRead = {
            "context/contextGetUsers": ["contextId"],
        } as types.cloud.AclFunctions;
        this.groups.set("context/READ" as types.cloud.AclGroupName, contextRead);
        const contextWrite = {
            "context/contextSendCustomNotification": ["contextId"],
        } as types.cloud.AclFunctions;
        this.groups.set("context/WRITE" as types.cloud.AclGroupName, contextWrite);
        const contextAll = {...contextRead, ...contextWrite};
        this.groups.set("context/ALL" as types.cloud.AclGroupName, contextAll);
        
        // ===================
        //        THREAD
        // ===================
        const threadRead = {
            "thread/threadGet": ["threadId"],
            "thread/threadList": [],
            "thread/threadListAll": [],
            "thread/threadMessageGet": ["threadId", "messageId"],
            "thread/threadMessagesGet": ["threadId"],
            "thread/threadMessagesGetMy": ["threadId"],
        } as types.cloud.AclFunctions;
        this.groups.set("thread/READ" as types.cloud.AclGroupName, threadRead);
        const threadWrite = {
            "thread/threadCreate": [],
            "thread/threadUpdate": ["threadId"],
            "thread/threadDelete": ["threadId"],
            "thread/threadDeleteMany": [],
            "thread/threadMessageSend": ["threadId"],
            "thread/threadMessageUpdate": ["threadId", "messageId"],
            "thread/threadMessageDelete": ["threadId", "messageId"],
            "thread/threadMessageDeleteMany": ["threadId"],
            "thread/threadMessageDeleteOlderThan": ["threadId"],
            "thread/threadSendCustomNotification": ["threadId"],
        } as types.cloud.AclFunctions;
        this.groups.set("thread/WRITE" as types.cloud.AclGroupName, threadWrite);
        const threadAll = {...threadRead, ...threadWrite};
        this.groups.set("thread/ALL" as types.cloud.AclGroupName, threadAll);
        
        // ===================
        //        STORE
        // ===================
        const storeRead = {
            "store/storeGet": ["storeId"],
            "store/storeList": [],
            "store/storeListAll": [],
            "store/storeFileGet": ["storeId", "fileId"],
            "store/storeFileGetMany": ["storeId"],
            "store/storeFileList": ["storeId"],
            "store/storeFileListMy": ["storeId"],
            "store/storeFileRead": ["storeId", "fileId"],
        } as types.cloud.AclFunctions;
        this.groups.set("store/READ" as types.cloud.AclGroupName, storeRead);
        const storeWrite = {
            "store/storeCreate": [],
            "store/storeUpdate": ["storeId"],
            "store/storeDelete": ["storeId"],
            "store/storeDeleteMany": [],
            "store/storeFileCreate": ["storeId"],
            "store/storeFileWrite": ["storeId", "fileId"],
            "store/storeFileUpdate": ["storeId", "fileId"],
            "store/storeFileDelete": ["storeId", "fileId"],
            "store/storeFileDeleteMany": ["storeId"],
            "store/storeFileDeleteOlderThan": ["storeId"],
            "store/storeSendCustomNotification": ["storeId"],
        } as types.cloud.AclFunctions;
        this.groups.set("store/WRITE" as types.cloud.AclGroupName, storeWrite);
        const storeAll = {...storeRead, ...storeWrite};
        this.groups.set("store/ALL" as types.cloud.AclGroupName, storeAll);
        
        // ===================
        //        INBOX
        // ===================
        const inboxRead = {
            "inbox/inboxGet": ["inboxId"],
            "inbox/inboxList": [],
            "inbox/inboxListAll": [],
        } as types.cloud.AclFunctions;
        this.groups.set("inbox/READ" as types.cloud.AclGroupName, inboxRead);
        const inboxWrite = {
            "inbox/inboxCreate": [],
            "inbox/inboxUpdate": ["inboxId"],
            "inbox/inboxDelete": ["inboxId"],
            "inbox/inboxDeleteMany": [],
            "inbox/inboxSendCustomNotification": ["inboxId"],
        } as types.cloud.AclFunctions;
        this.groups.set("inbox/WRITE" as types.cloud.AclGroupName, inboxWrite);
        const inboxAll = {...inboxRead, ...inboxWrite};
        this.groups.set("inbox/ALL" as types.cloud.AclGroupName, inboxAll);
        
        // ===================
        //    STREAM ROOM
        // ===================
        const streamRead = {
            "stream/streamRoomGet": ["streamRoomId"],
            "stream/streamRoomList": [],
            "stream/streamRoomListAll": [],
        } as types.cloud.AclFunctions;
        this.groups.set("stream/READ" as types.cloud.AclGroupName, streamRead);
        const streamWrite = {
            "stream/streamRoomCreate": [],
            "stream/streamRoomUpdate": ["streamRoomId"],
            "stream/streamRoomDelete": ["streamRoomId"],
            "stream/streamRoomDeleteMany": [],
            "stream/streamSendCustomNotification": ["streamRoomId"],
        } as types.cloud.AclFunctions;
        this.groups.set("stream/WRITE" as types.cloud.AclGroupName, streamWrite);
        const streamAll = {...streamRead, ...streamWrite};
        this.groups.set("stream/ALL" as types.cloud.AclGroupName, streamAll);
        
        // ===================
        //         ALL
        // ===================
        const allRead = {...storeRead, ...threadRead, ...inboxRead, ...streamRead, ...contextRead};
        this.groups.set("READ" as types.cloud.AclGroupName, allRead);
        const allWrite = {...storeWrite, ...threadRead, ...inboxRead, ...streamRead, ...contextWrite};
        this.groups.set("WRITE" as types.cloud.AclGroupName, allWrite);
        const allAll = {...storeAll, ...threadAll, ...inboxAll, ...streamAll, ...contextAll};
        this.groups.set("ALL" as types.cloud.AclGroupName, allAll);
        
        this.functions = allAll;
    }
    
    getAclInfo() {
        const groups: types.cloud.AclGroups = {};
        for (const [key, value] of this.groups) {
            groups[key] = value;
        }
        return {functions: this.functions, groups};
    }
    
    validateAcl(acl: string, maxLines: number): asserts acl is types.cloud.ContextAcl {
        const lines = acl.split("\n");
        if (lines.length > maxLines) {
            throw new Error(`Too much rules! Expected max ${maxLines}, get ${lines.length}`);
        }
        for (const [i, line] of lines.entries()) {
            this.validateAclEntry(i, line);
        }
    }
    
    checkAcl(acl: string) {
        try {
            this.validateAcl(acl, 100);
        }
        catch {
            throw new AppException("INVALID_ACL");
        }
    }
    
    private validateAclEntry(index: number, aclEntry: string) {
        const parts = aclEntry.split(" ");
        const verb = parts[0];
        if (verb !== "ALLOW" && verb !== "DENY") {
            throw new Error(`Expected DENY|ALLOW in line ${index + 1}`);
        }
        if (parts.length < 2) {
            throw new Error(`Expected at least 2 parameters in line ${index + 1}`);
        }
        const action = parts[1];
        if (action in this.functions) {
            const actionArgs = this.functions[action as types.cloud.AclFunctionName];
            const args = parts.slice(2);
            const used = new Set<string>();
            for (const arg of args) {
                const argParts = arg.split("=") as types.cloud.AclFunctionArgument[];
                if (argParts.length != 2) {
                    throw new Error(`Invalid argument '${arg}' for '${action}' in line ${index + 1}`);
                }
                const argName = argParts[0];
                if (used.has(argName)) {
                    throw new Error(`Argument '${argName}' duplicated for '${action}' in line ${index + 1}`);
                }
                if (!actionArgs.includes(argName)) {
                    throw new Error(`Unsupported argument '${argName}' for '${action}' in line ${index + 1}`);
                }
                used.add(argName);
            }
        }
        else if (this.groups.has(action as types.cloud.AclGroupName)) {
            if (parts.length > 2) {
                throw new Error(`Unexpected arguments for '${action}' in line ${index + 1}`);
            }
        }
        else {
            throw new Error(`Unknown action '${action}' in line ${index + 1}`);
        }
    }
    
    verifyAccess(acl: types.cloud.ContextAcl, fnName: AclFunctionNameX, args: string[]) {
        if (!this.hasAccess(acl, fnName, args)) {
            throw new AppException("ACCESS_DENIED");
        }
    }
    
    private hasAccess(acl: types.cloud.ContextAcl, fnName: AclFunctionNameX, args: string[]) {
        let allow = false;
        for (const aclEntry of acl.split("\n")) {
            const parts = aclEntry.split(" ");
            if (this.fnMatch(parts, fnName, args)) {
                allow = parts[0] === "ALLOW";
            }
        }
        return allow;
    }
    
    private fnMatch(acl: string[], fnName: AclFunctionNameX, args: string[]) {
        const fnNameOrGroupName = acl[1];
        if (fnNameOrGroupName === fnName) {
            return this.argsMatch(acl.slice(2), args);
        }
        else if (this.groupIncludesFn(fnNameOrGroupName, fnName)) {
            return this.argsMatch(acl.slice(2), args);
        }
        return false;
    }
    
    private groupIncludesFn(groupName: string, fnName: AclFunctionNameX) {
        const group = this.groups.get(groupName as types.cloud.AclGroupName);
        return group && fnName in group;
    }
    
    private argsMatch(acl: string[], args: string[]) {
        return acl.every(x => args.includes(x));
    }
}
