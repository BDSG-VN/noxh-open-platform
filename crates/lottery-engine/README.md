# Deterministic synthetic lottery protocol

This Rust implementation matches `apps/api/src/lottery-engine.ts`. The separate Python standard-library verifier implements the protocol again. All three use the public fixture `tests/fixtures/lottery-vector.json`. Real-world draw configurations are rejected: `synthetic` must be true and applicant codes must use the `DEMO-` namespace. The mathematics do not determine statutory eligibility, priority treatment or entitlement to a home.

## Protocol v1

1. Serialize the ordered JSON array of algorithm, session UUID, project UUID, title, synthetic flag, kind, seat count, sorted applicant codes, sorted unit codes, rules, legal basis, priority resolution, eligibility-evidence hash, scheduled UTC timestamp and entropy-source description. Strings are UTF-8 without ASCII escaping. Applicant/unit namespaces are ASCII so byte sorting matches JavaScript sorting. SHA-256 gives `snapshotHash`.
2. The seed commitment is SHA-256 of `noxh-commit-v1\0` bytes followed by the 32-byte secret and 32-byte snapshot hash. Hex strings must be lowercase and exactly 64 characters.
3. RFC 5869 HKDF-SHA256 derives a 32-byte key with secret as IKM, external entropy as salt and UTF-8 `noxh-draw-v1:` plus the snapshot hash as info.
4. HMAC-SHA256 of successive 4-byte big-endian counters starting at zero yields blocks, consumed as eight 32-bit big-endian words. For bound `b`, reject words greater than or equal to `2^32 - (2^32 % b)`. More than 10,000 rejected words for one index fails closed.
5. Fisher–Yates shuffles sorted applicant codes from the last index down to one. The first configured number are selected. Allocation mode requires one unique unit per already-selected applicant and pairs sorted units with that shuffled order. A selection draw is rejected if applicants do not outnumber seats.

There is no random retry, secret generation, stateful draw service or legal-rule execution in this library. The orchestrator is responsible for freezing reviewed snapshots, preventing replay/cherry-picking, committing before external entropy is known, recording witnesses and publishing evidence. The verifier alone cannot prove timestamps, that entropy was independent, that a draw ran only once, that a signature is genuine, or that an authority approved a configuration. Production use remains gated by project legal review and independent security/audit work.

## Run

```sh
cargo test --workspace --locked
cargo run --locked -p lottery-verifier -- tests/fixtures/lottery-vector.json
python3 scripts/verify-lottery.py tests/fixtures/lottery-vector.json
```

The Rust CLI reads one local public-evidence JSON file, rejects files above 2 MB, missing or malformed mandatory fields, production flags, invalid configurations, mismatched snapshot/commitment and any ranking difference. Success is exit 0; failure is exit 1. Additional public display metadata is accepted, while configuration/result fields reject unknown keys. No network calls, external processes, secret collection or personal document access occur in the verifier.

Tests cover cross-language golden evidence, reproducibility after reordering inputs, allocation uniqueness, rejection sampling, duplicate codes, draws not required, production refusal, modified rankings and CLI malformed/oversized inputs. The golden fixture uses synthetic entries and fixed public test seeds; it must never be reused as an entropy source for a real draw.
