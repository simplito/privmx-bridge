/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Logger } from "../../service/log/LoggerFactory";
import { RWState } from "./RWState";
import { ContentType } from "./ContentType";
import { Crypto } from "../../utils/crypto/Crypto";
import { Utils } from "../../utils/Utils";
import { Hex } from "../../utils/Hex";
import { PsonHelperEx } from "../../utils/PsonHelperEx";
import * as types from "../../types";
import { StreamInterface } from "../../CommonTypes";
import { AlertError } from "./AlertError";
import { RpcError } from "./RpcError";

export abstract class PrivmxConnectionBase {
    
    protected static dict = [
        "type", "ticket", "tickets", "ticket_id", "ticket_request",
        "ticket_response", "ecdhe", "ecdh", "key", "count", "client_random",
    ];
    
    protected version: number;
    
    protected masterSecret: Buffer;
    protected clientRandom: Buffer;
    protected serverRandom: Buffer;
    
    protected writeState: RWState;
    protected readState: RWState;
    protected nextReadState: RWState;
    protected nextWriteState: RWState;
    
    protected appFrameHandler?: (connection: this, data: Buffer) => Promise<void>|void;
    public output?: StreamInterface;
    public readonly psonHelper: PsonHelperEx;
    
    constructor(
        protected requiredHelloPacket: boolean,
        protected logger: Logger,
    ) {
        this.version = 1;
        this.writeState = new RWState();
        this.readState  = new RWState();
        this.nextReadState  = new RWState();
        this.nextWriteState = new RWState();
        this.clientRandom = Buffer.alloc(0);
        this.serverRandom = Buffer.alloc(0);
        this.masterSecret = Buffer.alloc(0);
        this.psonHelper = new PsonHelperEx(PrivmxConnectionBase.dict);
    }
    
    setAppFrameHandler(appFrameHandler: (connection: this, data: Buffer) => Promise<void>|void) {
        this.appFrameHandler = appFrameHandler;
    }
    
    /**
     * Sends a single binary data packet of specified content type.
     */
    send(packet: Buffer, contentType: number = ContentType.APPLICATION_DATA, forcePlaintext: boolean = false) {
        let frameHeader: Buffer;
        let frameData: Buffer;
        let frameMac: Buffer;
        if (!forcePlaintext && this.writeState.isInitialized()) {
            this.logger.debug("send encrypted " + contentType);
            let frameLength = packet.length;
            if (frameLength > 0) {
                // eslint-disable-next-line no-bitwise
                frameLength = ((frameLength + 16) >> 4) << 4;
            }
            
            const tmp = Buffer.alloc(4);
            tmp.writeUInt32BE(frameLength, 0);
            const frameHeaderBody = Buffer.concat([Buffer.from([this.version, contentType]), tmp, Buffer.from([0, 0])]);
            
            const seqBin = Utils.encodeUint64BE(this.writeState.sequenceNumber);
            this.writeState.sequenceNumber++;
            
            const frameSeed = Buffer.concat([seqBin, frameHeaderBody]);
            const frameHeaderTag  = Crypto.hmacSha256(this.writeState.macKey, frameSeed).slice(0, 8);
            
            frameHeader = Buffer.concat([frameHeaderBody, frameHeaderTag]);
            if (this.logger.isHandling(Logger.DEBUG)) {
                this.logger.debug("raw frame header\n" + Utils.hexDump(frameHeader, true));
                this.logger.debug("raw frame data\n" +
                    (packet.length > 1024 ? Utils.hexDump(packet.slice(0, 1024)) + "..." : Utils.hexDump(packet, true)),
                );
            }
            frameHeader = Crypto.aes256EcbEncrypt(frameHeader, this.writeState.key);
            
            if (frameLength > 0) {
                const iv = frameHeader;
                frameData = Crypto.aes256CbcPkcs7Encrypt(packet, this.writeState.key, iv);
                
                frameMac = Crypto.hmacSha256(this.writeState.macKey, Buffer.concat([frameSeed, iv, frameData])).slice(0, 16);
            }
            else {
                frameData = Buffer.alloc(0);
                frameMac = Buffer.alloc(0);
            }
        }
        else {
            this.logger.debug("send plaintext " + contentType);
            // Encryption context not initialized
            const frameLength = packet.length;
            
            const tmp = Buffer.alloc(4);
            tmp.writeUInt32BE(frameLength, 0);
            frameHeader = Buffer.concat([Buffer.from([this.version, contentType]), tmp, Buffer.from([0, 0])]);
            frameData = packet;
            frameMac = Buffer.alloc(0);
        }
        
        if (!this.output) {
            throw new Error("Output stream not set");
        }
        this.output.write(frameHeader);
        this.output.write(frameData);
        this.output.write(frameMac);
        if (this.logger.isHandling(Logger.DEBUG)) {
            this.logger.debug("send frame header\n" + Utils.hexDump(frameHeader, true));
            this.logger.debug("send frame data\n" +
                (frameData.length > 1024 ? Utils.hexDump(frameData.slice(0, 1024)) + "..." : Utils.hexDump(frameData, true)),
            );
            this.logger.debug("send frame macKey\n" + Utils.hexDump(frameMac, true));
        }
    }
    
