/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "./";

export type ContextId = string&{__contextId: never};
export type ContextName = string&{__contextName: never};
export type ContextDescription = string&{__contextDescription: never};
export type ContextScope = "public"|"private";

export interface ContextPolicy {
    /** Policy for threads in this context */
    thread?: types.cloud.ContainerPolicy;
    /** Policy for stores in this context */
    store?: types.cloud.ContainerPolicy;
    /** Policy for inboxes in this context */
    inbox?: types.cloud.ContainerWithoutItemPolicy;
    /** Policy for streams in this context */
    stream?: types.cloud.ContainerWithoutItemPolicy;
}
