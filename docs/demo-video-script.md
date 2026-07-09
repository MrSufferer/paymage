# PayMage — DoraHacks Demo Video Script (3 minutes)

**Length:** 3:00 (hard target — DoraHacks' recommended max)
**Format:** Single take, screen recording of the live dashboard + StellarExpert
on second monitor for proof;
**Setup:**
- Two browser windows side-by-side: (left) PayMage dashboard on testnet, (right) StellarExpert testnet payroll contract page
- Freighter wallet connected to testnet, pre-funded with USDC
- Console open in dashboard (Shift+Ctrl+I) → "Preserve log" enabled, so proof-gen messages survive navigation
- Pre-state: 3 employees registered, payroll period #7 pending, treasury funded with $48,200 USDC
- Mic checked, room quiet, screen 1920x1080

**Delivery notes:**
- Speak naturally — don't read the script verbatim; use it as a beat sheet
- Each beat has a [SCREEN] cue, a [SAY] cue, and a time budget
- Total budget: 180s. Buffer built in: 15s of slack at the end
- Backup plan if Freighter signing fails: cut to a 10s pre-recorded clip of the same step

---

## Beat 1 — Hook (0:00–0:15)

[SCREEN] Dashboard home page, payroll summary card centered:
`Payroll period #7 · pending · Total payroll: $48,200.00 USDC · Individual salaries: hidden 🔒`

[SAY]
> On-chain payroll should be private. With PayMage, an employer pays
> their team in USDC on Stellar — the chain verifies the total, but
> nobody learns who makes what. Three minutes, let me show you.

---

## Beat 2 — The Setup (0:15–0:35)

[SCREEN] Click "Employees" tab in sidebar. Three rows visible:
`Alice · Engineer`, `Bob · Designer`, `Carol · PM`. Each row shows the
committed-salary badge `hidden 🔒`.

[SAY]
> Three employees registered. Each one is a Poseidon2 commitment —
> a hash of their employee ID, their salary, and a random salt. The
> dashboard knows who they are. The chain doesn't.

[CLICK] Back to dashboard home.

---

## Beat 3 — Run Payroll (0:35–1:20)

[SCREEN] Click the **"Process Payroll"** button in the summary card.
A modal opens — the Payroll Wizard.

[SAY]
> Click "Process Payroll." The wizard appears with a review step —
> total amount $48,200 in USDC, period ID 7, three employees in the
> batch.

[CLICK] Click **"Generate Proof"**.

[SAY]
> Now the magic. The browser generates a Groth16 proof in a Web
> Worker — no private inputs ever leave this device. Watch the
> console: "zk-proof-generation" log fires, takes about three to
> five seconds on this laptop.

[WAIT 4s, watch the progress bar in the modal]

[SAY]
> Done. The proof is 256 bytes — small enough to fit in a single
> Stellar transaction.

[CLICK] Click **"Confirm & Submit"**.

[SAY]
> Freighter prompts to sign. The transaction carries the proof plus
> three public inputs: the Merkle root, the total, and the period ID.

[CLICK] Approve in Freighter.

[WAIT 5s for testnet confirmation]

[SAY]
> Confirmed on testnet. Period 7 is now locked, USDC escrowed into
> the contract.

---

## Beat 4 — On-chain Verification (1:20–1:45)

[SCREEN] Switch to StellarExpert testnet window. Open the payroll
contract: `CBN3XSKSAN3TFA7HHLQY3MRVU2WXY5MRY4AKIUDTMGQ2LAVKJUXGAPXU`

[SAY]
> Here it is on StellarExpert — the PayrollVerifiedEvent. Three
> fields: period ID 7, commitment root, total amount 48,200 USDC.
> Notice what's *not* here — no individual salary, no employee name.
> The proof passed the on-chain Groth16 verifier. The contract
> released the funds.

---

## Beat 5 — Employee Withdraw (1:45–2:30)

[SCREEN] Switch back to dashboard. Log out, log in as Alice (or
open dashboard in an incognito window with Alice's Freighter
account).

[SAY]
> Now from the employee side. Alice opens the dashboard. She sees
> her pending salary commitment — but she doesn't even have to
> identify herself to withdraw it.

[CLICK] Click **"Withdraw Salary"** on the salary card.

[SAY]
> She generates her own PayrollWithdraw proof: "I know the preimage
> of one of the commitments in period 7, here's a nullifier, here's
> the amount I'm owed." The contract checks the nullifier isn't
> already spent, marks it spent, and releases USDC to whatever fresh
> address she specifies.

[WAIT 5s for proof generation]

[CLICK] Approve in Freighter.

[SAY]
> Done. Alice has her USDC. The contract doesn't know Alice made the
> withdrawal — only that *some* valid commitment was redeemed and
> *this* nullifier is now spent. Double-spend is impossible.

---

## Beat 6 — Compliance View (2:30–2:55)

[SCREEN] Switch back to admin view. Click **"Compliance"** tab.

[SAY]
> One last thing — compliance. An employer can grant an auditor an
> encrypted view key. The auditor decrypts the salary blobs stored
> on IPFS without breaking the on-chain privacy guarantees. Access
> is revocable. This is the ASP compliance pattern the U.S.
> Treasury endorsed in March 2026 — privacy with a compliance path,
> not privacy against it.

---

## Beat 7 — Close (2:55–3:00)

[SCREEN] Back to dashboard home. Payroll period badge now shows
`✓ verified · withdrawn`.

[SAY]
> That's PayMage — private payroll on Stellar. salaries stay
> hidden, the math stays provable, compliance stays possible. Try
> it on testnet — link in the description.

---

## Post-Production Notes

- **Cut the silence** — every "wait" beat should be cut to ~2s in editing. Real proof gen takes longer than the viewer needs to see.
- **Lower-third at 0:30:** `PayMage · Privacy-Preserving Payroll on Stellar Soroban`
- **Lower-third at 2:00:** `Groth16 verified on-chain via BLS12-381 host functions (Protocol 22+)`
- **End card (3:00):** PayMage wordmark + `github.com/paymage/zk-payroll-dashboard` + `Testnet: CBN3XSKSAN3TFA7HHLQY3MRVU2WXY5MRY4AKIUDTMGQ2LAVKJUXGAPXU`
- **Background music:** none — voiceover only, judging panels hate music beds
- **Resolution:** 1080p, 60fps, AAC audio, MP4 container — DoraHacks handles all major formats but MP4 is universal

## If a Step Fails (Backup Cuts)

- **Freighter reject / network timeout**: cut to 5s of "we'll retry" + voiceover "sometimes testnet takes a moment — let me retry this" + jump to the post-confirmation state with a quick edit
- **Proof generation > 10s**: cut straight to "proof generated" with a hard edit, voiceover stays smooth: "a few seconds in the browser, and we're done"
- **Wrong network**: pre-check Freighter network before hitting record — fix off-camera

## Recording Checklist (Before You Hit Record)

- [ ] Freighter on **TESTNET** (not mainnet, not futurenet)
- [ ] Freighter account funded with USDC: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- [ ] 3 employees pre-registered with valid Poseidon2 commitments
- [ ] Treasury pre-funded with $48,200 USDC for the demo period
- [ ] StellarExpert open on the payroll contract page, refreshed
- [ ] Console open, "Preserve log" enabled
- [ ] ZK artifacts cached in IndexedDB (proof gen should be warm — run one throwaway payroll period before recording)
- [ ] Mic audio level checked, room tone captured for 10s of silence
- [ ] Screen resolution locked to 1920x1080, no notifications
- [ ] Do Not Disturb mode on