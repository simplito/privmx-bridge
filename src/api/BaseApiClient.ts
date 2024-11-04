/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as PrivmxRpc from "privmx-rpc";

export class BaseApiClient {
    
    constructor(
        public conn: PrivmxRpc.AuthorizedConnection,
    ) {
    }
    
    protected async request<T>(method: string, params: unknown) {
        const result = await this.conn.call(method, params, {sendAlone: true});
        const decoded = this.decode(result) as T;
        return decoded;
    }
    
    protected decode(val: any) {
        if (val !== null && typeof(val) === "object") {
            if (val.constructor.name === "Long") {
                return val.toNumber();
            }
            if (Array.isArray(val)) {
                const res: any[] = [];
                for (const x of val) {
                    res.push(this.decode(x));
                }
                return res;
            }
            else {
                const res: any = {};
                for (const key in val) {
                    res[key] = this.decode(val[key]);
                }
                return res;
            }
        }
        return val;
    }
}
