/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as lockApi from "./LockApiTypes";
import { LockService } from "../../../service/cloud/LockService";
import { ApiMethod } from "../../Decorators";
import { SessionService } from "../../session/SessionService";
import { LockApiValidator } from "./LockApiValidator";
import { BaseApi } from "../../BaseApi";

export class LockApi extends BaseApi implements lockApi.ILockApi {
    
    constructor(
        lockApiValidator: LockApiValidator,
        private lockService: LockService,
        private sessionService: SessionService,
    ) {
        super(lockApiValidator);
    }
    
    @ApiMethod({})
    async lockLock(model: lockApi.LockLockModel): Promise<lockApi.LockOperationResult> {
        this.sessionService.validateContextSessionAndGetCloudUser();
        return this.lockService.lock(model.resourceId, model.uuid, model.lockLevel);
    }
    
    @ApiMethod({})
    async lockUnlock(model: lockApi.LockUnlockModel): Promise<lockApi.LockOperationResult> {
        this.sessionService.validateContextSessionAndGetCloudUser();
        return this.lockService.unlock(model.resourceId, model.uuid, model.lockLevel);
    }
    
    @ApiMethod({})
    async lockCheckReservedLock(model: lockApi.LockCheckReservedLockModel): Promise<lockApi.LockCheckReservedLockResult> {
        this.sessionService.validateContextSessionAndGetCloudUser();
        return this.lockService.checkReservedLock(model.resourceId, model.uuid);
    }
}
