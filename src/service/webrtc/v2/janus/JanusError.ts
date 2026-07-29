/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export class JanusError extends Error {
    
    constructor(
        public errorCode: number,
        public errorMessage: string,
        public response: unknown,
    ) {
        super(`Janus Error ${JSON.stringify({errorCode, errorMessage}, null, 2)}`);
    }
    
    static isError(e: unknown, errorCode: number) {
        return e instanceof JanusError && e.errorCode === errorCode;
    }
}
