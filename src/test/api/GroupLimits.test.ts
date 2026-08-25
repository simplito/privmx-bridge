/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import * as assert from "assert";
import { AppException } from "../../api/AppException";
import { ContextApiValidator } from "../../api/main/context/ContextApiValidator";
import { TypesValidator } from "../../api/TypesValidator";
import { ECUtils } from "../../utils/crypto/ECUtils";

/**
 * The limits that decide how large a group may be. They all derive from `MAX_GROUP_MEMBERS`; these tests are
 * what keeps them from drifting apart again — each checked on its own, so a regression names which one moved.
 */

const MAX = TypesValidator.MAX_GROUP_MEMBERS;
const validator = new ContextApiValidator(new TypesValidator());

const KEY_ID = "0fb486f81eee410d01972358a919f347";
const PUB_KEY = ECUtils.generateKeyPair().pub58;

function users(count: number) {
    return Array.from({length: count}, (_, i) => "user_" + i);
}

function tree(numLeaves: number, options: {nodes?: number, edges?: number, seats?: number} = {}) {
    return {
        numLeaves,
        leafAssignment: users(options.seats ?? Math.min(numLeaves, MAX)),
        nodes: Array.from({length: options.nodes ?? 1}, (_, i) => ({nodeIndex: i, generation: 0, publicKey: PUB_KEY})),
        edges: Array.from({length: options.edges ?? 1}, (_, i) => ({
            parentIndex: i, parentGeneration: 0, childKind: "node", childIndex: i + 1, childGeneration: 0, data: "wrap",
        })),
    };
}

function createModel(overrides: Record<string, unknown> = {}) {
    return {
        contextId: "657838db3359f5a16f93fbc0",
        groupPubKey: PUB_KEY,
        users: users(3),
        managers: ["manager"],
        data: "group-data",
        keyId: KEY_ID,
        keys: [],
        ...overrides,
    };
}

function validate(model: Record<string, unknown>) {
    validator.validate("groupCreate", model);
}

function refusal(model: Record<string, unknown>): string {
    try {
        validate(model);
    }
    catch (e) {
        assert.ok(AppException.is(e, "INVALID_PARAMS"), `expected INVALID_PARAMS, got ${String(e)}`);
        return String((e as AppException).data);
    }
    throw new Error("expected the model to be refused");
}

it("a group at the declared maximum passes every limit at once", async () => {
    validate(createModel({
        users: users(MAX - 1),
        managers: ["manager"],
        // ~19 B of the endpoint's DIO per member, measured: the membership block names everybody.
        data: "d".repeat(19 * MAX),
        tree: tree(MAX, {nodes: 2, edges: 2, seats: MAX}),
    }));
});

it("limit 1: the roster stops one member past the maximum", async () => {
    const message = refusal(createModel({users: users(MAX + 1)}));
    assert.ok(message.includes("users"), `the refusal should name the roster, got: ${message}`);
});

it("limit 2: `data` is bounded, but far above what a full group needs", async () => {
    // 1 MB against ~311 KB at 16 384 members — headroom, not the binding limit. It has to stay bounded, though:
    // this field is stored on the document and echoed to every reader.
    validate(createModel({data: "d".repeat(900 * 1024)}));
    refusal(createModel({data: "d".repeat(2 * 1024 * 1024)}));
});

it("limit 3: `numLeaves` is bounded from above, not only from below", async () => {
    // It used to carry `min(int, 1)` and nothing else: a client could name a geometry with a hundred million
    // leaves and the server would compute paths in it before anything noticed.
    const message = refusal(createModel({tree: tree(MAX + 1, {seats: 3})}));
    assert.ok(message.includes("numLeaves"), `the refusal should name numLeaves, got: ${message}`);
});

it("the tree's node and edge caps follow from the same number", async () => {
    // A tree of N leaves has N-1 internal nodes and 2(N-1) edges. The caps sit just above that, so they cannot
    // be the limit that bites first, and cannot silently allow a tree far larger than the roster does.
    refusal(createModel({tree: tree(MAX, {nodes: 2 * MAX + 1, seats: 3})}));
    refusal(createModel({tree: tree(MAX, {edges: 4 * MAX + 1, seats: 3})}));
    validate(createModel({tree: tree(MAX, {nodes: 2 * MAX, edges: 4 * MAX, seats: MAX})}));
});

it("the seating list cannot outrun the roster limit", async () => {
    refusal(createModel({tree: tree(MAX, {seats: MAX + 1})}));
});
