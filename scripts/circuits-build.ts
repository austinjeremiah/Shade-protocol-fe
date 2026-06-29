import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beginReport, writeCheckReport, failIfAny, type CheckResult } from "../apps/cli/src/lib/report.js";

// C1: real Circom build pipeline. Compiles every Shade circuit to r1cs+wasm, runs
// the Groth16 trusted setup (reusing the existing pot15 ptau), and exports the
// verification key. Idempotent: skips setup if output/main_final.zkey already
// exists (rerun with CIRCUITS_FORCE_SETUP=1 to regenerate keys). These are
// BLS12-381 Circom circuits verified on Soroban (see docs/zk-proof-system.md) —
// NOT Noir.

const SHADE_ROOT = process.env.SHADE_ROOT ?? process.cwd();
const CIRCUITS_DIR = resolve(SHADE_ROOT, "circuits");
const PTAU = process.env.SHADE_PTAU ?? resolve(SHADE_ROOT, ".zk-ref/soroban-examples/privacy-pools/circuits/pot15_final.ptau");
const FORCE = process.env.CIRCUITS_FORCE_SETUP === "1";

// name -> expected nPublic (output signals + declared public inputs)
const CIRCUITS: { name: string; nPublic: number }[] = [
  { name: "withdraw_public", nPublic: 17 },   // P1.5/6/7: 1 output + 16 public inputs
  { name: "private_transfer", nPublic: 6 },   // #2 hidden-amount transfer
  { name: "deposit_note_mint", nPublic: 14 }  // P1.8: 1 output (commitment) + 13 inputs
];

const checks: CheckResult[] = [];
const PATH = `${process.env.HOME}/.cargo/bin:${process.env.PATH ?? ""}`;
const env = { ...process.env, PATH, NODE_OPTIONS: "--max-old-space-size=8192" };

function circomlibPath(): string {
  const r = spawnSync("npm", ["root", "-g"], { encoding: "utf8" });
  return resolve(r.stdout.trim(), "circomlib/circuits");
}

if (!existsSync(PTAU)) {
  checks.push({ name: "powers-of-tau (pot15)", ok: false, detail: `missing ${PTAU} — see docs/zk-proof-system.md` });
} else {
  checks.push({ name: "powers-of-tau (pot15)", ok: true, detail: PTAU });
  const CIRCOMLIB = circomlibPath();
  for (const c of CIRCUITS) {
    const dir = resolve(CIRCUITS_DIR, c.name);
    try {
      mkdirSync(resolve(dir, "build"), { recursive: true });
      mkdirSync(resolve(dir, "output"), { recursive: true });
      execFileSync("circom", ["main.circom", "--r1cs", "--wasm", "--sym", "-o", "build", "-l", ".", "-l", CIRCOMLIB, "--prime", "bls12381"], { cwd: dir, env, encoding: "utf8" });
      const wasm = resolve(dir, "build/main_js/main.wasm");
      const r1cs = resolve(dir, "build/main.r1cs");
      if (!existsSync(wasm) || !existsSync(r1cs)) throw new Error("compile produced no wasm/r1cs");
      const zkey = resolve(dir, "output/main_final.zkey");
      const vk = resolve(dir, "output/main_verification_key.json");
      if (FORCE || !existsSync(zkey)) {
        execFileSync("snarkjs", ["groth16", "setup", r1cs, PTAU, resolve(dir, "main_0000.zkey")], { cwd: dir, env });
        const contribute = spawnSync("snarkjs", ["zkey", "contribute", resolve(dir, "main_0000.zkey"), zkey, "--name", `shade-${c.name}`, "-v"], { cwd: dir, env, input: `shade-build-${c.name}\n`, encoding: "utf8" });
        if (contribute.status !== 0) throw new Error(`zkey contribute failed: ${contribute.stderr?.slice(0, 200)}`);
      }
      if (!existsSync(vk) || FORCE) {
        execFileSync("snarkjs", ["zkey", "export", "verificationkey", zkey, vk], { cwd: dir, env });
      }
      const vkJson = JSON.parse(readFileSync(vk, "utf8"));
      const ok = vkJson.nPublic === c.nPublic;
      checks.push({ name: `circuit ${c.name} compiled + vk (nPublic=${vkJson.nPublic})`, ok, detail: ok ? "OK" : `expected nPublic=${c.nPublic}, got ${vkJson.nPublic}` });
    } catch (e) {
      checks.push({ name: `circuit ${c.name} build`, ok: false, detail: (e as Error).message.slice(0, 200) });
    }
  }
}

beginReport({ title: "Circuit Build" });
await writeCheckReport("Circuit Build (Circom BLS12-381)", checks);
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? " — " + c.detail : ""}`);
failIfAny(checks);
console.log("circuits:build PASS");
