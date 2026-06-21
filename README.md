<p align="center">
  <img src="./assets/sub-rosa-readme.png" alt="Sub Rosa" width="250" />
</p>

# Sub Rosa Rise In Sprint

**Level 3 / Orange Belt mini dApp for Stellar Journey to Mastery**

Sub Rosa Rise In Sprint is an independent Rise In Builder Track repository. It
is a compact Stellar/Soroban sealed-allocation learning app inspired by Sub
Rosa. It is **not** the full production Sub Rosa protocol or production
frontend.

The production Sub Rosa project is already submitted to SCF #44 and the Stellar
x CV Labs Accelerator. This repository stays separate so its code, deployment,
evidence, and commit history can be shaped specifically for the Rise In
progression without changing those submissions.

The premium Sub Rosa interface also carries the project's **Hack Privacy #1**
status while the `Orange` tab contains the independent Rise In evidence flow.

## Submission status

| Item | Value |
| --- | --- |
| Network | Stellar Testnet only |
| Live demo | https://sub-rosa-risein.vercel.app |
| Soroban contract | `CAEIOZEPTKBDERVUJVTVOZEXPS2PPUHODOGEBUXCTUKD6KUDM3Z4MJ2I` |
| Contract deployment tx | [`28d683d107e928d0ab7850e1622135995188bf865f655ba874bd12605faf9965`](https://stellar.expert/explorer/testnet/tx/28d683d107e928d0ab7850e1622135995188bf865f655ba874bd12605faf9965) |
| Contract interaction tx | [`b748eef72456a0e8f51cb28d8a948fda8fc431df2077cd1d8802b7c2be3940ac`](https://stellar.expert/explorer/testnet/tx/b748eef72456a0e8f51cb28d8a948fda8fc431df2077cd1d8802b7c2be3940ac) |
| XLM payment tx | [`3a07dbbaaf2086a84a4c36c53dfeb87747c7b4b0c23b3abaa33cccf4dc94f177`](https://stellar.expert/explorer/testnet/tx/3a07dbbaaf2086a84a4c36c53dfeb87747c7b4b0c23b3abaa33cccf4dc94f177) |
| Demo video | https://youtu.be/NDuR5B2ztQo |
| CI | [GitHub Actions](https://github.com/karagozemin/sub-rosa-risein/actions/workflows/ci.yml) |

All transaction hashes above are real Stellar Testnet evidence; this repository
does not invent transaction hashes.

## Belt evidence

### White Belt evidence

- Freighter wallet detection and explicit connection
- Local dApp disconnect
- Hard check that Freighter uses Stellar Testnet
- Connected public key display
- Native XLM balance loaded from Horizon testnet
- Signed testnet XLM payment flow
- Loading, rejection, network, validation, and Horizon failure states
- Real payment transaction hash and Stellar Expert testnet link

### Yellow Belt evidence

- Stellar SDK transaction construction in the browser
- Freighter signs prepared XDR; no secret key enters the app
- Recipient StrKey validation and 7-decimal XLM amount validation
- Testnet network passphrase enforced before every signature
- Balance refresh after a confirmed payment
- Responsive evidence UI with readable success/error states
- Frontend unit tests for addresses, amounts, and deterministic commitment
  hashing

### Orange Belt evidence

- Soroban smart contract in
  [contracts/rise-in-round](./contracts/rise-in-round)
- End-to-end create-round and submit-commit contract transactions
- Freighter authorization for contract calls
- Soroban RPC simulation, transaction preparation, submission, and confirmation
  polling
- Contract interaction transaction hash displayed in the frontend
- Getter-based state synchronization after each confirmed invocation
- Contract events for round creation and commitment storage
- Live round title, owner, timestamp, and commitment count in the UI
- Four contract tests covering success and duplicate guards
- Frontend tests and GitHub Actions CI
- Testnet deployment script and static-site deployment instructions
- Responsive desktop/mobile layout

## Mini dApp scope

The educational contract stores:

- a unique numeric round ID;
- a title, owner, creation timestamp, and commitment count;
- one 32-byte commitment per wallet per round.

The browser hashes the user's sample allocation text with SHA-256 before
submission. Only that hash is stored. This is a **commit-style learning flow**,
not encryption and not the production Sub Rosa timelock/reveal protocol.

Contract methods:

| Method | Purpose |
| --- | --- |
| create_round | Create an owner-authorized round and emit a created event |
| submit_commit | Store one participant-authorized BytesN<32> commitment |
| get_round | Read synchronized round state |
| get_commit | Read a participant commitment |

## Architecture

For the full system map, trust boundaries, Sub Rosa premium demo context, and
Rise In Orange evidence path, see [ARCHITECTURE.md](./ARCHITECTURE.md).

1. React/Vite requests access to Freighter and verifies Testnet.
2. Horizon testnet supplies account sequence data and XLM balances.
3. The frontend builds XLM payments or Soroban contract invocations.
4. Soroban RPC simulates and prepares contract transactions.
5. Freighter signs the XDR with the connected account.
6. Horizon or Soroban RPC submits the signed transaction.
7. The UI waits for confirmation, displays the real hash, and reloads state
   through get_round.

No secret keys or network secrets are required by the frontend.

## How to run locally

Requirements:

- Node.js 22+
- pnpm 10+
- Rust and Cargo
- Stellar CLI 22+
- Freighter browser extension

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
# Replace VITE_RISEIN_CONTRACT_ID after contract deployment.
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

The White/Yellow wallet and XLM payment flow works without a contract ID. The
Orange contract controls remain disabled until VITE_RISEIN_CONTRACT_ID contains a
valid deployed testnet contract address.

## Test the project

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm contract:test
git diff --check
```

Build the WASM separately:

```bash
pnpm contract:build
```

The contract suite currently contains four tests:

1. creates and reads a round;
2. stores a commitment and increments state;
3. rejects duplicate round IDs;
4. rejects a second commitment from the same participant.

## Deploy the contract to Stellar Testnet

Create and fund a dedicated **testnet-only** Stellar CLI identity:

```bash
stellar keys generate risein-deployer --network testnet --fund
```

Build and deploy:

```bash
STELLAR_IDENTITY=risein-deployer pnpm contract:deploy:testnet
```

The script prints the real contract ID. Put that public value in:

```bash
# apps/web/.env.local
VITE_RISEIN_CONTRACT_ID=CAEIOZEPTKBDERVUJVTVOZEXPS2PPUHODOGEBUXCTUKD6KUDM3Z4MJ2I
```

Restart pnpm dev after changing the environment file. Do not commit a secret
key, seed phrase, or recovery phrase. The contract ID is public and safe to
commit once deployed.

## Use the dApp

1. Install and unlock Freighter.
2. Switch Freighter to **Stellar Testnet**.
3. Fund the wallet with testnet XLM through
   [Stellar Laboratory](https://lab.stellar.org/account/create).
4. Connect the wallet and verify its public key and balance.
5. Send a small testnet XLM payment and capture the real hash.
6. Enter an unused round ID and create a Soroban round.
7. Enter a sample allocation; the app hashes it locally and submits the
   commitment.
8. Refresh contract state and verify that the commitment count increased.
9. Open each transaction link in Stellar Expert testnet.

## Live demo deployment

This is a static Vite application. Deploy it to Vercel, Netlify, or another
static host with:

| Setting | Value |
| --- | --- |
| Install command | pnpm install --frozen-lockfile |
| Build command | pnpm build |
| Output directory | apps/web/dist |
| Node version | 22 |
| Environment variable | VITE_RISEIN_CONTRACT_ID=the deployed testnet contract |

After deployment, verify Freighter access from the final HTTPS origin and
replace the Live demo placeholder near the top of this README.

## CI/CD

[.github/workflows/ci.yml](./.github/workflows/ci.yml) runs on pushes to main
and on pull requests.

- Frontend job: frozen install, typecheck, unit tests, production build, and
  whitespace validation.
- Contract job: Rust toolchain setup, Cargo cache, and all Soroban contract
  tests.

The workflow does not deploy automatically and does not require secrets.
Testnet contract and static-site deployments remain deliberate manual steps.

## Screenshots checklist

- [ ] Public GitHub repository and completed README
- [ ] Freighter visibly set to Stellar Testnet
- [ ] Wallet connected with public key visible
- [ ] Testnet XLM balance visible
- [ ] Successful XLM payment with real transaction hash
- [ ] Deployed contract ID visible in the app
- [ ] Successful create-round contract transaction hash
- [ ] Successful commitment contract transaction hash
- [ ] Synchronized contract state with incremented commitment count
- [ ] Contract transaction in Stellar Expert testnet
- [ ] Four passing Cargo tests
- [ ] Passing frontend tests and build
- [ ] Green GitHub Actions run
- [ ] Mobile responsive view
- [ ] Live deployed app


## Meaningful commit plan

Orange Belt review expects at least ten meaningful commits. A 12-commit logical
plan is documented in [docs/COMMIT_PLAN.md](./docs/COMMIT_PLAN.md). Do not
fabricate history; split and verify the actual work before submission.

## Reviewer note

This repository is intentionally independent from the production Sub Rosa
codebase. It exists only for the Rise In White, Yellow, and Orange Belt learning
progression while preserving the integrity of the main Sub Rosa SCF #44 and
Stellar x CV Labs submissions. The contract here is a deliberately reduced
educational mini dApp and must not be interpreted as the full production
protocol.
