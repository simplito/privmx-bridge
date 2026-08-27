/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Epoch Ladder rules: which rungs an epoch must publish, and how a descent traverses them.
 *
 * A **rung** is a ciphertext carrying an older epoch's grant private key, wrapped to a newer epoch's grant
 * public key. Pure arithmetic over epoch numbers; mirrored in the endpoint (see conformanceDump.ts).
 */

/** A rung, reduced to what the rules operate on. `target < at` always. */
export interface RungSpan {
    /** The epoch whose public key the rung is wrapped to. */
    at: number;
    /** The (older) epoch whose private key the rung carries. */
    target: number;
}

export class LadderMath {
    
    /**
     * Skip-rung targets for a newly created epoch: `a - 2^j` for every `j >= 1` with `2^j | a`, clamped to the
     * era floor. Power-of-two alignment gives two rungs per epoch amortised and `O(log delta)` descent.
     */
    static skipRungTargets(newEpoch: number, eraFloor: number): number[] {
        LadderMath.assertEpoch(newEpoch, "newEpoch");
        LadderMath.assertEpoch(eraFloor, "eraFloor");
        const targets: number[] = [];
        // Spans double each step: 2, 4, 8, ... Spelled out because the repo bans bitwise operators.
        for (let span = 2; span <= newEpoch; span *= 2) {
            if (newEpoch % span !== 0) {
                continue;
            }
            const target = newEpoch - span;
            if (target < eraFloor) {
                continue;
            }
            targets.push(target);
        }
        return targets.sort((a, b) => a - b);
    }
    
    /**
     * The full set of rung spans an epoch should publish: the mandatory unit rung plus aligned skips. Empty at
     * the era floor, where there is nothing below to link to.
     *
     * The unit rung must be rejected at **write time** if absent: an epoch committed without one leaves a
     * permanent gap, because afterwards nobody holds both the previous private key and the new public key.
     */
    static rungSpansFor(newEpoch: number, eraFloor: number, includeSkips = true): RungSpan[] {
        LadderMath.assertEpoch(newEpoch, "newEpoch");
        LadderMath.assertEpoch(eraFloor, "eraFloor");
        if (newEpoch <= eraFloor) {
            return [];
        }
        const spans: RungSpan[] = [{at: newEpoch, target: newEpoch - 1}];
        if (includeSkips) {
            for (const target of LadderMath.skipRungTargets(newEpoch, eraFloor)) {
                if (target !== newEpoch - 1) {
                    spans.push({at: newEpoch, target});
                }
            }
        }
        return spans;
    }
    
    /** Whether an epoch is obliged to carry a unit rung. False only at the era floor. */
    static requiresUnitRung(newEpoch: number, eraFloor: number): boolean {
        LadderMath.assertEpoch(newEpoch, "newEpoch");
        LadderMath.assertEpoch(eraFloor, "eraFloor");
        return newEpoch > eraFloor;
    }
    
    /** Total rungs written across epochs `1..upToEpoch`. Exists so the amortised-two-per-epoch claim is
     *  assertable rather than merely asserted. */
    static totalRungsThrough(upToEpoch: number): number {
        LadderMath.assertEpoch(upToEpoch, "upToEpoch");
        let total = 0;
        for (let epoch = 2; epoch <= upToEpoch; epoch++) {
            total += LadderMath.rungSpansFor(epoch, 1).length;
        }
        return total;
    }
    
    /**
     * Plans a descent from `from` down to `to`, greedily taking the largest jump that does not overshoot. For
     * an aligned rung set this is optimal and needs no shortest-path search.
     *
     * @returns the ordered rungs to unwrap, or `null` when the target is unreachable (a gap, a pruned range,
     *          or an era floor in the way)
     */
    static planDescent(from: number, to: number, available: RungSpan[]): RungSpan[] | null {
        LadderMath.assertEpoch(from, "from");
        LadderMath.assertEpoch(to, "to");
        if (to > from) {
            throw new Error(`cannot descend upwards: from ${from} to ${to}`);
        }
        if (to === from) {
            return [];
        }
        const byAt = new Map<number, RungSpan[]>();
        for (const rung of available) {
            if (rung.target >= rung.at) {
                // Invariant D violation. Never traverse such a rung, even if it somehow got stored:
                // it is exactly the shape that would hand a removed member a later key.
                continue;
            }
            const list = byAt.get(rung.at) ?? [];
            list.push(rung);
            byAt.set(rung.at, list);
        }
        
        const plan: RungSpan[] = [];
        let current = from;
        const guard = new Set<number>([from]);
        while (current > to) {
            const candidates = (byAt.get(current) ?? []).filter(r => r.target >= to);
            if (candidates.length === 0) {
                return null;
            }
            let best = candidates[0];
            for (const candidate of candidates) {
                if (candidate.target < best.target) {
                    best = candidate;
                }
            }
            plan.push(best);
            current = best.target;
            if (guard.has(current)) {
                // Defensive: a malformed rung set must not spin forever.
                return null;
            }
            guard.add(current);
        }
        return plan;
    }
    
