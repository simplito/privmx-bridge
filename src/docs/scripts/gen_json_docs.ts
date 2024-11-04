/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/*  eslint-disable no-console */
import { JsonDocsGenerator } from "../JsonDocsGenerator";
import { getOutJsonPath } from "../common";
import * as fs from "fs";

async function go() {
    const generator = new JsonDocsGenerator();
    const docs = generator.getDocsFromProject();
    await fs.promises.writeFile(getOutJsonPath(), JSON.stringify(docs, null, 2));
    console.log("docs.json generated");
}

go().catch(e => console.log("Error", e));
