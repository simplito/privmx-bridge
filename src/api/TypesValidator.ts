/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as AdvValidator from "adv-validator";
import Validator = AdvValidator.Types.Validator;
import ObjectValidator = AdvValidator.Types.ObjectValidator;
import { ECUtils } from "../utils/crypto/ECUtils";
import * as types from "../types";
import { StringChecker } from "../utils/StringChecker";
import * as ByteBuffer from "bytebuffer";
import { Crypto } from "../utils/crypto/Crypto";

export interface CustomValidatorWithLength extends AdvValidator.Types.CustomValidator, AdvValidator.Types.WithLengthValidator {
}

export class TypesValidator {
    
    builder: AdvValidator.ValidatorBuilder;
    checker: AdvValidator.ValidatorChecker;
    
    byteBuffer: CustomValidatorWithLength;
    eccPub: Validator;
    base64: CustomValidatorWithLength;
    bi10: Validator;
    bi16: Validator;
    intNonNegative: Validator;
    username: Validator;
    loginProperty: Validator;
    loginProperties: ObjectValidator;
    requestId: Validator;
    keyId: Validator;
    userKeyData: Validator;
    eccSignature: Validator;
    timestampStr: Validator;
    timestamp: Validator;
    nonce: Validator;
    deviceId: Validator;
    ip: Validator;
    sessionId: Validator;
    userAgent: Validator;
    userAgentOpt: Validator;
    id: Validator;
    bufferReadRange: Validator;
    cloudInstanceId: Validator;
    cloudContextId: Validator;
    cloudSolutionId: Validator;
    cloudSolutionName: Validator;
    cloudUserId: Validator;
    cloudUserPubKey: Validator;
    threadId: Validator;
    threadMessageId: Validator;
    threadData: Validator;
    threadMessageData: Validator;
    cloudKeyEntrySet: Validator;
    storeId: Validator;
    storeData: Validator;
    storeFileId: Validator;
    storeFileMeta: Validator;
    listModel: ObjectValidator;
    inboxId: Validator;
    inboxData: Validator;
    streamRoomId: Validator;
    streamRoomData: Validator;
    unknown4Kb: Validator;
    unknown16Kb: Validator;
    resourceType: Validator;
    optResourceType: Validator;
    contextAcl: Validator;
    apiKeyId: Validator;
    apiKeyName: Validator;
    apiKeySecret: Validator;
    apiAccessToken: Validator;
    apiRefreshToken: Validator;
    apiScope: Validator;
    contextName: Validator;
    contextDescription: Validator;
    contextScope: Validator;
    ed25519PemPublicKey: Validator;
    contextPolicy: Validator;
    containerPolicy: Validator;
    containerWithoutItemPolicy: Validator;
    itemPolicy: Validator;
    sortOrder: Validator;
    limit: Validator;
    plainApiWsChannelName: Validator;
    dbQuery: Validator;
    queryPropertiesMap: Validator;
    queryProperty: Validator;
    queryValue: Validator;
    objectId: Validator;
    wsChannelName: Validator;
    subscriptionId: Validator;
    kvdbId: Validator;
    kvdbData: Validator;
    kvdbEntryKey: Validator;
    uuidv4: Validator;
    containerAccessScope: Validator;
    optionalContainerAccessScope: Validator;
    
