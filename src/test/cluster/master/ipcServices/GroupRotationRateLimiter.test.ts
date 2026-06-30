/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import "q2-test";
import { GroupRotationRateLimiter } from "../../../../cluster/master/ipcServices/GroupRotationRateLimiter";
import { CacheWithTTL } from "../../../../utils/CacheWithTTL";

const key = "g1";

it("allows up to 10 recorded rotations then denies (sliding window) for the same key", async () => {
    const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
    for (let i = 0; i < 10; i++) {
        expect((await limiter.check({key})).allowed).toBe(true);
        await limiter.record({key});
    }
    expect((await limiter.check({key})).allowed).toBe(false);
});

it("check() is a peek and does not consume quota", async () => {
    const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
    // Peeking many times without recording must never exhaust the budget.
    for (let i = 0; i < 100; i++) {
        expect((await limiter.check({key})).allowed).toBe(true);
    }
    // Only recorded rotations count toward the limit.
    for (let i = 0; i < 10; i++) {
        await limiter.record({key});
    }
    expect((await limiter.check({key})).allowed).toBe(false);
});

it("rate-limits each group independently", async () => {
    const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
    for (let i = 0; i < 10; i++) {
        await limiter.record({key});
    }
    expect((await limiter.check({key})).allowed).toBe(false);
    // a different group is unaffected
    expect((await limiter.check({key: "g2"})).allowed).toBe(true);
});
