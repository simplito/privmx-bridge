/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as types from "../../types";
import * as contextApi from "../../api/main/context/ContextApiTypes";
import { ContextApiValidator } from "../../api/main/context/ContextApiValidator";
import { TypesValidator } from "../../api/TypesValidator";
import { Utils } from "../../utils/Utils";
import { ECUtils } from "../../utils/crypto/ECUtils";

const groupPubKey = ECUtils.generateKeyPair().pub58 as unknown as types.cloud.GroupPubKey;
const contextId = "MyContextId" as types.context.ContextId;
const groupId = "MyGroupId" as types.group.GroupId;
const keyId = "MyKeyId" as types.core.KeyId;

function validator() {
    return new ContextApiValidator(new TypesValidator());
}

function validGroupCreate(): contextApi.GroupCreateModel {
    return {
        contextId: contextId,
        groupPubKey: groupPubKey,
        users: ["janek"] as types.cloud.UserId[],
        managers: ["janek"] as types.cloud.UserId[],
        data: "someData" as types.group.GroupData,
        keyId: keyId,
        keys: [],
    };
}

it("ContextApiValidator.groupCreate valid", () => {
    const result = Utils.try(() => validator().validate("groupCreate", validGroupCreate()));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupCreate rejects invalid groupPubKey", () => {
    const model = {...validGroupCreate(), groupPubKey: "not-a-valid-ecc-key!!!" as types.cloud.GroupPubKey};
    const result = Utils.try(() => validator().validate("groupCreate", model));
    expect(result.success).toBe(false);
});

it("ContextApiValidator.groupUpdate valid", () => {
    const model: contextApi.GroupUpdateModel = {
        id: groupId,
        groupPubKey: groupPubKey,
        users: ["janek"] as types.cloud.UserId[],
        managers: ["janek"] as types.cloud.UserId[],
        data: "someData" as types.group.GroupData,
        keyId: keyId,
        keys: [],
        version: 1 as types.group.GroupVersion,
        force: false,
    };
    const result = Utils.try(() => validator().validate("groupUpdate", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupGet valid", () => {
    const result = Utils.try(() => validator().validate("groupGet", {groupId: groupId}));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupList valid with sortBy", () => {
    const model: contextApi.GroupListModel = {
        contextId: contextId,
        skip: 0,
        limit: 10,
        sortOrder: "asc",
        sortBy: "createDate",
    };
    const result = Utils.try(() => validator().validate("groupList", model));
    expect(result.success).toBe(true);
});

it("ContextApiValidator.groupList rejects invalid sortBy", () => {
    const model = {
        contextId: contextId,
        skip: 0,
        limit: 10,
        sortOrder: "asc",
        sortBy: "nonsense",
    };
    const result = Utils.try(() => validator().validate("groupList", model));
    expect(result.success).toBe(false);
});
