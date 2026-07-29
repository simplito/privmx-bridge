/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export type RequestId = string&{__requestId: never};
export type FileId = string&{__fileId: never};

export interface FileDefinition {
    size: number;
    checksumSize: number;
    randomWrite?: boolean;
}

export interface RequestConfig {
    maxFilesCount: number;
    maxRequestSize: number;
    maxFileSize: number;
    chunkSize: number;
}