    async process(input: StreamInterface) {
        if (this.logger.isHandling(Logger.DEBUG)) {
            const content = input.getBuffer();
            this.logger.debug("received\n" +
                (content.length > 1024 ? Utils.hexDump(content.slice(0, 1024)) + "..." : Utils.hexDump(content)),
            );
        }
        let iv = Buffer.alloc(0);
        let frameSeed = Buffer.alloc(0);
        let frameHeader: Buffer;
        let frameIndex = 0;
        while (!input.eof()) {
            frameIndex++;
            if (this.readState.isInitialized()) {
                frameHeader = Utils.readFromStream(input, 16);
                if (frameHeader.length == 0) {
                    if (!input.eof()) {
                        throw new RpcError("read error (read 0 bytes)");
                    }
                    return;
                }
                
                // Reuse encrypted frameHeader as IV for frame data
                iv = frameHeader;
                
                frameHeader = Crypto.aes256EcbDecrypt(frameHeader, this.readState.key);
                
                const frameHeaderTag = frameHeader.slice(8);
                frameHeader = frameHeader.slice(0, 8);
                
                const seqBin = Utils.encodeUint64BE(this.readState.sequenceNumber);
                this.readState.sequenceNumber++;
                
                frameSeed = Buffer.concat([seqBin, frameHeader]);
                const expectedTag = Crypto.hmacSha256(this.readState.macKey, frameSeed).slice(0, 8);
                
                if (!frameHeaderTag.equals(expectedTag)) {
                    throw new RpcError("Invalid frame TAG");
                }
            }
            else {
                frameHeader = Utils.readFromStream(input, 8);
                if (frameHeader.length == 0) {
                    if (!input.eof()) {
                        throw new RpcError("read error (read 0 bytes)");
                    }
                    return;
                }
            }
            
            const frameVersion = frameHeader.readUInt8(0);
            if (frameVersion != this.version) {
                throw new RpcError("Unsupported version " + frameVersion + " " + this.version);
            }
            
            const frameContentType = frameHeader.readUInt8(1);
            const frameLength = frameHeader.readUInt32BE(2);
            
            this.logger.debug("process " + (this.readState.isInitialized() ? "encrypted" : "plaintext") + " frame " + frameContentType + ", l: " + frameLength);
            
            let frameData: Buffer;
            if (frameLength > 0) {
                const cipherText = Utils.readFromStream(input, frameLength);
                
                if (this.readState.isInitialized()) {
                    const frameMac  = Utils.readFromStream(input, 16);
                    
                    const macData = Buffer.concat([frameSeed, iv, cipherText]);
                    const expectedMac = Crypto.hmacSha256(this.readState.macKey, macData).slice(0, 16);
                    if (!frameMac.equals(expectedMac)) {
                        throw new RpcError("Invalid frame MAC");
                    }
                    frameData = Crypto.aes256CbcPkcs7Decrypt(cipherText, this.readState.key, iv);
                }
                else {
                    frameData = cipherText;
                }
            }
            else {
                frameData = Buffer.alloc(0);
            }
            if (this.requiredHelloPacket && frameIndex == 1 && frameContentType != ContentType.HELLO) {
                throw new RpcError("Hello packet required");
            }
            
            switch (frameContentType) {
                case ContentType.APPLICATION_DATA: {
                    this.logger.debug("application", {data: frameData});
                    if (this.appFrameHandler) {
                        await this.appFrameHandler(this, frameData);
                    }
                    break;
                }
                case ContentType.HANDSHAKE: {
                    const packetResult = Utils.try(() => this.psonHelper.pson_decode<types.packet.BasePacket>(frameData));
                    if (packetResult.success === false) {
                        throw new RpcError("Invalid handshake data. Cannot decode given PSON");
                    }
                    const packet = packetResult.result;
                    if (!packet.type) {
                        throw new RpcError("Invalid handshake data");
                    }
                    await this.processHandshakePacket(packet);
                    break;
                }
                case ContentType.CHANGE_CIPHER_SPEC: {
                    this.logger.debug("change cipher spec");
                    this.changeReadCipherSpec();
                    break;
                }
                case ContentType.ALERT: {
                    const alertMessage = frameData.toString();
                    this.logger.error("Got ALERT - " + alertMessage);
                    throw new AlertError(alertMessage);
                }
                case ContentType.HELLO: {
                    const packetResult = Utils.try(() => this.psonHelper.pson_decode<string>(frameData));
                    if (packetResult.success === false) {
                        throw new RpcError("Invalid hello data. Cannot decode given PSON");
                    }
                    if (typeof(packetResult.result) !== "string") {
                        throw new RpcError("Invalid hello data. Expected string");
                    }
                    await this.processHelloPacket(packetResult.result);
                }
            }
        }
    }
    
