/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { LadderMath, RungSpan } from "./LadderMath";
import { TreeMath } from "./TreeMath";

/**
 * Emits the key-tree conformance vectors.
 *
 * The endpoint has an identical dumper (`test/tools/keytree_conformance_dump.cpp`). Diffing the two outputs is
 * what proves the client and the server agree on the tree topology — and they must, because the server performs
 * the same computation to decide which nodes a removal is obliged to refresh. If they disagree, the server
 * either rejects valid removals or, worse, accepts ones that leave a removed member holding a current node key.
 *
 * Run:
 *     npm run build && node out/service/cloud/keytree/conformanceDump.js > /tmp/bridge.txt
 * then diff against the endpoint's dumper output.
 */

const MAX_LEAVES = 64;
const MAX_EPOCH = 200;

function joinSpans(spans: RungSpan[]): string {
    return spans.map(s => `${s.at}>${s.target}`).join(",");
}

/** Every rung published across epochs `floor+1 .. upTo` — a client's local archive. */
function spansThrough(upTo: number, floor: number): RungSpan[] {
    const all: RungSpan[] = [];
    for (let epoch = floor + 1; epoch <= upTo; epoch++) {
        all.push(...LadderMath.rungSpansFor(epoch, floor));
    }
    return all;
}

function dumpTree(maxLeaves: number, out: string[]): void {
    for (let n = 1; n <= maxLeaves; n++) {
        out.push(`N=${n} root=${TreeMath.root(n)} depth=${TreeMath.depth(n)} nodes=${TreeMath.nodeCount(n)}`);
        for (let p = 0; p < n; p++) {
            out.push(`  p=${p} dp=[${TreeMath.directPath(p, n).join(",")}] cp=[${TreeMath.copath(p, n).join(",")}]`);
        }
        for (let x = 0; x < TreeMath.nodeCount(n); x++) {
            const isRoot = x === TreeMath.root(n);
            const par = isRoot ? "-" : String(TreeMath.parent(x, n));
            const sib = isRoot ? "-" : String(TreeMath.sibling(x, n));
            const kids = TreeMath.isLeaf(x) ? "" : TreeMath.children(x, n).join(",");
            out.push(`  x=${x} lvl=${TreeMath.level(x)} par=${par} sib=${sib} kids=[${kids}]`);
        }
    }
}

function dumpLadder(out: string[]): void {
    for (const floor of [1, 137]) {
        out.push(`LADDER floor=${floor}`);
        for (let epoch = floor; epoch <= floor + MAX_EPOCH; epoch++) {
            const spans = joinSpans(LadderMath.rungSpansFor(epoch, floor));
            const skips = LadderMath.skipRungTargets(epoch, floor).join(",");
            const unit = LadderMath.requiresUnitRung(epoch, floor) ? 1 : 0;
            out.push(`  e=${epoch} spans=[${spans}] skips=[${skips}] unit=${unit}`);
        }
    }
    
    out.push("DESCENTS");
    const descents: [number, number][] = [
        [1, 1], [2, 1], [8, 1], [12, 5], [16, 1], [30, 3], [64, 40], [256, 1], [1024, 1], [1000, 500],
    ];
    for (const [from, to] of descents) {
        const plan = LadderMath.planDescent(from, to, spansThrough(from, 1));
        const rendered = plan === null ? "NONE" : joinSpans(plan);
        out.push(`  from=${from} to=${to} bound=${LadderMath.descentBound(from, to)} plan=[${rendered}]`);
    }
    
    out.push("FLOORS");
    const floors: [number, number][] = [[1, -1], [20, -1], [20, 8000], [9000, 8000], [1, 5]];
    for (const [era, pruned] of floors) {
        const result = pruned < 0 ? LadderMath.descentFloor(era) : LadderMath.descentFloor(era, pruned);
        out.push(`  era=${era} pruned=${pruned} floor=${result.floor} reason=${result.reason}`);
    }
    
    out.push("VALIDATIONS");
    const cases: {spans: RungSpan[], epoch: number, floor: number, pruned: number}[] = [
        {spans: [], epoch: 1, floor: 1, pruned: -1},
        {spans: [], epoch: 20, floor: 20, pruned: -1},
        {spans: [], epoch: 8, floor: 1, pruned: -1},
        {spans: [{at: 8, target: 7}], epoch: 8, floor: 1, pruned: -1},
        {spans: [{at: 8, target: 7}, {at: 8, target: 5}], epoch: 8, floor: 1, pruned: -1},
        {spans: [{at: 8, target: 8}], epoch: 8, floor: 1, pruned: -1},
        {spans: [{at: 8, target: 9}], epoch: 8, floor: 1, pruned: -1},
        {spans: [{at: 7, target: 6}], epoch: 8, floor: 1, pruned: -1},
        {spans: [{at: 8, target: 6}], epoch: 8, floor: 1, pruned: -1},
        {spans: [{at: 8, target: 7}, {at: 8, target: 3}], epoch: 8, floor: 5, pruned: -1},
        {spans: [{at: 8, target: 7}, {at: 8, target: 4}], epoch: 8, floor: 1, pruned: 5},
        {spans: [{at: 8, target: 7}, {at: 8, target: 7}], epoch: 8, floor: 1, pruned: -1},
    ];
    for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const result = c.pruned < 0
            ? LadderMath.validateRungSet(c.spans, c.epoch, c.floor)
            : LadderMath.validateRungSet(c.spans, c.epoch, c.floor, c.pruned);
        const problem = result.ok ? "OK" : result.problem.kind;
        out.push(`  case=${i} ok=${result.ok ? 1 : 0} problem=${problem}`);
    }
}

export function dumpConformanceVectors(maxLeaves: number = MAX_LEAVES): string {
    const out: string[] = [];
    dumpTree(maxLeaves, out);
    dumpLadder(out);
    return out.join("\n");
}

if (require.main === module) {
    process.stdout.write(dumpConformanceVectors() + "\n");
}
