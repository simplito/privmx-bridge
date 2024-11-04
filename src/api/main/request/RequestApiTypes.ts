/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as types from "../../../types";

export interface CreateRequestModel {
    files: types.request.FileDefinition[];
}

export interface CreateRequestResult {
    id: types.request.RequestId;
}

export interface DestroyRequestModel {
    id: types.request.RequestId;
}

export interface ChunkModel {
    requestId: types.request.RequestId;
    fileIndex: number;
    seq: number;
    data: Buffer;
}

export interface CommitFileModel {
    requestId: types.request.RequestId;
    fileIndex: number;
    seq: number;
    checksum: Buffer;
}

export interface IRequestApi {
    getRequestConfig(): Promise<types.request.RequestConfig>;
    createRequest(model: CreateRequestModel): Promise<CreateRequestResult>;
    destroyRequest(model: DestroyRequestModel): Promise<types.core.OK>;
    sendChunk(model: ChunkModel): Promise<types.core.OK>;
    commitFile(model: CommitFileModel): Promise<types.core.OK>;
}
