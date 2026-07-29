/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { ManagerApi } from "./ManagerApi";
import { ManagerApiValidator } from "./ManagerApiValidator";
import * as types from "../../../types";
import { testApi } from "../../../test/api/Utils";
import { TypesValidator } from "../../../api/TypesValidator";

export const test = testApi("client", "manager/", ManagerApi, new ManagerApiValidator(new TypesValidator()), call => {
    call("getApiKey", api => api.getApiKey({
        id: "hysd62jsd7823nasd03" as types.auth.ApiKeyId,
    })).setResult({
        apiKey: {
            id: "hysd62jsd7823nasd03" as types.auth.ApiKeyId,
            created: 1726652150623 as types.core.Timestamp,
            enabled: true,
            name: "MyApiKey" as types.auth.ApiKeyName,
            scope: ["apiKey", "solution", "context"] as types.auth.Scope[],
        },
    });
    call("auth", api => api.auth({
        apiKeyId: "hysd62jsd7823nasd03" as types.auth.ApiKeyId,
        apiKeySecret: "759a1d8edba555badf1216b0f381b94950141" as types.auth.ApiKeySecret,
        grantType: "api_key_credentials",
        scope: ["apiKey", "solution", "context"] as types.auth.Scope[],
    })).setResult({
        accessToken: "SXRzIGEgcmFuZG9tIHRleHQgZW5jb2RlZCBmb3IgdGhlIHRlc3RpbmcgcHVycG9zZSwgaWYgeW91IGRlY29kZWQgdGhpcyB0ZXh0LCB0cmVhdCBpcyBhcyBhIHNvcnQgb2YgZWFzdGVyIGVnZyA6KS4=" as types.auth.ApiAccessToken,
        accessTokenExpiry: 1726652150623 as types.core.Timestamp,
        refreshToken: "TG9yZW0gaXBzdW1Mb3JlbSBpcHN1bUxvcmVtIGlwc3VtTG9yZW0gaXBzdW1Mb3JlbSBpcHN1bUxvcmVtIGlwc3VtTG9yZW0gaXBzdW0=" as types.auth.ApiRefreshToken,
        refreshTokenExpiry: 1726952150623 as types.core.Timestamp,
        tokenType: "Bearer",
        scope: ["apiKey", "solution", "context"] as types.auth.Scope[],
    });
    call("createFirstApiKey", api => api.createFirstApiKey({
        initializationToken: "89nn65k42kf8vmaD" as types.auth.InitializationToken,
        name: "myApiKey" as types.auth.ApiKeyName,
    })).setResult({
        id: "hysd62jsd7823nasd03" as types.auth.ApiKeyId,
        secret: "759a1d8edba555badf1216b0f381b94950141" as types.auth.ApiKeySecret,
    });
    call("createApiKey", api => api.createApiKey({
        name: "myApiKey" as types.auth.ApiKeyName,
        scope: ["apiKey", "solution", "context"] as types.auth.Scope[],
    })).setResult({
        id: "hysd62jsd7823nasd03" as types.auth.ApiKeyId,
        secret: "759a1d8edba555badf1216b0f381b94950141" as types.auth.ApiKeySecret,
    });
    call("listApiKeys", api => api.listApiKeys()).setResult({
        list: [
            {
                id: "hysd62jsd7823nasd03" as types.auth.ApiKeyId,
                created: 1726652150623 as types.core.Timestamp,
                enabled: true,
                name: "MyApiKey" as types.auth.ApiKeyName,
                scope: ["apiKey", "solution", "context"] as types.auth.Scope[],
            },
        ],
    });
    call("updateApiKey", api => api.updateApiKey({
        id: "hysd62jsd7823nasd03" as types.auth.ApiKeyId,
        enabled: false,
    })).setResult("OK");
    call("deleteApiKey", api => api.deleteApiKey({
        id: "hysd62jsd7823nasd03" as types.auth.ApiKeyId,
    })).setResult("OK");
    call("bindAccessToken", api => api.bindAccessToken({
        accessToken: "TG9yZW0gaXBzdW1Mb3JlbSBpcHN1bUxvcmVtIGlwc3VtTG9yZW0gaXBzdW1Mb3JlbSBpcHN1bUxvcmVtIGlwc3VtTG9yZW0gaXBzdW0=" as types.auth.ApiAccessToken,
    })).setResult("OK");
    call("subscribeToChannel", api => api.subscribeToChannel({
        channels: ["thread", "store"] as types.core.WsChannelName[],
    })).setResult("OK");
    call("unsubscribeFromChannel", api => api.unsubscribeFromChannel({
        channels: ["thread", "store"] as types.core.WsChannelName[],
    })).setResult("OK");
});
