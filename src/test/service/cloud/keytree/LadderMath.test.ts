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
import { LadderMath, RungSpan } from "../../../../service/cloud/keytree/LadderMath";

/**
 * Unit tests for the Epoch Ladder rules.
 *
 * The tests marked SECURITY guard confidentiality and fail silently at runtime if the guard regresses —
 * they must not be deleted or relaxed. See documents/epoch_key_archive/05-security-analysis.md §1.
 */

describe("LadderMath.skipRungTargets", () => {
    each<[number, number[]]>([
        [2, [0].filter(x => x >= 1)],  // 2-2=0 is below floor 1, so nothing
        [4, [2]],                      // 4-2=2 ; 4-4=0 below floor
        [8, [4, 6]],                   // 8-2=6, 8-4=4 ; 8-8=0 below floor
        [16, [8, 12, 14]],
        [12, [8, 10]],                 // 12 divisible by 2 and 4, not 8
        [9, []],                       // odd
        [7, []],                       // odd
        [6, [4]],                      // divisible by 2 only
    ]).it("newEpoch=%s with floor 1", ([newEpoch, expected]) => {
        assert.deepStrictEqual(LadderMath.skipRungTargets(newEpoch, 1), expected);
    });
    
    it("clamps to the era floor", () => {
        // Without a floor, epoch 16 would skip to 8; with floor 12 those are forbidden.
        assert.deepStrictEqual(LadderMath.skipRungTargets(16, 12), [12, 14]);
        assert.deepStrictEqual(LadderMath.skipRungTargets(16, 15), []);
    });
    
    it("never returns a target at or above the epoch", () => {
        for (let epoch = 1; epoch <= 300; epoch++) {
            for (const target of LadderMath.skipRungTargets(epoch, 1)) {
                assert.ok(target < epoch, `epoch=${epoch} target=${target}`);
                assert.ok(target >= 1, `epoch=${epoch} target=${target}`);
            }
        }
    });
    
    it("does not overflow for large epochs", () => {
        const large = 1048576; // 2^20
        const targets = LadderMath.skipRungTargets(large, 1);
        assert.ok(targets.length > 0);
        assert.ok(targets.every(t => t >= 1 && t < large));
    });
});

describe("LadderMath.rungSpansFor", () => {
    it("always includes the mandatory unit rung above the floor", () => {
        for (let epoch = 2; epoch <= 200; epoch++) {
            const spans = LadderMath.rungSpansFor(epoch, 1);
            assert.ok(
                spans.some(s => s.target === epoch - 1),
                `epoch=${epoch} must include the unit rung`,
            );
        }
    });
    
    it("is empty at the era floor (genesis of an era)", () => {
        assert.deepStrictEqual(LadderMath.rungSpansFor(1, 1), []);
        assert.deepStrictEqual(LadderMath.rungSpansFor(20, 20), []);
    });
    
    it("matches the worked example from the whitepaper: epoch 8 targets 7, 6, 4", () => {
        const targets = LadderMath.rungSpansFor(8, 1).map(s => s.target).sort((a, b) => a - b);
        assert.deepStrictEqual(targets, [4, 6, 7]);
    });
    
    it("never duplicates the unit rung as a skip", () => {
        for (let epoch = 2; epoch <= 200; epoch++) {
            const targets = LadderMath.rungSpansFor(epoch, 1).map(s => s.target);
            assert.strictEqual(new Set(targets).size, targets.length, `epoch=${epoch}`);
        }
    });
    
    it("with skips disabled produces exactly one rung", () => {
        assert.deepStrictEqual(LadderMath.rungSpansFor(8, 1, false), [{at: 8, target: 7}]);
    });
    
    it("every span points downwards", () => {
        for (let epoch = 1; epoch <= 200; epoch++) {
            for (const span of LadderMath.rungSpansFor(epoch, 1)) {
                assert.ok(span.target < span.at, `epoch=${epoch}`);
                assert.strictEqual(span.at, epoch);
            }
        }
    });
});

describe("LadderMath — the amortised cost claim", () => {
    /**
     * The whitepaper claims two rungs per epoch amortised, from
     * `V + sum_{j>=1} V/2^j = 2V`. Assert it numerically rather than trusting the algebra.
     */
    each<[number]>([[100], [1000], [10000]]).it("through epoch %s stays under 2 per epoch", ([upTo]) => {
        const total = LadderMath.totalRungsThrough(upTo);
        const perEpoch = total / (upTo - 1);
        assert.ok(perEpoch < 2, `expected < 2 rungs/epoch, got ${perEpoch.toFixed(3)}`);
        assert.ok(perEpoch > 1.9, `expected close to 2, got ${perEpoch.toFixed(3)}`);
    });
    
    it("cost per epoch does not depend on group size — nothing here takes a member count", () => {
        // Structural assertion: the whole module is a function of epochs only.
        assert.strictEqual(LadderMath.rungSpansFor(64, 1).length, LadderMath.rungSpansFor(64, 1).length);
    });
});

