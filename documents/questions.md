> **ℹ️ Exploratory / historical Q&A** — a brainstorm comparing a "sender key" pattern, optimistic concurrency,
> and MLS. It is **not** a spec and does not describe the implemented design. The optimistic-CAS +
> winner-envelope idea fed into the **Phase-2** design ([bridge_phase_two/](./bridge_phase_two/) /
> [endpoint_phase_two/](./endpoint_phase_two/)); the "Sender Key" pattern itself is **not** PrivMX's chosen
> model (we use asymmetric group-as-grantee + DIO-committed membership, no bridge-side signature verification).
> Authoritative specs: [plan/](./plan/) + the phase dirs.

## Part 1: Your Custom Protocol Plan (The "Sender Key" Pattern)

Your architecture relies on **Optimistic Concurrency Control** and **Pairwise Key Distribution** to securely manage and rotate a shared group key without locking the database or requiring extra network round-trips.

### 1. Cryptographic Structure

* **Personal Keys:** Every user has a permanent personal Elliptic Curve (EC) keypair.
* **Group Key:** The group uses a Shared Symmetric Key (e.g., AES-256) to encrypt the actual chat messages.
* **Distribution:** When the group key is created or rotated, the sender uses Elliptic Curve Diffie-Hellman (ECDH) against every individual member's Public EC key to create uniquely encrypted "envelopes" containing the new symmetric key.

### 2. The Rotation & Retry Flow

When a user attempts to call `sendMessage` and the server demands a rotation (e.g., due to an eviction or an epoch limit), the client executes this flow:

1. **Catch & Fetch:** Catch the `REGENERATE_REQUIRED` error. Fetch the current group roster and the current database `key_generation` integer (e.g., Generation 5).
2. **Generate & Encrypt:** Generate a new random symmetric key locally. Encrypt it individually for every member on the roster.
3. **Upload & Race:** Send the payload to the backend, tagging it with `expected_generation: 5`.

### 3. Handling Concurrency (The Server's Job)

If 10 people try to rotate the key at the exact same millisecond:

* The backend uses a single atomic SQL query (`UPDATE ... WHERE key_generation = 5`).
* **The Winner:** One request succeeds. The database updates to Generation 6. The server routes the winner's new envelopes.
* **The Losers:** Nine requests fail (`0 rows affected`). The server replies with a `409 ROTATED_ALREADY` error, but **includes the winner's new envelope** in the error payload. The 9 losers decrypt this envelope, save the new official key, and immediately retry their `sendMessage` without another API call.

---

## Part 2: Your Security Concerns & Mitigations

Because the server is "blind" to the ciphertext, you must protect the group from malicious internal users attempting to weaponize the protocol.

* **1. The Ghosting Attack (Selective Exclusion):**
* *The Threat:* A malicious user rotates the key but intentionally leaves Bob out of the envelope payload, silently cutting him off.
* *The Fix:* The server strictly validates that the number of uploaded envelopes exactly matches the active group roster. If anyone is missing, the server rejects the rotation.


* **2. Rotation Spam (Denial of Service):**
* *The Threat:* A malicious user spams the rotation endpoint to constantly increment the generation counter, preventing anyone else from sending messages.
* *The Fix:* The server enforces strict rate-limiting on manual rotations and only triggers organic `REGENERATE_REQUIRED` events based on hard rules (like roster changes).


* **3. The Garbage Key Attack:**
* *The Threat:* A malicious user encrypts the real symmetric key for everyone, but encrypts literal garbage data for Bob. Bob accepts the key, but cannot read new messages.
* *The Fix:* The client mandates that all envelopes are digitally signed by the sender's Private EC Key. When Bob attempts to decrypt a message and the MAC authentication fails, his client has mathematical proof that the sender sabotaged the key, allowing the group to automatically evict the attacker.


* **4. Weak Entropy Injection:**
* *The Threat:* A malicious user intentionally uses terrible randomness (like `password123`) when generating the new key, allowing past hackers to guess the new state.
* *The Fix:* Ensure your protocol utilizes a Key Derivation Function (KDF). The bad randomness is blended mathematically with the old, secure key, keeping outsiders out. True Post-Compromise Security is restored the moment the next honest user performs a rotation.



---

## Part 3: Custom Protocol vs. Messaging Layer Security (MLS)

Your custom architecture is highly effective for smaller groups and mirrors the design used by platforms like WhatsApp. However, the IETF's **Messaging Layer Security (MLS)** protocol was designed to solve the scaling and security edge-cases inherent in your pairwise design.

Here is how your protocol directly compares to MLS:

| Feature | Your Custom Protocol (Sender Keys) | MLS Protocol (RFC 9420) |
| --- | --- | --- |
| **Scaling & Bandwidth** | **O(N) Complexity.** Rotating a key requires calculating and uploading individual envelopes for *every single member*. Slows down drastically past 200 users. | **O(log N) Complexity.** Users are arranged in a mathematical "Ratchet Tree." Rotating a key only requires updating the path to the root. Effortlessly handles 10,000+ users. |
| **Concurrency Control** | **Manual Database Locks.** Relies on atomic SQL queries and an Optimistic Concurrency `key_generation` counter to resolve races. | **Native Epochs.** The central Delivery Service strictly orders operations into Epochs. Commits based on old Epochs are cryptographically rejected. |
| **Preventing Garbage Keys** | **Reactive (Post-Rotation).** Bob only realizes his key is garbage when the next message fails to decrypt. Handled via client-side MACs and signatures. | **Proactive (Pre-Rotation).** Uses a `confirmation_tag`. If a user is sent a garbage key, the mathematical proof fails instantly, and the client natively rejects the entire rotation. |
| **Key Freshness** | **Direct Generation.** The client generates a new symmetric key and forces everyone to use it. | **Continuous Ratcheting.** The client generates a `CommitSecret` (entropy) which is blended with the previous Epoch's secret via HKDF to derive a state no one user fully controls. |
| **Implementation** | Easier to conceptualize and build from scratch. Relies heavily on the backend database acting as a referee. | Extremely mathematically complex. Requires off-the-shelf, heavily audited libraries (like OpenMLS) and a specialized Delivery Service. |