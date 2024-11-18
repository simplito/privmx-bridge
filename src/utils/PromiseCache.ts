/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export class PromiseCache<T> {
    
    private promise?: Promise<T>;
    
    async go(func: () => Promise<T>): Promise<T> {
        if (this.promise != null) {
            return this.promise;
        }
        try {
            this.promise = func();
            return await this.promise;
        }
        finally {
            delete this.promise;
        }
    }
}
