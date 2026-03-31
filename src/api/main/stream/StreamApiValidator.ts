/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseValidator } from "../../BaseValidator";
import { TypesValidator } from "../../TypesValidator";

export class StreamApiValidator extends BaseValidator {
    
    constructor(
        private tv: TypesValidator,
    ) {
        super();
        
        this.registerMethod("streamRoomCreate", this.builder.createObject({
            contextId: this.tv.cloudContextId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            type: this.tv.optResourceType,
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            data: this.tv.streamRoomData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384),
            policy: this.builder.optional(this.tv.containerWithoutItemPolicy),
        }));
        
        this.registerMethod("streamRoomUpdate", this.builder.createObject({
            id: this.tv.streamRoomId,
            resourceId: this.builder.optional(this.tv.uuidv4),
            users: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            managers: this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384),
            data: this.tv.streamRoomData,
            keyId: this.tv.keyId,
            keys: this.builder.createListWithMaxLength(this.tv.cloudKeyEntrySet, 16384),
            version: this.tv.intNonNegative,
            force: this.builder.bool,
            policy: this.builder.optional(this.tv.containerWithoutItemPolicy),
        }));
        
        this.registerMethod("streamRoomDelete", this.builder.createObject({
            id: this.tv.streamRoomId,
        }));
        
        this.registerMethod("streamRoomDeleteMany", this.builder.createObject({
            ids: this.builder.createListWithMaxLength(this.tv.streamRoomId, 128),
        }));
        
        this.registerMethod("streamRoomGet", this.builder.createObject({
            id: this.tv.streamRoomId,
            type: this.tv.optResourceType,
        }));
        
        this.registerMethod("streamRoomList", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            scope: this.tv.optionalContainerAccessScope,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate"])),
        }));
        
        this.registerMethod("streamRoomListAll", this.builder.addFields(this.tv.listModel, {
            contextId: this.tv.cloudContextId,
            type: this.tv.optResourceType,
            sortBy: this.builder.optional(this.builder.createEnum(["createDate", "lastModificationDate"])),
        }));
        
        this.registerMethod("streamList", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
        }));
        
        this.registerMethod("streamPublish", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
            offer: this.builder.createObject({
                type: this.builder.createConst("offer"),
                sdp: this.builder.string,
            }),
        }));
        
        this.registerMethod("streamUpdate", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
            offer: this.builder.createObject({
                type: this.builder.createConst("offer"),
                sdp: this.builder.string,
            }),
        }));
        
        this.registerMethod("streamRoomJoin", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
        }));
        this.registerMethod("streamRoomEnableRecording", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
        }));
        this.registerMethod("streamRoomLeave", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
        }));
        this.registerMethod("streamsSubscribeToRemote", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
            subscriptionsToAdd: this.builder.createList(
                this.builder.createObject({
                    streamId: this.tv.streamId,
                    streamTrackId: this.builder.optional(this.builder.string),
                }),
            ),
        }));
        this.registerMethod("streamsUnsubscribeFromRemote", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
            subscriptionsToRemove: this.builder.createList(
                this.builder.createObject({
                    streamId: this.tv.streamId,
                    streamTrackId: this.builder.optional(this.builder.string),
                }),
            ),
        }));
        this.registerMethod("streamsModifyRemoteSubscriptions", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
            subscriptionsToAdd: this.builder.createListWithMinLength(
                this.builder.createObject({
                    streamId: this.tv.streamId,
                    streamTrackId: this.builder.optional(this.builder.string),
                })
                , 0),
            subscriptionsToRemove: this.builder.createListWithMinLength(
                this.builder.createObject({
                    streamId: this.tv.streamId,
                    streamTrackId: this.builder.optional(this.builder.string),
                })
                , 0),
        }));
        this.registerMethod("streamAcceptOffer", this.builder.createObject({
            sessionId: this.builder.int,
            answer: this.builder.createObject({
                type: this.builder.createConst("answer"),
                sdp: this.builder.string,
            }),
        }));
        
        this.registerMethod("streamSetNewOffer", this.builder.createObject({
            sessionId: this.builder.int,
            offer: this.builder.createObject({
                type: this.builder.createConst("offer"),
                sdp: this.builder.string,
            }),
        }));
        
        this.registerMethod("streamTrickle", this.builder.createObject({
            sessionId: this.builder.int,
            rtcCandidate: this.builder.createObject({
                address: this.tv.stringOrNull,
                candidate: this.builder.string,
                component: this.builder.createEnum(["rtcp", "rtp"]),
                foundation: this.tv.stringOrNull,
                port: this.tv.numberOrNull,
                priority: this.tv.numberOrNull,
                protocol: this.builder.createEnum(["tcp", "udp"]),
                relatedAddress: this.tv.stringOrNull,
                relatedPort: this.tv.numberOrNull,
                sdpMLineIndex: this.tv.numberOrNull,
                sdpMid: this.tv.stringOrNull,
                tcpType: this.builder.createEnum(["active", "passive", "so"]),
                type: this.builder.createEnum(["host", "prflx", "relay", "srflx"]),
                usernameFragment: this.tv.stringOrNull,
            }),
        }));
        
        this.registerMethod("streamGetTurnCredentials", this.builder.empty);
        
        this.registerMethod("streamRoomSendCustomEvent", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
            channel: this.tv.wsChannelName,
            keyId: this.tv.keyId,
            data: this.tv.unknown16Kb,
            users: this.builder.optional(this.builder.createListWithMaxLength(this.tv.cloudUserId, 16384)),
        }));
        
        this.registerMethod("streamUnpublish", this.builder.createObject({
            sessionId: this.builder.int,
        }));
        
        this.registerMethod("streamRoomClose", this.builder.createObject({
            streamRoomId: this.tv.streamRoomId,
        }));
    }
}
