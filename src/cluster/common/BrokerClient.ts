/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { IpcChannelMessage } from "./Ipc";

export interface EventPayload {
    sender: string,
    data: IpcChannelMessage,
}

export type MessageHandler = (data: EventPayload) => void;

export interface IBrokerClient {
    onMessage(handler: MessageHandler): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    publish(data: IpcChannelMessage): Promise<void>;
}