# ComplianceMembership Circuit

Status: **implemented** — embedded in `circuits/withdraw_public/main.circom`.

The `withdraw_public` circuit enforces ASP allow-list membership via:
- `associationRoot` [7] — the Merkle root of the ASP allow-set; the circuit enforces a HARD equality (`associationRoot === associationRootChecker.out`), not a bypassable check
- `label` (private) — the note's label (hash of scope + nonce); must be a leaf in the association tree
- `labelIndex` + `labelSiblings` (private) — the Merkle proof of label membership in the association set

Deny-root non-membership is currently enforced at the contract level by checking the nullifier against a deny-list before accepting the proof. A separate in-circuit deny-set non-membership proof (via empty-leaf or exclusion Merkle proof) is a future upgrade.

No separate `compliance_membership.circom` is needed.
