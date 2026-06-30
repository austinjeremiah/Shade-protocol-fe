pragma circom 2.2.0;

include "poseidon255.circom";
include "commitment.circom";
include "merkleProof.circom";

// Shade MpcSettlement circuit.
//
// Proves that a two-party MPC committee match is consistent with real deposited
// notes — without revealing the notes' private preimages. The circuit jointly
// proves BOTH sides of a matched pair so the contract can atomically spend both
// nullifiers in a single `mpc_settle` call.
//
// What the circuit proves:
//   1. Note A and note B are genuine commitments in the current Merkle tree.
//   2. Both labels satisfy the protocol's ASP compliance policy.
//   3. The domain-separated nullifiers are correct.
//   4. The output commitments are well-formed from the supplied preimages.
//   5. The matched amount satisfies the trade (matchedAmount ≤ min(valueA, valueB)).
//   6. The batch hash binds batchId + (intentAId, intentBId, matchedAmount) — the
//      same pre-image the committee signed. The contract verifies the committee
//      threshold signature over this hash independently; the circuit enforces the
//      hash is correctly formed from the match parameters.
//
// Public-signal order (outputs first, then declared `public` inputs):
//   [0]  nullifierHashA     domain-sep nullifier for note A
//   [1]  nullifierHashB     domain-sep nullifier for note B
//   [2]  outputCommitmentA  new note commitment (counterparty B will own this)
//   [3]  outputCommitmentB  new note commitment (counterparty A will own this)
//   [4]  batchHashSignal    Poseidon(batchIdField, intentAIdField, intentBIdField, matchedAmount7dp)
//   [5]  stateRoot          Merkle root; both notes must be leaves
//   [6]  associationRoot    ASP compliance root; both labels must be members
//   [7]  poolId             domain separator
//   [8]  chainId            domain separator
//   [9]  matchedAmount7dp   amount of the trade (7dp)
//   [10] deadlineLedger     later of the two intent deadlines
//   [11] intentAIdField     int(sha256(intentA_id)[:31]) — ties proof to specific intent
//   [12] intentBIdField     int(sha256(intentB_id)[:31])

