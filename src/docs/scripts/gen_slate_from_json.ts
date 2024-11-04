/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/*  eslint-disable no-console */
import { SlateDocsGenerator } from "../SlateDocsGenerator";
import * as types from "../docsGeneratorTypes";
import * as fs from "fs";
import { getOutJsonPath } from "../common";

async function go() {
    const slate = new SlateDocsGenerator();
    const docsJson = await fs.promises.readFile(getOutJsonPath());
    const docs = JSON.parse(docsJson.toString()) as types.JsonDocs;
    await slate.generateMarkdownFromJson(docs);
    await slate.setApiVersion();
    console.log("Documentation rendered");
}

go().catch(e => console.log("Error", e));