    abstract processHandshakePacket(packet: types.packet.BasePacket): Promise<void>;
    
    abstract processHelloPacket(helloPacket: string): Promise<void>;
    
    setOutputStream(output: StreamInterface): void {
        this.output = output;
    }
    
    restoreState(ticketId: Buffer, masterSecret: Buffer, clientRandom: Buffer, plain: boolean) {
        this.logger.debug("restore " + Hex.from(ticketId) + " " + Hex.from(clientRandom));
        this.clientRandom = clientRandom;
        this.serverRandom = ticketId;
        this.masterSecret = masterSecret;
        
        const rwStates = this.getFreshRWStates(this.masterSecret, this.clientRandom, this.serverRandom);
        this.nextReadState  = rwStates.readState;
        this.nextWriteState = rwStates.writeState;
        
        if (!plain) {
            this.changeWriteCipherSpec();
        }
    }
    
    private changeReadCipherSpec() {
        if (!this.nextReadState.isInitialized()) {
            throw new RpcError("Invalid next read state");
        }
        this.readState = this.nextReadState;
        this.nextReadState = new RWState();
    }
    
    changeWriteCipherSpec() {
        if (!this.nextWriteState.isInitialized()) {
            throw new RpcError("Invalid next write state");
        }
        this.send(Buffer.alloc(0), ContentType.CHANGE_CIPHER_SPEC);
        this.writeState = this.nextWriteState;
        this.nextWriteState = new RWState();
    }
    
    getFreshRWStates(masterSecret: Buffer, clientRandom: Buffer, serverRandom: Buffer) {
        const keyBlock = Crypto.prf_tls12(masterSecret, Buffer.concat([Buffer.from("key expansion", "utf8"), serverRandom, clientRandom]), 4 * 32);
        
        this.logger.debug("new key material", {key_block: Hex.from(keyBlock.slice(0, 16)) + "..."});
        
        const clientMacKey = keyBlock.slice(0, 32);
        const serverMacKey = keyBlock.slice(32, 64);
        const clientKey = keyBlock.slice(64, 96);
        const serverKey = keyBlock.slice(96, 128);
        
        return this.getFreshRWStatesFromParams(new RWState(clientKey, clientMacKey), new RWState(serverKey, serverMacKey));
    }
    
    abstract getFreshRWStatesFromParams(client: RWState, server: RWState): {readState: RWState, writeState: RWState};
    
    setPreMasterSecret(preMasterSecret: Buffer): void {
        const clientRandom = this.clientRandom;
        const serverRandom = this.serverRandom;
        
        const masterSecret = Crypto.prf_tls12(preMasterSecret, Buffer.concat([Buffer.from("master secret"), clientRandom, serverRandom]), 48);
        this.masterSecret = masterSecret;
        
        this.logger.debug("new master secret", {masterSecret: Hex.from(masterSecret.slice(0, 16)) + "..."});
        
        const rwStates = this.getFreshRWStates(masterSecret, clientRandom, serverRandom);
        this.nextReadState  = rwStates.readState;
        this.nextWriteState = rwStates.writeState;
    }
}
