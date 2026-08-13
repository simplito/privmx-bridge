/*!
PrivMX Bridge.
Copyright © 2026 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as types from "../../types";
import { CloudLockService } from "../../cluster/master/ipcServices/CloudLockService";
import { InMemoryLockStore } from "../../cluster/master/ipcServices/lock/InMemoryLockStore";

const h1 = "tenant-one.example.com" as types.core.Host;
const h2 = "tenant-two.example.com" as types.core.Host;

it("CloudLockService.HostNamespacesLocksPerTenant", async () => {
    const service = new CloudLockService(new InMemoryLockStore(() => 1_000));
    // same resourceId under two different hosts are fully independent locks
    expect(await service.resourceLock({host: h1, resourceId: "res", uuid: "a", lockLevel: "exclusive"}))
        .toEqual({success: true, currentLevel: "exclusive"});
    expect(await service.resourceLock({host: h2, resourceId: "res", uuid: "b", lockLevel: "exclusive"}))
        .toEqual({success: true, currentLevel: "exclusive"});
    // but within a host the lock is contended as expected
    expect(await service.resourceLock({host: h1, resourceId: "res", uuid: "b", lockLevel: "exclusive"}))
        .toEqual({success: false, currentLevel: "none"});
    // releasing the lock under one host must not affect the other host's lock
    expect(await service.resourceUnlock({host: h2, resourceId: "res", uuid: "b", lockLevel: "none"}))
        .toEqual({success: true, currentLevel: "none"});
    expect(await service.resourceCheckReservedLock({host: h2, resourceId: "res", uuid: "c"}))
        .toEqual({reserved: false});
    expect(await service.resourceCheckReservedLock({host: h1, resourceId: "res", uuid: "c"}))
        .toEqual({reserved: true});
});
