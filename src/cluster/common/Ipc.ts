/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export interface IpcRequest<T = unknown> {
    id: number;
    method: string;
    params: T;
}

export type IpcResponse = IpcResponseSuccess|IpcResponseError;
export interface IpcResponseSuccess<T = unknown> {
    id: number;
    result: T;
}
export interface IpcResponseError {
    id: number;
    error: string;
}
export interface IpcChannelMessage {
    channel: string;
    data: unknown;
}

export interface IpcBatchState {
    queue: IpcChannelMessage[];
    debounceTimer: NodeJS.Timeout | null;
    maxWaitTimer: NodeJS.Timeout | null;
}

export function isIpcRequest(message: any): message is IpcRequest {
    return message && typeof(message) === "object" && typeof(message.id) === "number" && typeof(message.method) === "string" && "params" in message;
}

export function isIpcResponse(message: any): message is IpcResponse {
    return message && typeof(message) === "object" && typeof(message.id) === "number" && ("result" in message || "error" in message);
}

export function isIpcChannelMessage(message: any): message is IpcChannelMessage {
    return message && typeof(message) === "object" && typeof(message.channel) === "string" && ("data" in message);
}