    /** Upper bound on descent length with aligned skip rungs: `2*log2(delta) + 2`. At most two unit steps reach
     *  an aligned epoch, and each jump at least halves the remaining distance. */
    static descentBound(from: number, to: number): number {
        LadderMath.assertEpoch(from, "from");
        LadderMath.assertEpoch(to, "to");
        const delta = from - to;
        if (delta <= 0) {
            return 0;
        }
        return 2 * Math.ceil(Math.log2(delta + 1)) + 2;
    }
    
    /** The floor a descent cannot pass: the higher of the era floor and the prune watermark. `reason` lets a
     *  client tell "not available to you" from "deleted" instead of surfacing a decryption failure. */
    static descentFloor(eraFloor: number, prunedBelow?: number): {floor: number, reason: "ERA_BOUNDARY"|"PRUNED"|"NONE"} {
        LadderMath.assertEpoch(eraFloor, "eraFloor");
        if (prunedBelow === undefined) {
            return {floor: eraFloor, reason: eraFloor > 1 ? "ERA_BOUNDARY" : "NONE"};
        }
        LadderMath.assertEpoch(prunedBelow, "prunedBelow");
        if (prunedBelow > eraFloor) {
            return {floor: prunedBelow, reason: "PRUNED"};
        }
        return {floor: eraFloor, reason: eraFloor > 1 ? "ERA_BOUNDARY" : "NONE"};
    }
    
    /**
     * Validates a submitted rung set for an epoch being created. Pure; the caller reports the errors.
     *
     * `target < at` on every rung is the entire security guarantee of this layer. Also checked: the rung is
     * addressed to the epoch being created, targets nothing below the era floor or prune watermark, the unit
     * rung is present, and no span is duplicated.
     */
    static validateRungSet(
        submitted: RungSpan[],
        newEpoch: number,
        eraFloor: number,
        prunedBelow?: number,
    ): {ok: true} | {ok: false, problem: LadderProblem} {
        LadderMath.assertEpoch(newEpoch, "newEpoch");
        LadderMath.assertEpoch(eraFloor, "eraFloor");
        
        const seen = new Set<string>();
        for (const rung of submitted) {
            if (!Number.isInteger(rung.at) || !Number.isInteger(rung.target)) {
                return {ok: false, problem: {kind: "NON_INTEGER", rung}};
            }
            if (rung.target >= rung.at) {
                return {ok: false, problem: {kind: "DIRECTION", rung}};
            }
            if (rung.at !== newEpoch) {
                return {ok: false, problem: {kind: "WRONG_EPOCH", rung, expected: newEpoch}};
            }
            if (rung.target < eraFloor) {
                return {ok: false, problem: {kind: "BELOW_ERA_FLOOR", rung, eraFloor}};
            }
            if (prunedBelow !== undefined && rung.target < prunedBelow) {
                return {ok: false, problem: {kind: "BELOW_PRUNE_WATERMARK", rung, prunedBelow}};
            }
            const key = `${rung.at}/${rung.target}`;
            if (seen.has(key)) {
                return {ok: false, problem: {kind: "DUPLICATE", rung}};
            }
            seen.add(key);
        }
        
        if (LadderMath.requiresUnitRung(newEpoch, eraFloor) && !seen.has(`${newEpoch}/${newEpoch - 1}`)) {
            return {ok: false, problem: {kind: "UNIT_RUNG_MISSING", newEpoch, requiredTarget: newEpoch - 1}};
        }
        return {ok: true};
    }
    
    private static assertEpoch(value: number, name: string): void {
        if (!Number.isInteger(value) || value < 1) {
            throw new Error(`invalid ${name}: ${value}`);
        }
    }
}

/** Why a rung set was rejected. */
export type LadderProblem =
    | {kind: "NON_INTEGER", rung: RungSpan}
    | {kind: "DIRECTION", rung: RungSpan}
    | {kind: "WRONG_EPOCH", rung: RungSpan, expected: number}
    | {kind: "BELOW_ERA_FLOOR", rung: RungSpan, eraFloor: number}
    | {kind: "BELOW_PRUNE_WATERMARK", rung: RungSpan, prunedBelow: number}
    | {kind: "DUPLICATE", rung: RungSpan}
    | {kind: "UNIT_RUNG_MISSING", newEpoch: number, requiredTarget: number};