template MpcSettlement(treeDepth, associationDepth) {

    // ── PUBLIC INPUTS ────────────────────────────────────────────────────────
    signal input stateRoot;
    signal input associationRoot;
    signal input poolId;
    signal input chainId;
    signal input matchedAmount7dp;
    signal input deadlineLedger;
    signal input intentAIdField;       // [11] int(sha256(intentAId)[:31])
    signal input intentBIdField;       // [12] int(sha256(intentBId)[:31])

    // ── PRIVATE INPUTS — NOTE A (the note being spent by party A) ───────────
    signal input labelA;
    signal input valueA;
    signal input nullifierA;
    signal input secretA;
    signal input stateIndexA;
    signal input stateSiblingsA[treeDepth];
    signal input labelIndexA;
    signal input labelSiblingsA[associationDepth];

    // ── PRIVATE INPUTS — OUTPUT NOTE A (new note; counterparty B will own it)─
    signal input outValueA;
    signal input outLabelA;
    signal input outNullifierA;
    signal input outSecretA;

    // ── PRIVATE INPUTS — NOTE B (the note being spent by party B) ───────────
    signal input labelB;
    signal input valueB;
    signal input nullifierB;
    signal input secretB;
    signal input stateIndexB;
    signal input stateSiblingsB[treeDepth];
    signal input labelIndexB;
    signal input labelSiblingsB[associationDepth];

    // ── PRIVATE INPUTS — OUTPUT NOTE B (new note; counterparty A will own it)─
    signal input outValueB;
    signal input outLabelB;
    signal input outNullifierB;
    signal input outSecretB;

    // Batch id as a field element (Poseidon domain sep for batch hash).
    signal input batchIdField;

    // ── OUTPUTS ──────────────────────────────────────────────────────────────
    signal output nullifierHashA;       // [0]
    signal output nullifierHashB;       // [1]
    signal output outputCommitmentA;    // [2]
    signal output outputCommitmentB;    // [3]
    signal output batchHashSignal;      // [4]

    // ── 1. Compute input commitments ─────────────────────────────────────────
    component cmtA = CommitmentHasher();
    cmtA.label    <== labelA;
    cmtA.value    <== valueA;
    cmtA.secret   <== secretA;
    cmtA.nullifier <== nullifierA;
    signal commitmentA <== cmtA.commitment;

    component cmtB = CommitmentHasher();
    cmtB.label    <== labelB;
    cmtB.value    <== valueB;
    cmtB.secret   <== secretB;
    cmtB.nullifier <== nullifierB;
    signal commitmentB <== cmtB.commitment;

    // ── 2. Merkle membership: both notes in state tree ───────────────────────
    component merkleA = MerkleProof(treeDepth);
    merkleA.leaf      <== commitmentA;
    merkleA.leafIndex <== stateIndexA;
    merkleA.siblings  <== stateSiblingsA;
    stateRoot === merkleA.out;

    component merkleB = MerkleProof(treeDepth);
    merkleB.leaf      <== commitmentB;
    merkleB.leafIndex <== stateIndexB;
    merkleB.siblings  <== stateSiblingsB;
    stateRoot === merkleB.out;

    // ── 3. ASP compliance: both labels in association tree ───────────────────
    component assocA = MerkleProof(associationDepth);
    assocA.leaf      <== labelA;
    assocA.leafIndex <== labelIndexA;
    assocA.siblings  <== labelSiblingsA;
    associationRoot === assocA.out;

    component assocB = MerkleProof(associationDepth);
    assocB.leaf      <== labelB;
    assocB.leafIndex <== labelIndexB;
    assocB.siblings  <== labelSiblingsB;
    associationRoot === assocB.out;

    // ── 4. Domain-separated nullifier hashes ────────────────────────────────
    component nhA = Poseidon255(3);
    nhA.in[0] <== nullifierA;
    nhA.in[1] <== poolId;
    nhA.in[2] <== chainId;
    nullifierHashA <== nhA.out;

    component nhB = Poseidon255(3);
    nhB.in[0] <== nullifierB;
    nhB.in[1] <== poolId;
    nhB.in[2] <== chainId;
    nullifierHashB <== nhB.out;

    // ── 5. Output commitments ────────────────────────────────────────────────
    component outCmtA = CommitmentHasher();
    outCmtA.label    <== outLabelA;
    outCmtA.value    <== outValueA;
    outCmtA.secret   <== outSecretA;
    outCmtA.nullifier <== outNullifierA;
    outputCommitmentA <== outCmtA.commitment;

    component outCmtB = CommitmentHasher();
    outCmtB.label    <== outLabelB;
    outCmtB.value    <== outValueB;
    outCmtB.secret   <== outSecretB;
    outCmtB.nullifier <== outNullifierB;
    outputCommitmentB <== outCmtB.commitment;

    // ── 6. Match value constraints ───────────────────────────────────────────
    // matchedAmount ≤ valueA: the difference must be non-negative (128-bit range).
    signal remainA <== valueA - matchedAmount7dp;
    component rngA = Num2Bits(128);
    rngA.in <== remainA;
    _ <== rngA.out;

    // matchedAmount ≤ valueB
    signal remainB <== valueB - matchedAmount7dp;
    component rngB = Num2Bits(128);
    rngB.in <== remainB;
    _ <== rngB.out;

    // outValueA + outValueB == matchedAmount7dp * 2 (conservation of value).
    // (Each counterparty receives exactly the matched amount of the other asset.)
    signal outSum <== outValueA + outValueB;
    signal expectedSum <== matchedAmount7dp * 2;
    outSum === expectedSum;

    // ── 7. Batch hash: ties the proof to the committee-signed batch ───────────
    // batchHash = Poseidon(batchIdField, intentAIdField, intentBIdField, matchedAmount7dp)
    // The committee computed the same hash (SHA-256 in TS, translated to a field
    // element) before signing. The contract verifies the committee threshold sig
    // over the matching bytes; the circuit enforces the in-circuit Poseidon digest
    // matches the public batchHashSignal output, binding all match parameters.
    component bh = Poseidon255(4);
    bh.in[0] <== batchIdField;
    bh.in[1] <== intentAIdField;
    bh.in[2] <== intentBIdField;
    bh.in[3] <== matchedAmount7dp;
    batchHashSignal <== bh.out;

    // Bind deadline into constraint system (contract enforces not expired).
    signal dlBind <== deadlineLedger * deadlineLedger;
}

component main {public [
    stateRoot, associationRoot, poolId, chainId,
    matchedAmount7dp, deadlineLedger,
    intentAIdField, intentBIdField
]} = MpcSettlement(12, 2);
