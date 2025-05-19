/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable @stylistic/js/key-spacing */

import * as types from "../types";

export const API_ERROR_CODES = {
    "PARSE_ERROR"                          : {code: -32700, message: "Parse error"},
    "INVALID_REQUEST"                      : {code: -32600, message: "Invalid Request"},
    "METHOD_NOT_FOUND"                     : {code: -32601, message: "Method not found"},
    "INVALID_PARAMS"                       : {code: -32602, message: "Invalid params"},
    "INTERNAL_ERROR"                       : {code: -32603, message: "Internal error"},
    "ONLY_POST_METHOD_ALLOWED"             : {code: -32605, message: "Only post method allowed"},
    
    "INVALID_USERNAME"                     : {code: 0x0002, message: "Invalid username"},
    "INVALID_SIGNATURE"                    : {code: 0x0008, message: "Invalid signature"},
    "USER_DOESNT_EXIST"                    : {code: 0x0009, message: "User doesn't exist"},
    "UNKNOWN_SESSION"                      : {code: 0x000C, message: "Unknown session"},
    "INVALID_SESSION_STATE"                : {code: 0x000D, message: "Invalid session state"},
    "INVALID_A"                            : {code: 0x000E, message: "Invalid A"},
    "DIFFERENT_M1"                         : {code: 0x000F, message: "Different M1"},
    "INVALID_TOKEN"                        : {code: 0x0015, message: "Invalid token"},
    "INVALID_TIMESTAMP"                    : {code: 0x0028, message: "Invalid timestamp"},
    "INVALID_NONCE"                        : {code: 0x0029, message: "Invalid nonce"},
    "ACCESS_DENIED"                        : {code: 0x0030, message: "Access denied"},
    "LOGIN_REJECTED"                       : {code: 0x0040, message: "Login rejected"},
    "INVALID_VERSION"                      : {code: 0x0063, message: "Invalid version"},
    "INVALID_DEVICE_ID"                    : {code: 0x0064, message: "Invalid device id"},
    "PUB_KEY_ALREADY_IN_USE"               : {code: 0x0065, message: "Pub key already in use"},
    "MAINTENANCE_MODE"                     : {code: 0x0068, message: "Maintenance mode"},
    "INVALID_PROXY_SESSION"                : {code: 0x0069, message: "Invalid proxy session"},
    "INVALID_KEY"                          : {code: 0x0070, message: "Invalid key"},
    "WEBSOCKET_REQUIRED"                   : {code: 0x0072, message: "Websocket required"},
    "WEBSOCKET_ALREADY_AUTHORIZED"         : {code: 0x0073, message: "Websocket already authorized"},
    "NEED_2FA_AUTHENTICATION"              : {code: 0x0081, message: "Need 2FA authentication"},
    "EXCEEDED_LIMIT_OF_WEBSOCKET_CHANNELS" : {code: 0x0085, message: "Exceeded limit of websocket channels"},
    "ADD_WS_CHANNEL_ID_REQUIRED_ON_MULTI_CHANNEL_WEBSOCKET" : {code: 0x0086, message: "AddWsChannelId required on multi channel websocket"},
    "CANNOT_ADD_CHANNEL_TO_SINGLE_CHANNEL_WEBSOCKET" : {code: 0x0087, message: "Cannot add channel to single channel websocket"},
    
    "THREAD_DOES_NOT_EXIST"                : {code: 0x6001, message: "Thread does not exist"},
    "INVALID_THREAD_KEY"                   : {code: 0x6002, message: "Invalid thread key"},
    "REQUEST_DOES_NOT_EXIST"               : {code: 0x6003, message: "Request does not exist"},
    "REQUEST_FILE_DOES_NOT_EXIST"          : {code: 0x6004, message: "Request file does not exist"},
    "REQUEST_FILE_ALREADY_CLOSED"          : {code: 0x6005, message: "Request file aready closed"},
    "REQUEST_SIZE_EXCEEDED"                : {code: 0x6006, message: "Request size exceeded"},
    "REQUEST_FILE_SIZE_EXCEEDED"           : {code: 0x6007, message: "Request file size exceeded"},
    "TOO_MANY_FILES_IN_REQUEST"            : {code: 0x6008, message: "Too many files in request"},
    "REQUEST_FILE_DESYNCHRONIZED"          : {code: 0x6009, message: "Request file desynchronized"},
    "INVALID_FILE_INDEX"                   : {code: 0x600A, message: "Invalid file index"},
    "FILE_ALREADY_USED"                    : {code: 0x600B, message: "File already used"},
    "REQUEST_NOT_READY_YET"                : {code: 0x600C, message: "Request not ready yet"},
    "THREAD_MESSAGE_DOES_NOT_EXIST"        : {code: 0x600D, message: "Thread message does not exist"},
    "INVALID_KEY_ID"                       : {code: 0x6015, message: "Invalid key id"},
    "FILES_CONTAINER_FILE_HAS_NOT_THUMB"    : {code: 0x6105, message: "Files container file has not thumb"},
    "UNSUPPORTED_OPERATION"                 : {code: 0x6115, message: "Unsupported operation"},
    "CONTEXT_DOES_NOT_EXIST"                : {code: 0x6116, message: "Context does not exist"},
    "STORE_DOES_NOT_EXIST"                  : {code: 0x6117, message: "Store does not exist"},
    "STORE_FILE_DOES_NOT_EXIST"             : {code: 0x6118, message: "Store file does not exist"},
    "UNSUPPORTED_RESOURCE_TYPE"             : {code: 0x6119, message: "Unsupported resource type"},
    "RESOURCE_DOES_NOT_EXIST"               : {code: 0x611A, message: "Resource does not exist"},
    "CANNOT_QUERY_NOT_ROOT_RESOURCE"        : {code: 0x611B, message: "Cannot query not root resource"},
    "CANNOT_QUERY_ROOT_RESOURCE"            : {code: 0x611C, message: "Cannot query root resource"},
    "RESOURCE_FIELD_DOES_NOT_EXIST"         : {code: 0x611D, message: "Resource field does not exist"},
    "INBOX_DOES_NOT_EXIST"                  : {code: 0x611E, message: "Inbox does not exist"},
    "NOT_ENOUGH_FILES_IN_REQUEST"           : {code: 0x611F, message: "Not enough files in request"},
    "THREAD_BELONGS_TO_INBOX"               : {code: 0x6120, message: "Thread belongs to inbox"},
    "STORE_BELONGS_TO_INBOX"                : {code: 0x6121, message: "Store belongs to inbox"},
    "STREAM_ROOM_DOES_NOT_EXIST"            : {code: 0x6122, message: "Stream room does not exist"},
    "NO_MATCH_FOR_LAST_ID"                  : {code: 0x6123, message: "Object with lastId does not exist"},
    "RESOURCES_HAVE_DIFFERENT_CONTEXTS"     : {code: 0x6124, message: "Resources does not belong to same context"},
    "MESSAGES_BELONGS_TO_DIFFERENT_THREADS" : {code: 0x6125, message: "Messages does not belong to same thread"},
    "FILES_BELONGS_TO_DIFFERENT_STORES"     : {code: 0x6126, message: "Files does not belong to same store"},
    "REQUEST_CHUNK_TOO_SMALL"               : {code: 0x6127, message: "Request chunk too small"},
    "STORE_FILE_VERSION_MISMATCH"           : {code: 0x6128, message: "Store file version mismatch"},
    "FILE_DOES_NOT_BELONG_TO_STORE"         : {code: 0x612A, message: "File does not belong to store"},
    "API_KEY_DOES_NOT_EXIST"                : {code: 0x612B, message: "Api key does not exist"},
    "INVALID_CREDENTIALS"                   : {code: 0x612C, message: "Invalid credentials"},
    "API_KEYS_LIMIT_EXCEEDED"               : {code: 0x612D, message: "Api keys limit exceeded"},
    "INSUFFICIENT_SCOPE"                    : {code: 0x612E, message: "Insufficient scope"},
    "UNAUTHORIZED"                          : {code: 0x612F, message: "Unauthorized"},
    "SOLUTION_DOES_NOT_EXIST"               : {code: 0x6130, message: "Solution does not exist"},
    "INVALID_ACL"                           : {code: 0x6131, message: "Invalid ACL"},
    "SOLUTION_HAS_CONTEXTS"                 : {code: 0x6132, message: "Solution has contexts"},
    "CANNOT_ASSIGN_PRIVATE_CONTEXT"         : {code: 0x6133, message: "Cannot assign private context"},
    "CANNOT_UNASSIGN_CONTEXT_FROM_ITS_PARENT": {code: 0x6134, message: "Cannot unassign context from its parent"},
    "CANNOT_SWITCH_CONNECTED_CONTEXT_TO_PRIVATE": {code: 0x6135, message: "Cannot switch connected context to private"},
    "METHOD_CALLABLE_WITH_WEBSOCKET_ONLY"   : {code: 0x6136, message: "Method is callable with websocket only"},
    "USER_DOES_NOT_HAVE_ACCESS_TO_CONTAINER": {code: 0x6137, message: "User does not have access to container"},
    "DUPLICATE_RESOURCE_ID"                   : {code: 0x6138, message: "Provided ID is already in use"},
    "TOO_MANY_CHANNELS_IN_SESSION"          : {code: 0x6139, message: "Too many channels in this websocket session"},
    "WS_SESSION_DOES_NOT_EXISTS"            : {code: 0x613A, message: "Websocket session does not exists"},
    "RESOURCE_ID_MISSMATCH"                 : {code: 0x613B, message: "Provided resource ID missmatch object resource ID"},
    "KVDB_DOES_NOT_EXIST"                   : {code: 0x613C, message: "Kvdb does not exist"},
    "KVDB_ENTRY_DOES_NOT_EXIST"              : {code: 0x613D, message: "Kvdb item does not exist"},
    "FIRST_API_KEY_ALREADY_EXISTS"          : {code: 0x613E, message: "First api key was already created"},
    "INITIALIZATION_TOKEN_MISSMATCH"        : {code: 0x613F, message: "Initialization token is invalid or not set"},
};
export const ERROR_CODES: {[name: string]: {code: types.core.ErrorCode, message: types.core.ErrorMessage}} = <any>API_ERROR_CODES;

