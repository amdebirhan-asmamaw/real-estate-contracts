# Lease Escrow & Lease Execution — Design

**Date:** 2026-06-16
**Status:** Approved design, ready for implementation
**Repos touched:** `real-estate-contracts` (Solidity, scripts, tests), `real-estate-backend` (new `leases` module + escrow service)

## Goal

Close the Tier-1 gap in the platform vision: **automated escrow for secure lease agreement execution.** The PropertyTitle work already covers digital titles, ownership records, and verification. This increment adds a real, on-chain escrow that holds a lease's security deposit + first month's rent in an ERC-20 stablecoin, plus a backend-owned lease lifecycle that drives it.

Out of scope for this increment (documented as future work): recurring monthly rent automation, self-custody party wallets, lead analytics, broker license verification, email notifications. No new user roles are added.

## Locked design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Escrow medium | On-chain ERC-20 stablecoin | Most faithful to "automated escrow"; real token custody. Mock ERC-20 for local/Sepolia. |
| Lease representation | Backend-owned lifecycle + on-chain escrow only | Keeps Solidity surface small; lease terms live in Mongo, escrow is the on-chain anchor. |
| Escrow covers | Security deposit + first month's rent | Realistic lease start payment. |
| Deposit handling | **Split:** first month → landlord on activation; deposit **held** until lease end | Mirrors real tenancy: deposit returned at clean exit, forfeited on damages. |
| Release authority | Custodial platform wallet (`onlyOwner`) | Same trust model as `PropertyTitle.mintTitle`; tenants/landlords need no wallet or gas. |
| Disputes | Admin-decided resolution | Matches existing admin-review patterns; contract enforces a single terminal path. |

## Roles (no new roles)

- `property_owner` = landlord (drafts/proposes lease on their own rent listing).
- `tenant` = tenant (party to the lease; pays platform off-chain).
- `admin` = moves money on-chain (fund/activate/settle) and resolves disputes.

## A. Smart contract — `contracts/LeaseEscrow.sol`

OpenZeppelin 5 (`Ownable`, `SafeERC20`, `ReentrancyGuard`). Solidity 0.8.24 / Cancun (same as PropertyTitle).

```solidity
enum State { None, Funded, Active, Closed }

struct Escrow {
    string  leaseId;        // off-chain lease _id, for traceability
    address landlord;       // payout target for rent + (optionally) deposit
    address tenant;         // payout target for refunds
    address token;          // ERC-20 in escrow
    uint256 rentAmount;     // first month's rent
    uint256 depositAmount;  // security deposit (held past activation)
    bytes32 termsHash;      // sha256 of agreed lease terms snapshot
    State   state;
}
```

State variables: `uint256 private _nextEscrowId = 1;` and `mapping(uint256 => Escrow) private _escrows;`.

**onlyOwner state-changing functions** (all `nonReentrant`, checks-effects-interactions, `SafeERC20`):

| Function | Transition | Money movement | Event |
|---|---|---|---|
| `openAndFund(leaseId, landlord, tenant, token, rentAmount, depositAmount, termsHash) → escrowId` | `None → Funded` | pulls `rentAmount + depositAmount` from owner via `safeTransferFrom` | `EscrowFunded` |
| `activate(escrowId)` | `Funded → Active` | `rentAmount` → landlord | `RentReleased` |
| `cancel(escrowId)` | `Funded → Closed` | `rentAmount + depositAmount` → tenant | `EscrowRefunded` |
| `releaseDeposit(escrowId)` | `Active → Closed` | `depositAmount` → landlord | `DepositReleased` |
| `refundDeposit(escrowId)` | `Active → Closed` | `depositAmount` → tenant | `DepositRefunded` |

**Views:** `getEscrow(escrowId) → Escrow`, `escrowState(escrowId) → State`. Both revert on unknown id (state == None).

Each terminal payout function is reachable from exactly one state, so disputes resolve to one path and no double-spend is possible. The custodial wallet (`owner`) pre-approves the ERC-20 allowance before `openAndFund`.

**Custody note:** the tenant pays the platform off-chain (or via future fiat rails); the custodial wallet funds the on-chain escrow and is the source of truth for movement. `landlord`/`tenant` addresses are recorded for transparency and are the literal payout targets.

### `contracts/mocks/MockERC20.sol`
Minimal OZ ERC-20 with a public faucet-style `mint(address,uint256)` for local/Sepolia/test funding. Never deployed to mainnet.

## B. Backend — `src/modules/leases/`

Mirrors the `listings` module layout: `lease.model.ts`, `lease.routes.ts`, `lease.controller.ts`, `lease.service.ts`, `lease.validation.ts`.

