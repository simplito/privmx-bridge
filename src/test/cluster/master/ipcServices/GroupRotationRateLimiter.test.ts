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

it("reserves up to 10 units then denies (sliding window) for the same key", async () => {
    const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
    for (let i = 0; i < 10; i++) {
        expect((await limiter.reserve({key})).allowed).toBe(true);
    }
    expect((await limiter.reserve({key})).allowed).toBe(false);
});

it("SECURITY: concurrent reservations cannot overshoot the budget", async () => {
    // A peek let every request racing on the last unit pass before any of them was charged.
    const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
    const results = await Promise.all(Array.from({length: 50}, () => limiter.reserve({key})));
    expect(results.filter(r => r.allowed).length).toBe(10);
});

it("a released unit can be reserved again", async () => {
    const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
    for (let i = 0; i < 10; i++) {
        await limiter.reserve({key});
    }
    await limiter.release({key});
    expect((await limiter.reserve({key})).allowed).toBe(true);
    expect((await limiter.reserve({key})).allowed).toBe(false);
});

it("rate-limits each group independently", async () => {
    const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
    for (let i = 0; i < 10; i++) {
        await limiter.reserve({key});
    }
    expect((await limiter.reserve({key})).allowed).toBe(false);
    // a different group is unaffected
    expect((await limiter.reserve({key: "g2"})).allowed).toBe(true);
});

it("a refusal says when the oldest unit of the hour is handed back", async () => {
    const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
    const before = Date.now();
    for (let i = 0; i < 10; i++) {
        await limiter.reserve({key});
    }
    const refused = await limiter.reserve({key});
    const after = Date.now();
    expect(refused.allowed).toBe(false);
    // An hour after the first reservation, not after the refusal: a client that waits until then gets through.
    expect(refused.retryAt! >= before + 60 * 60 * 1000).toBe(true);
    expect(refused.retryAt! <= after + 60 * 60 * 1000).toBe(true);
    expect((await limiter.reserve({key: "g2"})).retryAt === undefined).toBe(true);
});

it("a refusal under a limit of zero still names a time", async () => {
    const limiter = new GroupRotationRateLimiter(new CacheWithTTL());
    const refused = await limiter.reserve({key, limit: 0});
    expect(refused.allowed).toBe(false);
    expect(refused.retryAt! > Date.now()).toBe(true);
});