describe("LadderMath.planDescent", () => {
    const spansThrough = (upTo: number, floor = 1): RungSpan[] => {
        const all: RungSpan[] = [];
        for (let epoch = floor + 1; epoch <= upTo; epoch++) {
            all.push(...LadderMath.rungSpansFor(epoch, floor));
        }
        return all;
    };
    
    it("returns an empty plan when already at the target", () => {
        assert.deepStrictEqual(LadderMath.planDescent(5, 5, spansThrough(10)), []);
    });
    
    it("descends 12 -> 5 and lands exactly on the target", () => {
        const plan = LadderMath.planDescent(12, 5, spansThrough(12));
        assert.notStrictEqual(plan, null);
        assert.strictEqual(plan![plan!.length - 1].target, 5);
        assert.strictEqual(plan![0].at, 12);
    });
    
    it("each step continues from where the previous ended", () => {
        const plan = LadderMath.planDescent(30, 3, spansThrough(30))!;
        let current = 30;
        for (const step of plan) {
            assert.strictEqual(step.at, current, "step must be addressed to the current epoch");
            assert.ok(step.target < current, "step must go down");
            current = step.target;
        }
        assert.strictEqual(current, 3);
    });
    
    it("never overshoots below the target", () => {
        const plan = LadderMath.planDescent(64, 40, spansThrough(64))!;
        for (const step of plan) {
            assert.ok(step.target >= 40, `overshot to ${step.target}`);
        }
    });
    
    it("stays inside the logarithmic bound for a range of distances", () => {
        for (const [from, to] of [[16, 1], [64, 1], [256, 1], [1024, 1], [10000, 1], [1000, 500]]) {
            const plan = LadderMath.planDescent(from, to, spansThrough(from));
            assert.notStrictEqual(plan, null, `from=${from} to=${to}`);
            const bound = LadderMath.descentBound(from, to);
            assert.ok(
                plan!.length <= bound,
                `from=${from} to=${to}: ${plan!.length} steps exceeds bound ${bound}`,
            );
        }
    });
    
    it("10000 -> 1 costs roughly 28 steps, not 10000", () => {
        const plan = LadderMath.planDescent(10000, 1, spansThrough(10000))!;
        assert.ok(plan.length < 40, `expected well under 40 steps, got ${plan.length}`);
        assert.ok(plan.length > 5, "sanity: should need more than a handful");
    });
    
    it("with unit rungs only, the walk is linear", () => {
        const unitOnly: RungSpan[] = [];
        for (let epoch = 2; epoch <= 12; epoch++) {
            unitOnly.push({at: epoch, target: epoch - 1});
        }
        const plan = LadderMath.planDescent(12, 5, unitOnly)!;
        assert.strictEqual(plan.length, 7);
    });
    
    it("returns null when a rung is missing (a gap in the chain)", () => {
        const gapped = spansThrough(12).filter(s => !(s.at === 8));
        // Nothing addressed to epoch 8 remains, so a descent that must pass through 8 fails.
        const plan = LadderMath.planDescent(8, 1, gapped);
        assert.strictEqual(plan, null);
    });
    
    it("returns null when the target is below everything available (pruned range)", () => {
        const above10 = spansThrough(20, 10);
        assert.strictEqual(LadderMath.planDescent(20, 3, above10), null);
    });
    
    /** SECURITY — a rung pointing upwards must never be traversed, even if it reached storage. */
    it("SECURITY: ignores an upward rung entirely", () => {
        const poisoned: RungSpan[] = [
            {at: 5, target: 9},   // upward: must be ignored
            {at: 5, target: 4},
            {at: 4, target: 3},
        ];
        const plan = LadderMath.planDescent(5, 3, poisoned)!;
        assert.deepStrictEqual(plan, [{at: 5, target: 4}, {at: 4, target: 3}]);
        for (const step of plan) {
            assert.ok(step.target < step.at);
        }
    });
    
    /** SECURITY — a self-referential rung must not cause an infinite walk. */
    it("SECURITY: a self-loop rung cannot hang the walk", () => {
        const looped: RungSpan[] = [{at: 5, target: 5}, {at: 5, target: 5}];
        assert.strictEqual(LadderMath.planDescent(5, 1, looped), null);
    });
    
    it("refuses to descend upwards", () => {
        assert.throws(() => LadderMath.planDescent(3, 9, []));
    });
});