### `lease.model.ts`
```
Lease {
  listing:        ObjectId (ref Listing, indexed)   // published, listingType "rent"
  landlord:       ObjectId (ref User)               // = listing.createdBy
  tenant:         ObjectId (ref User)
  currency:       String
  monthlyRent:    Number
  depositAmount:  Number
  escrowAmount:   Number                            // monthlyRent + depositAmount (computed)
  startDate, endDate: Date
  terms:          String                            // or document ref
  termsHash:      String                            // sha256 of terms snapshot at propose-time
  status: "draft" | "proposed" | "active" | "completed" | "terminated" | "cancelled" | "disputed"
  escrow: {
    escrowId:        String
    contractAddress: String
    token:           String
    state:           "none" | "funded" | "active" | "closed"
    fundTxHash, activateTxHash, settleTxHash: String
    landlordWallet, tenantWallet: String            // snapshot of payout addresses used
  }
  createdBy, createdAt, updatedAt
}
```

### State machine (backend-driven, audit-logged)
- `draft → proposed` — landlord drafts then proposes; terms snapshotted, `termsHash` computed.
- `proposed → active` — admin funds escrow (`openAndFund`) then activates (`activate`, first month → landlord).
- `proposed → cancelled` — pre-activation cancel → `cancel` (full refund if already funded).
- `active → completed` — lease ends clean → `refundDeposit` (deposit → tenant).
- `active → terminated` — early end / damages → `releaseDeposit` (deposit → landlord).
- `proposed|active → disputed → resolved` — admin chooses the matching contract path (`cancel`/`releaseDeposit`/`refundDeposit`).

New `AuditLog` actions: `lease.created`, `lease.proposed`, `lease.escrow_funded`, `lease.activated`, `lease.cancelled`, `lease.completed`, `lease.terminated`, `lease.disputed`, `lease.dispute_resolved`.

## C. Escrow service + endpoints

### `src/core/blockchain/leaseEscrow.service.ts` (mirrors `propertyTitle.service.ts`)
- `openAndFundEscrow({ leaseId, landlord, tenant, token, rentAmount, depositAmount, termsHash }) → { escrowId, txHash }` (parses `EscrowFunded`).
- `activateEscrow(escrowId) → { txHash }`
- `cancelEscrow(escrowId) → { txHash }`
- `releaseDeposit(escrowId) → { txHash }` / `refundDeposit(escrowId) → { txHash }`
- `getEscrow(escrowId)` → on-chain state for verification.
- ABI hand-copied to `src/core/blockchain/leaseEscrow.abi.ts` (same convention as PropertyTitle), source-of-truth `abi/LeaseEscrow.json`.

New env vars: `ESCROW_CONTRACT_ADDRESS`, `ESCROW_TOKEN_ADDRESS`. Reuses `BLOCKCHAIN_RPC_URL` + `MINTER_PRIVATE_KEY` (custodial wallet = contract owner).

### Endpoints (`/api/v1/leases`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/` | property_owner | Create lease draft on a rent listing |
| POST | `/:id/propose` | property_owner | draft → proposed (snapshot terms + hash) |
| GET | `/mine` | protected | Leases where I'm landlord or tenant |
| GET | `/:id` | parties/admin | Lease + escrow state |
| POST | `/:id/fund` | admin | `openAndFund` after tenant payment confirmed |
| POST | `/:id/activate` | admin | `activate` → first month to landlord → active |
| POST | `/:id/cancel` | parties/admin | pre-activation cancel → full refund |
| POST | `/:id/complete` | admin | active → completed → `refundDeposit` |
| POST | `/:id/terminate` | admin | active → terminated → `releaseDeposit` |
| POST | `/:id/dispute` | parties | flag dispute |
| POST | `/:id/dispute/resolve` | admin | choose cancel / release / refund |
| GET | `/:id/escrow` | parties/admin | on-chain escrow verification |

Joi validation + resource-based authorization (parties on their own lease; admin-only for money-movement endpoints), matching the listings module conventions.

## D. Tests, deploy, wiring

- `test/LeaseEscrow.test.ts`: fund pulls tokens + emits + increments id; activate pays landlord rent only; releaseDeposit/refundDeposit pay correct party; cancel refunds both pre-activation; non-owner reverts (`OwnableUnauthorizedAccount`); illegal transitions revert (no double-spend); unknown id reverts; reentrancy guard holds.
- `scripts/deploy.ts`: also deploy `LeaseEscrow` (+ `MockERC20` on non-mainnet); append both addresses to `deployments/<network>.json`.
- `scripts/export-abi.ts`: also export `abi/LeaseEscrow.json` + `abi/MockERC20.json`.
- Backend: Jest tests for the lease state machine with a mocked escrow service (unit) + the contract integration covered in the contracts repo.
- Update `CLAUDE.md` in both repos: new contract, env vars, lease/escrow flow.

## Risks / notes
- Custodial model means the platform wallet must hold/approve enough stablecoin to fund escrows — operationally the tenant's off-chain payment backs this. Document the funding precondition.
- `termsHash` integrity is verifiable on-chain (like PropertyTitle's `documentHash`) — surface it in `GET /:id/escrow`.
- Decimals: store amounts in token base units in the service layer; the Lease model holds human-readable `monthlyRent`/`depositAmount`.
