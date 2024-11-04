/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable */
import { getOutJsonPath } from "./common";
import { JsonDocs } from "./docsGeneratorTypes";

const docs = require(getOutJsonPath()) as JsonDocs;

export {docs};