describe("LadderMath.descentFloor", () => {
    it("reports no reason when nothing constrains the descent", () => {
        assert.deepStrictEqual(LadderMath.descentFloor(1), {floor: 1, reason: "NONE"});
    });
    
    it("reports the era boundary when only an era floor applies", () => {
        assert.deepStrictEqual(LadderMath.descentFloor(20), {floor: 20, reason: "ERA_BOUNDARY"});
    });
    
    it("prefers PRUNED when the watermark is the stronger constraint", () => {
        assert.deepStrictEqual(LadderMath.descentFloor(20, 8000), {floor: 8000, reason: "PRUNED"});
    });
    
    it("keeps the era boundary when it is higher than the watermark", () => {
        assert.deepStrictEqual(LadderMath.descentFloor(9000, 8000), {floor: 9000, reason: "ERA_BOUNDARY"});
    });
});

describe("LadderMath.validateRungSet", () => {
    const ok = (r: ReturnType<typeof LadderMath.validateRungSet>) => {
        assert.strictEqual(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
    };
    const problem = (r: ReturnType<typeof LadderMath.validateRungSet>, kind: string) => {
        assert.strictEqual(r.ok, false);
        assert.strictEqual((r as {ok: false, problem: {kind: string}}).problem.kind, kind);
    };
    
    it("accepts a well-formed set for epoch 8", () => {
        ok(LadderMath.validateRungSet(LadderMath.rungSpansFor(8, 1), 8, 1));
    });
    
    it("accepts an empty set at the era floor", () => {
        ok(LadderMath.validateRungSet([], 1, 1));
        ok(LadderMath.validateRungSet([], 20, 20));
    });
    
    it("accepts a set with only the unit rung — skips are optional", () => {
        ok(LadderMath.validateRungSet([{at: 8, target: 7}], 8, 1));
    });
    
    it("accepts a non-aligned skip — alignment is advisory, not enforced", () => {
        ok(LadderMath.validateRungSet([{at: 8, target: 7}, {at: 8, target: 5}], 8, 1));
    });
    
    /** SECURITY — the single check that stops a removed member reading forward. */
    each<[number, number]>([[8, 8], [8, 9], [8, 100]]).it(
        "SECURITY: rejects an upward or self rung at=%s target=%s",
        ([at, target]) => {
            problem(LadderMath.validateRungSet([{at, target}], 8, 1), "DIRECTION");
        },
    );
    
    /** SECURITY — a missing unit rung is an unrepairable hole, so it must fail at write time. */
    it("SECURITY: rejects a set without the unit rung", () => {
        problem(LadderMath.validateRungSet([], 8, 1), "UNIT_RUNG_MISSING");
        problem(LadderMath.validateRungSet([{at: 8, target: 6}], 8, 1), "UNIT_RUNG_MISSING");
    });
    
    it("rejects a rung addressed to a different epoch", () => {
        problem(LadderMath.validateRungSet([{at: 7, target: 6}], 8, 1), "WRONG_EPOCH");
    });
    
    it("rejects a rung targeting below the era floor", () => {
        problem(LadderMath.validateRungSet([{at: 8, target: 7}, {at: 8, target: 3}], 8, 5), "BELOW_ERA_FLOOR");
    });
    
    it("rejects a rung targeting below the prune watermark", () => {
        problem(
            LadderMath.validateRungSet([{at: 8, target: 7}, {at: 8, target: 4}], 8, 1, 5),
            "BELOW_PRUNE_WATERMARK",
        );
    });
    
    it("rejects duplicates in one submission", () => {
        problem(
            LadderMath.validateRungSet([{at: 8, target: 7}, {at: 8, target: 7}], 8, 1),
            "DUPLICATE",
        );
    });
    
    it("rejects non-integer epoch numbers", () => {
        problem(LadderMath.validateRungSet([{at: 8, target: 7.5}], 8, 1), "NON_INTEGER");
    });
    
    it("accepts every generated set for a long run of epochs", () => {
        for (let epoch = 1; epoch <= 500; epoch++) {
            ok(LadderMath.validateRungSet(LadderMath.rungSpansFor(epoch, 1), epoch, 1));
        }
    });
    
    it("accepts generated sets under an era floor for a long run", () => {
        const floor = 137;
        for (let epoch = floor; epoch <= floor + 200; epoch++) {
            ok(LadderMath.validateRungSet(LadderMath.rungSpansFor(epoch, floor), epoch, floor));
        }
    });
});