    constructor() {
        this.builder = new AdvValidator.ValidatorBuilder();
        this.checker = new AdvValidator.ValidatorChecker();
        
        this.byteBuffer = this.builder.createCustom((value, validator, checker) => {
            if (value instanceof ByteBuffer) {
                value = value.toBuffer();
            }
            if (!Buffer.isBuffer(value)) {
                throw new Error("Expected buffer");
            }
            checker.validateLength(value.length, validator as AdvValidator.Types.WithLengthValidator);
        });
        this.eccPub = this.builder.createCustom(value => {
            if (typeof(value) !== "string") {
                throw new Error("Expected string");
            }
            const ecc = ECUtils.publicFromBase58DER(value as types.core.EccPubKey);
            if (ecc === null) {
                throw new Error("Expected Ecc public key");
            }
            return;
        });
        this.base64 = this.builder.createCustom((value, validator, checker) => {
            if (typeof(value) !== "string") {
                throw new Error("Expected string");
            }
            const base64Info = StringChecker.getBase64Info(value);
            if (!base64Info.valid) {
                throw new Error("Expected base64");
            }
            checker.validateLength(base64Info.length, validator as AdvValidator.Types.WithLengthValidator);
        });
        this.bi16 = this.builder.createCustom((value) => {
            if (typeof(value) !== "string") {
                throw new Error("Expected string");
            }
            if (!StringChecker.isStringHex(value)) {
                throw new Error("Expected BigInteger from hex");
            }
        });
        this.bi10 = this.builder.createCustom((value) => {
            if (typeof(value) !== "string") {
                throw new Error("Expected string");
            }
            if (!StringChecker.isStringDigit(value)) {
                throw new Error("Expected BigInteger from decimal");
            }
        });
        this.intNonNegative = this.builder.min(this.builder.int, 0);
        const usernameRegex = /^[a-z0-9]+([._-]?[a-z0-9]+)*$/;
        this.username = this.builder.extends(this.builder.error(this.builder.rangeLength(this.builder.string, 3, 50), "INVALID_USERNAME"), {custom: (s: string) => usernameRegex.test(s)});
        this.id = this.builder.rangeLength(this.builder.string, 1, 60);
        
        this.eccSignature = this.builder.error(this.builder.length(this.base64, 65), "INVALID_SIGNATURE");
        
        this.timestampStr = this.builder.error(this.bi10, "INVALID_TIMESTAMP");
        this.timestamp = this.builder.error(this.builder.int, "INVALID_TIMESTAMP");
        this.nonce = this.builder.error(this.builder.rangeLength(this.builder.string, 32, 64), "INVALID_NONCE");
        this.deviceId = this.builder.maxLength(this.builder.string, 150);
        this.ip = this.builder.maxLength(this.builder.string, 150);
        this.sessionId = this.builder.maxLength(this.builder.string, 150);
        this.userAgent = this.builder.maxLength(this.builder.string, 1024);
        this.userAgentOpt = this.builder.nullableOptional(this.userAgent);
        this.unknown4Kb = this.builder.createCustom(value => {
            const size = this.getValueSize(value, "<root>");
            const maxSize = 4096;
            if (size > maxSize) {
                throw new Error("Invalid length! Expected max " + maxSize + ", get " + size);
            }
        });
        this.unknown16Kb = this.builder.createCustom(value => {
            const size = this.getValueSize(value, "<root>");
            const maxSize = 16384;
            if (size > maxSize) {
                throw new Error("Invalid length! Expected max " + maxSize + ", get " + size);
            }
        });
        this.loginProperty = this.builder.optional(this.builder.maxLength(this.builder.string, 150));
        this.loginProperties = this.builder.createObject({
            appVersion: this.loginProperty,
            sysVersion: this.loginProperty,
            deviceId: this.builder.optional(this.deviceId),
            deviceName: this.builder.optional(this.loginProperty),
            osName: this.builder.optional(this.loginProperty),
            deviceToken: this.loginProperty,
            unregisteredSession: this.builder.optional(this.builder.maxLength(this.builder.string, 1024)),
        });
        
        this.keyId = this.builder.rangeLength(this.builder.string, 1, 128);
        this.userKeyData = this.unknown4Kb;
        this.requestId = this.builder.rangeLength(this.builder.string, 1, 60);
        
        this.bufferReadRange = this.builder.createOneOf([
            this.builder.createObject({
                type: this.builder.createConst("all"),
            }),
            this.builder.createObject({
                type: this.builder.createConst("slice"),
                from: this.intNonNegative,
                to: this.intNonNegative,
            }),
            this.builder.createObject({
                type: this.builder.createConst("checksum"),
            }),
        ], "type");
        const id = this.builder.rangeLength(this.builder.string, 1, 128);
        
        this.cloudInstanceId = id;
        this.cloudContextId = id;
        this.cloudSolutionId = id;
        this.cloudSolutionName = this.builder.maxLength(this.builder.string, 256);
        this.cloudUserId = id;
        this.cloudUserPubKey = this.eccPub;
        this.threadId = id;
        this.threadMessageId = id;
        this.threadData = this.unknown4Kb;
        this.kvdbData = this.unknown4Kb;
        this.threadMessageData = this.unknown16Kb;
        this.cloudKeyEntrySet = this.builder.createObject({
            user: this.cloudUserId,
            keyId: this.keyId,
            data: this.userKeyData,
        });
        this.storeId = id;
        this.storeData = this.unknown4Kb;
        this.storeFileId = id;
        this.storeFileMeta = this.unknown4Kb;
        this.queryValue = this.builder.createOneOf([this.builder.int, this.builder.string, this.builder.bool, this.builder.nullValue]);
        this.queryProperty = this.builder.createOneOf([this.queryValue, this.builder.createObject({
            $gt: this.builder.optional(this.builder.int),
            $gte: this.builder.optional(this.builder.int),
            $lt: this.builder.optional(this.builder.int),
            $lte: this.builder.optional(this.builder.int),
            $exists: this.builder.optional(this.builder.bool),
            $eq: this.builder.optional(this.queryValue),
            $ne: this.builder.optional(this.queryValue),
            $in: this.builder.optional(this.builder.createList(this.queryValue)),
            $nin: this.builder.optional(this.builder.createList(this.queryValue)),
            $startsWith: this.builder.optional(this.builder.string),
            $endsWith: this.builder.optional(this.builder.string),
            $contains: this.builder.optional(this.builder.string),
        })]);
        this.queryPropertiesMap = this.builder.createMap(this.builder.string, this.queryProperty);
        const dbQueryValidators = [] as Validator[];
        this.dbQuery = this.builder.createOneOf(dbQueryValidators);
        dbQueryValidators.push(this.builder.createObject({
            $and: this.builder.createList(this.dbQuery),
        }));
        dbQueryValidators.push(this.builder.createObject({
            $or: this.builder.createList(this.dbQuery),
        }));
        dbQueryValidators.push(this.builder.createObject({
            $nor: this.builder.createList(this.dbQuery),
        }));
        dbQueryValidators.push(this.queryPropertiesMap);
        this.listModel = this.builder.createObject({
            skip: this.intNonNegative,
            limit: this.builder.range(this.builder.int, 1, 100),
            sortOrder: this.builder.createEnum(["asc", "desc"]),
            lastId: this.builder.optional(id),
            query: this.builder.optional(this.dbQuery),
            
        });
        this.inboxId = id;
        this.inboxData = this.builder.createObject({
            threadId: this.threadId,
            storeId: this.storeId,
            fileConfig: this.builder.createObject({
                minCount: this.intNonNegative,
                maxCount: this.intNonNegative,
                maxFileSize: this.intNonNegative,
                maxWholeUploadSize: this.intNonNegative,
            }),
            meta: this.unknown4Kb,
            publicData: this.unknown4Kb,
        });
        this.streamRoomId = id;
        this.streamRoomData = this.unknown4Kb;
        this.resourceType = this.builder.rangeLength(this.builder.string, 1, 128);
        this.optResourceType = this.builder.optional(this.resourceType);
        this.contextAcl = this.builder.maxLength(this.builder.string, 4096);
        this.apiKeyId = id;
        this.apiKeySecret = this.builder.rangeLength(this.builder.string, 1, 128);
        this.apiAccessToken = this.builder.rangeLength(this.builder.string, 1, 2048);
        this.apiRefreshToken = this.apiAccessToken;
        this.apiScope = this.builder.createListWithMaxLength(this.builder.rangeLength(this.builder.string, 1, 128), 128);
        this.apiKeyName = this.builder.maxLength(this.builder.string, 128);
        this.contextName = this.builder.maxLength(this.builder.string, 128);
        this.contextDescription = this.builder.maxLength(this.builder.string, 128);
        this.contextScope = this.builder.createEnum(["private", "public"]);
        this.ed25519PemPublicKey = this.builder.createCustom(value => {
            if (typeof(value) !== "string") {
                throw new Error("Expected string");
            }
            if (!Crypto.isEd25519PEMPublicKey(value)) {
                throw new Error("Not ed25519 PEM public key");
            }
        });
        const policyEntry = this.builder.optional(this.builder.maxLength(this.builder.string, 32));
        this.itemPolicy = this.builder.createObject({
            get: policyEntry,
            listMy: policyEntry,
            listAll: policyEntry,
            create: policyEntry,
            update: policyEntry,
            delete: policyEntry,
        });
        this.containerWithoutItemPolicy = this.builder.addFields(this.itemPolicy, {
            updatePolicy: policyEntry,
            creatorHasToBeManager: policyEntry,
            updaterCanBeRemovedFromManagers: policyEntry,
            ownerCanBeRemovedFromManagers: policyEntry,
            canOverwriteContextPolicy: policyEntry,
        });
        this.containerPolicy = this.builder.addFields(this.containerWithoutItemPolicy, {
            item: this.builder.optional(this.itemPolicy),
        });
        this.contextPolicy = this.builder.addFields(this.itemPolicy, {
            thread: this.builder.optional(this.containerPolicy),
            store: this.builder.optional(this.containerPolicy),
            kvdb: this.builder.optional(this.containerPolicy),
            inbox: this.builder.optional(this.containerWithoutItemPolicy),
            stream: this.builder.optional(this.containerWithoutItemPolicy),
        });
        this.limit = this.builder.range(this.builder.int, 1, 100);
        this.sortOrder = this.builder.createEnum(["asc", "desc"]);
        this.plainApiWsChannelName = this.builder.createEnum(["thread", "store", "stream", "inbox", "kvdb"]);
        this.wsChannelName = this.builder.createCustom((value) => {
            const alphaNumericalRegex = /^[a-zA-Z0-9,/_|=:-]*$/;
            if (typeof value !== "string") {
                throw new Error("Expected string");
            }
            if (!alphaNumericalRegex.test(value)) {
                throw new Error("Value has to be alphanumerical string with '/', '|', '=', `:`, '-', ',' and '_' special characters only");
            }
            if (value.length > 512) {
                throw new Error("Max value length: 512");
            }
        });
        this.objectId = this.builder.rangeLength(this.builder.string, 3, 128);
        this.subscriptionId = id;
        this.kvdbId = id;
        this.kvdbEntryKey = this.builder.createCustom((value) => {
            const kvdbEntryKeyRegex = /^[a-zA-Z0-9/_:-]*$/;
            if (typeof value !== "string") {
                throw new Error("Expected string");
            }
            if (value.length < 1 || value.length > 256) {
                throw new Error("Invalid length, expected range between 1-256.");
            }
            if (!kvdbEntryKeyRegex.test(value)) {
                throw new Error("Value has to be an alphanumerical string with '/', `_`, ':' and '-' special characters only. No whitespaces allowed.");
            }
        });
        this.uuidv4 = this.builder.createCustom((value) => {
            const uuidv4Regex = /^[0-9A-F]{8}-[0-9A-F]{4}-[4][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i;
            if (typeof value !== "string") {
                throw new Error("Expected string");
            }
            if (!uuidv4Regex.test(value)) {
                throw new Error("Value has to be uuid v4");
            }
        });
        this.containerAccessScope = this.builder.createEnum(["ALL", "MANAGER", "USER", "MEMBER", "OWNER"]);
        this.optionalContainerAccessScope = this.builder.optional(this.containerAccessScope);
    }
    
    createAcl(entryType: Validator, aclType: Validator, propertyType: Validator, maxEntryLength: number, maxAclLength: number, maxAclListLength: number) {
        const acls = this.builder.createListWithMaxLength(this.builder.createObject({
            type: this.builder.createEnum([0, 1, 2, 3]),
            property: propertyType,
            list: this.builder.createListWithMaxLength(aclType, maxAclListLength),
        }), maxAclLength);
        return this.builder.createObject({
            defaultAcls: this.builder.optional(acls),
            list: this.builder.createListWithMaxLength(this.builder.createOneOf([
                entryType,
                this.builder.createObject({
                    value: entryType,
                    acls: acls,
                }),
            ]), maxEntryLength),
        });
    }
    
    getValueSize(value: unknown, entryPath: string): number {
        if (typeof(value) === "undefined") {
            return 0;
        }
        if (typeof(value) === "number") {
            return value.toString().length;
        }
        if (typeof(value) === "string") {
            return value.length + 2;
        }
        if (value === true) {
            return 4;
        }
        if (value === false) {
            return 5;
        }
        if (typeof(value) === "object") {
            if (value === null) {
                return 4;
            }
            if (Array.isArray(value)) {
                let size = 2;
                for (const [i, e] of value.entries()) {
                    size += this.getValueSize(e, entryPath + "[" + i + "]") + 1;
                }
                return size;
            }
            let size = 2;
            if (value.constructor.name !== "Object") {
                throw new Error("Not plain object at " + entryPath);
            }
            for (const key in value) {
                size += key.length + 4 + this.getValueSize((value as any)[key], entryPath + "." + key);
            }
            return size;
        }
        throw new Error("Unsupported value at " + entryPath);
    }
}
