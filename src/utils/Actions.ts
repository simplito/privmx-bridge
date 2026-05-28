/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { Logger } from "../service/log/Logger";

export type Action = () => Promise<void>|void;

export class Actions {
    
    private actions: Action[] = [];
    
    constructor(
        private logger: Logger,
    ) {
    }
    
    add(action: Action) {
        this.actions.push(action);
    }
    
    addActions(actions: Actions) {
        for (const action of actions.actions) {
            this.actions.push(action);
        }
    }
    
    async execute() {
        for (const action of this.actions) {
            try {
                await action();
            }
            catch (e) {
                this.logger.error(e, "Error during executing post action in section multi operators executor");
            }
        }
    }
}