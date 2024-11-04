/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as AdvValidator from "adv-validator";
import { AppException } from "./AppException";
import { ApiMethod } from "./Decorators";

export class BaseApi {
    
    constructor(
        protected paramsValidator: AdvValidator.Types.PerNameValidator
    ) {
    }
    
    async execute(method: string, params: any): Promise<any> {
        const m = (<any>this)[method];
        if (!ApiMethod.getExportedMethod(this.constructor, method) || typeof(m) != "function") {
            throw new AppException("METHOD_NOT_FOUND");
        }
        await this.validateAccess(method, params);
        this.validateParams(method, params);
        return m.call(this, params);
    }
    
    protected validateParams(method: string, params: any): void {
        this.paramsValidator.validate(method, params);
    }
    
    protected validateAccess(_method: string, _params: any): Promise<void>|void {
        return;
    }
}