export type ErrorCode = keyof typeof API_ERROR_CODES;

export class AppException extends Error {
    
    code: types.core.ErrorCode;
    message: types.core.ErrorMessage;
    data: any;
    
    constructor(name: ErrorCode, data: any = null) {
        super();
        const e = ERROR_CODES[name] || ERROR_CODES.INTERNAL_ERROR;
        this.message = e.message;
        this.code = e.code;
        this.data = data;
    }
    
    getCode(): types.core.ErrorCode {
        return this.code;
    }
    
    getMessage(): types.core.ErrorMessage {
        return this.message;
    }
    
    setData(data: any = null): AppException {
        this.data = data;
        return this;
    }
    
    getData(): any {
        return this.data;
    }
    
    static fromRemote(result: any) {
        if (result != null && "code" in result) {
            const code = result.code;
            if (code >= 0) {
                for (const name in ERROR_CODES) {
                    if (ERROR_CODES[name].code == code) {
                        throw new AppException(<ErrorCode>name, result.data);
                    }
                }
            }
            throw new Error("JsonRpc error: " + (result.message || "") + " [" + code + "]");
        }
        throw new Error("JsonRpc error");
    }
    
    static internal(ex: any): void {
        if (ex instanceof AppException) {
            throw ex;
        }
        throw new AppException("INTERNAL_ERROR");
    }
    
    static is(e: any, errorName: ErrorCode): e is AppException {
        return e instanceof AppException && e.code == API_ERROR_CODES[errorName].code;
    }
    
    static isValidApiErrorCode(errorName: string): errorName is ErrorCode {
        return errorName in ERROR_CODES;
    }
}
