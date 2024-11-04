/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export interface ISession {
    contains(key: string): boolean;
    save(key: string, value: string): void;
    get(key: string, def?: string): string;
    delete(key: string): void;
}
