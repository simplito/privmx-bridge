/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { PsonHelperEx } from "../../utils/PsonHelperEx";
import { WebSocketEx, WebSocketSession } from "../../CommonTypes";
import { Crypto } from "../../utils/crypto/Crypto";
import { EncoderHelper, EncoderType } from "../../utils/Encoder";
import *  as types from "../../types";
import { DateUtils } from "../../utils/DateUtils";
export class WebSocketOutboundHandler {
    
    private encoderHelper: EncoderHelper;
    
    constructor() {
        this.encoderHelper = new EncoderHelper(new PsonHelperEx([]));
    }
    
    sendToWsSession<T extends types.core.Event<any, any>>(ws: WebSocketEx, session: WebSocketSession, event: T) {
        if (session.encoder === EncoderType.PSON) {
            const serializedPayload = this.serializeEvent(session.encoder, event);
            const preparedEvent = this.prepareEvent(session, serializedPayload, session.plainCommunication);
            ws.send(preparedEvent);
            return;
        }
        session.eventBucket.push(event);
        
        const INITIAL_DELAY = 20;
        const MAX_DELAY = 100;
        
        const flushBatch = () => {
            for (const virtualSession of ws.ex.sessions) {
                if (virtualSession.eventBucket.length > 0 && ws.readyState === ws.OPEN) {
                    const serializedBatch = this.serializeEvent(EncoderType.MSGPACK, virtualSession.eventBucket);
                    const preparedBatch = this.prepareEvent(virtualSession, serializedBatch, virtualSession.plainCommunication);
                    virtualSession.eventBucket = [];
                    ws.send(preparedBatch);
                }
                else {
                    virtualSession.eventBucket = [];
                }
            }
            ws.ex.flushTimer = undefined;
            ws.ex.batchStartTime = undefined;
        };
        
        if (!ws.ex.flushTimer) {
            ws.ex.batchStartTime = DateUtils.now();
            ws.ex.flushTimer = setTimeout(flushBatch, INITIAL_DELAY);
        }
        else {
            clearTimeout(ws.ex.flushTimer);
            const elapsedTime = DateUtils.now() - (ws.ex.batchStartTime ?? DateUtils.now());
            const remainingTimeInWindow = MAX_DELAY - elapsedTime;
            const newDelay = Math.max(0, Math.min(INITIAL_DELAY, remainingTimeInWindow));
            ws.ex.flushTimer = setTimeout(flushBatch, newDelay);
        }
    }
    
    private prepareEvent(session: WebSocketSession, message: Buffer, plain?: boolean) {
        const prefix = this.preparePrefix(session);
        const cipher = Buffer.concat([prefix, plain ? message : Crypto.aes256CbcHmac256Encrypt(message, session.encryptionKey)]);
        return cipher;
    }
    
    private preparePrefix(session: WebSocketSession) {
        if (session.addWsChannelId) {
            const prefix = Buffer.alloc(8, 0);
            prefix.writeUInt32BE(session.wsChannelId, 4);
            return prefix;
        }
        return Buffer.alloc(4, 0);
    }
    
    private serializeEvent(encoder: EncoderType, event: any) {
        return this.encoderHelper.getEncoder(encoder).encode(event);
    }
}
