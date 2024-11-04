/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { BaseApi } from "../../../api/BaseApi";
import * as initApi from "./InitApiTypes";
import { ApiMethod } from "../../../api/Decorators";
import { InitApiValidator } from "./InitApiValidator";

export class InitApi extends BaseApi implements initApi.IInitApi {
    
    constructor(
        initApiValidator: InitApiValidator,
    ) {
        super(initApiValidator);
    }
    
    @ApiMethod({})
    async versions(): Promise<string[]> {
        return ["v2.0"];
    }
}