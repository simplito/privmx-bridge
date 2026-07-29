/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface Inbox {
    id: types.inbox.InboxId;
    resourceId?: types.core.ClientResourceId;
    contextId: types.context.ContextId;
    createDate: types.core.Timestamp;
    creator: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    data: InboxDataEntry[];
    keyId: types.core.KeyId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    keys: types.core.KeyEntry[];
    version: types.inbox.InboxVersion;
    type?: types.inbox.InboxType;
    policy: types.cloud.ContainerWithoutItemPolicy;
}

export interface InboxDataEntry {
    keyId: types.core.KeyId;
    data: types.inbox.InboxData;
}

export interface InboxCreateModel {
    contextId: types.context.ContextId;
    resourceId?: types.core.ClientResourceId;
    type?: types.inbox.InboxType;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.inbox.InboxData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    policy?: types.cloud.ContainerWithoutItemPolicy;
}

export interface InboxCreateResult {
    inboxId: types.inbox.InboxId;
}

export interface InboxDeleteManyResult {
    results: types.inbox.InboxDeleteStatus[];
}

export interface InboxUpdateModel {
    id: types.inbox.InboxId;
    resourceId?: types.core.ClientResourceId;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    data: types.inbox.InboxData;
    keyId: types.core.KeyId;
    keys: types.cloud.KeyEntrySet[];
    version: types.inbox.InboxVersion;
    force: boolean;
    policy?: types.cloud.ContainerWithoutItemPolicy;
}

export interface InboxDeleteModel {
    inboxId: types.inbox.InboxId;
}

export interface InboxDeleteManyModel {
    inboxIds: types.inbox.InboxId[];
}

export interface InboxGetModel {
    id: types.inbox.InboxId;
    type?: types.inbox.InboxType;
}

export interface InboxGetResult {
    inbox: Inbox;
}

export interface InboxListModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    scope?: types.core.ContainerAccessScope;
    type?: types.inbox.InboxType;
    sortBy?: "createDate"|"lastModificationDate";
}

export interface InboxListResult {
    inboxes: Inbox[];
    count: number;
}

export interface InboxListAllModel extends types.core.ListModel {
    contextId: types.context.ContextId;
    type?: types.inbox.InboxType;
    sortBy?: "createDate"|"lastModificationDate";
}

export type InboxListAllResult = InboxListResult;

export interface InboxSendModel {
    inboxId: types.inbox.InboxId;
    resourceId?: types.core.ClientResourceId;
    message: types.thread.ThreadMessageData;
    requestId?: types.request.RequestId;
    files: {
        fileIndex: number;
        thumbIndex?: number;
        meta: types.store.StoreFileMeta;
        resourceId?: types.core.ClientResourceId;
    }[];
    version: types.inbox.InboxVersion;
}

export interface InboxGetPublicViewResult {
    inboxId: types.inbox.InboxId;
    contextId: types.context.ContextId;
    version: types.inbox.InboxVersion;
    publicData: types.inbox.InboxPublicData;
}

export type InboxCreatedEvent = types.cloud.Event<"inboxCreated", "inbox", InboxCreatedEventData>;
export type InboxCreatedEventData = Inbox;

export type InboxUpdatedEvent = types.cloud.Event<"inboxUpdated", "inbox", InboxUpdatedEventData>;
export type InboxUpdatedEventData = Inbox;

export type InboxDeletedEvent = types.cloud.Event<"inboxDeleted", "inbox", InboxDeletedEventData>;
export interface InboxDeletedEventData {
    inboxId: types.inbox.InboxId;
    type?: types.inbox.InboxType;
}

export type InboxCustomEvent = types.cloud.Event<"custom", `inbox/${types.inbox.InboxId}/${types.core.WsChannelName}`, InboxCustomEventData>;

export interface InboxCustomEventData {
    id: types.inbox.InboxId;
    keyId: types.core.KeyId;
    eventData: unknown;
    author: types.cloud.UserIdentity;
};

export interface InboxSendCustomEventModel {
    inboxId: types.inbox.InboxId;
    channel: types.core.WsChannelName;
    keyId: types.core.KeyId;
    data: unknown;
    users?: types.cloud.UserId[];
}

export interface IInboxApi {
    inboxCreate(model: InboxCreateModel): Promise<InboxCreateResult>;
    inboxUpdate(model: InboxUpdateModel): Promise<types.core.OK>;
    inboxDelete(model: InboxDeleteModel): Promise<types.core.OK>;
    inboxDeleteMany(model: InboxDeleteManyModel): Promise<InboxDeleteManyResult>;
    inboxGet(model: InboxGetModel): Promise<InboxGetResult>;
    inboxGetPublicView(model: InboxGetModel): Promise<InboxGetPublicViewResult>;
    inboxList(model: InboxListModel): Promise<InboxListResult>;
    inboxListAll(model: InboxListAllModel): Promise<InboxListAllResult>;
    inboxSend(model: InboxSendModel): Promise<types.core.OK>;
    inboxSendCustomEvent(model: InboxSendCustomEventModel): Promise<types.core.OK>;
}
