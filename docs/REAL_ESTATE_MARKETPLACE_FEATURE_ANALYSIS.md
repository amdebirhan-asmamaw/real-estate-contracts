# Real Estate Blockchain Marketplace Feature Analysis

Date: 2026-06-16

Scope reviewed:

- Contracts: `D:\PROJECTS\real-estate-contracts`
- Backend: `D:\PROJECTS\real-estate-backend`

## 1. Executive Summary

The current system is a strong prototype foundation, not yet a production-ready real estate marketplace.

The backend already implements the core marketplace API: JWT authentication, user roles, KYC document upload/review, listing CRUD, listing review workflow, map-oriented discovery queries, media/document upload, ownership document verification, on-chain title minting hooks, lease creation, lease escrow lifecycle, favorites, inquiries, audit logs, OpenAPI docs, Docker, and tests.

The smart contract project already implements two useful blockchain primitives:

- `PropertyTitle`: a custodial ERC-721 title certificate that anchors a listing id and ownership document hash.
- `LeaseEscrow`: a custodial ERC-20 stablecoin escrow for first rent plus security deposit.

To become complete and production ready, the project still needs major work in these areas:

- Full property transaction flows for buying/selling, not only rental escrow and title certificates.
- Non-custodial or hybrid wallet flows with proper signature-based consent.
- Broker/agent-style onboarding, licensing, and dashboards without adding new platform roles.
- Real AML/KYC/KYB integrations and compliance case management.
- Rich spatial discovery: polygon search, neighborhood analytics, geocoding, saved searches, map clustering, and ranking.
- Payment rails, stablecoin policy, fee handling, refunds, reconciliation, and chain indexing.
- Strong production security: secrets custody, contract audits, monitoring, background jobs, webhooks, fraud detection, data retention, and incident response.

## 2. Current Backend State

Backend stack:

- Express 4 with TypeScript.
- MongoDB via Mongoose.
- JWT access and refresh tokens.
- Joi validation.
- Cloudinary upload integration for public photos and private documents.
- Ethers v6 for blockchain integration.
- Swagger/OpenAPI documentation.
- Jest and Supertest with in-memory MongoDB.
- Docker and docker-compose.

Implemented backend modules:

| Area | Current state | Notes |
| --- | --- | --- |
| Auth | Implemented | Register, login, refresh token rotation, logout, logout all, sessions, change password, current user. |
| Roles | Implemented baseline | `tenant`, `property_owner`, `admin`, `super_admin`. This should remain the complete platform role set. |
| Account lifecycle | Implemented baseline | Owners start pending; tenants active; admins can change account status. |
| KYC | Implemented internal review | Upload private docs, self/admin access, admin approve/reject, status update. |
| Listings | Implemented core | Drafts, owner/admin management, status workflow, public discovery. |
| Listing review | Implemented | Submit, start review, request info, approve, reject, publish, suspend, archive. |
| Media | Implemented baseline | Public listing photos and private ownership documents. |
| Ownership verification | Implemented baseline | Approved title deed sets verification status and document hash. |
| On-chain title | Implemented integration | Admin mints title NFT after verification; public title verification endpoint. |
| Spatial discovery | Implemented basic | GeoJSON point, bounding box search, radius search, basic filters. |
| Favorites | Implemented | Save, unsave, list favorites. |
| Inquiries | Implemented | Tenant/user inquiries and owner/admin responses. |
| Leases | Implemented prototype | Create, propose, fund escrow, activate, cancel, complete, terminate, dispute, resolve. |
| Audit logs | Implemented baseline | Listing, document, user KYC, account, and lease lifecycle events. |
| API docs | Implemented | Swagger UI and frontend guide exist. |
| Tests | Implemented meaningful coverage | Auth, listing, KYC, title, lease, audit, docs, uploader, favorites, inquiries. |

Important backend limitations:

- No production-grade email verification or password reset.
- No wallet-linking endpoint or signature challenge flow, even though wallet fields exist on users.
- No broker license verification, agency/team metadata, or representative assignment workflow.
- No buy/sell transaction workflow, offers, counteroffers, purchase escrow, title transfer, closing, or fee settlement.
- Rental lease flow is landlord/admin initiated; there is no tenant e-sign acceptance or payment confirmation workflow.
- Blockchain writes are admin/custodial and depend on a platform private key.
- No chain event indexer or reconciliation job for transactions mined but DB writes failing afterward.
- No notification system.
- No background worker architecture.
- No production AML provider integration or sanctions/PEP/adverse-media screening.
- Spatial analytics are minimal; no geocoding, polygon search, neighborhoods, schools, transit, crime, price comps, or market trends.
- No reporting/analytics dashboards for owners, admins, tenants, or compliance workflows.

## 3. Current Contract State

Contracts stack:

- Hardhat with TypeScript.
- Solidity 0.8.24.
- OpenZeppelin 5.
- Ethers v6 via Hardhat toolbox.

Implemented contracts:

### PropertyTitle

Current capabilities:

- ERC-721 token for digital property title certificate.
- Owner-only `mintTitle`.
- Stores listing id per token.
- Stores approved ownership document hash per token.
- Exposes token owner, listing id, and document hash.
- Emits `TitleMinted`.

Current limitations:

- Custodial minting only; property owner does not sign or initiate.
- No uniqueness check for listing id or document hash.
- No transfer restrictions, freeze, burn, revoke, invalidate, or dispute flags.
- No token URI or metadata standard for title certificate display.
- No upgrade or migration strategy.
- No role-based access control beyond single `Ownable`.
- No registry connection to government/land authority records.
- No lifecycle states such as pending, verified, transferred, disputed, revoked.

### LeaseEscrow

Current capabilities:

- Owner-only custodial escrow.
- Opens and funds escrow using ERC-20 transfer from platform owner.
- Releases first month rent to landlord on activation.
- Holds deposit during active lease.
- Can cancel before activation and refund rent plus deposit to tenant.
- Can release or refund deposit after activation.
- Stores lease id, parties, token, rent, deposit, terms hash, state.
- Emits lifecycle events.
- Includes reentrancy protection and SafeERC20.

Current limitations:

- Fully custodial and admin-controlled.
- Tenant does not fund escrow directly.
- No tenant/landlord signatures on lease terms.
- No partial deposit settlement.
- No fee support.
- No recurring rent support.
- No automated schedule, grace period, late fees, or rent installments.
- No arbiter/multisig dispute flow.
- No pause/emergency controls.
- No role separation between admin, escrow operator, compliance operator, and treasury.
- Assumes a standard non-fee, non-rebasing ERC-20.

## 4. Required Product Features For Completeness

### 4.1 User, Identity, And Access

The platform should support exactly four authorization roles:

| Role | Meaning |
| --- | --- |
| `SUPER_ADMIN` | Full platform control, including admin management, critical configuration, and elevated oversight. |
| `ADMIN` | Operational review role for listings, KYC, compliance, disputes, and transaction oversight. |
| `PROPERTY_OWNER` | A property seller, landlord, owner, or authorized representative managing listings and leases. |
| `TENANT` | A buyer or renter browsing listings, sending inquiries, making rental applications, or participating in purchase/rental transactions. |

Do not add separate `BUYER`, `RENTER`, `AGENT`, `BROKER`, `COMPLIANCE_ANALYST`, or `FINANCE_OPERATOR` auth roles. Those should be modeled as profile attributes, permissions scoped inside the existing admin roles, workflow assignments, or verification records.

Required features:

- Email verification.
- Password reset and account recovery.
- Wallet linking through nonce challenge and signed message.
- Multiple wallet support per user.
- User profile management.
- Optional profile type metadata, for example individual owner, company owner, licensed representative, buyer-intent tenant, renter-intent tenant.
- Two-factor authentication for admins and other privileged actions.
- Admin invitation flow instead of open admin creation.
- Account lockout and suspicious-login alerts.
- Session/device management with revoke-by-device.
- Terms of service and privacy policy acceptance tracking.

Production considerations:

- Store refresh tokens in secure httpOnly cookies for web clients or use a hardened mobile token strategy.
- Add step-up authentication for money movement, document access, title minting, and account status changes.

### 4.2 KYC, KYB, AML, And Compliance

Required features:

- Integrated KYC provider for identity verification.
- KYB for companies, brokerages, agencies, and corporate property owners while keeping users in the four-role model.
- Sanctions, PEP, watchlist, and adverse media screening.
- AML risk score per user and transaction.
- Broker license verification by jurisdiction.
- Beneficial ownership capture for entity sellers/landlords.
- Compliance cases with assignment, notes, evidence, status, SLA, and escalation.
- Document expiry tracking and re-verification.
- Transaction audit exports.
- Suspicious activity report workflow.
- Jurisdiction-specific compliance rules.

Prototype path:

- Keep the current internal KYC review, but add provider abstraction interfaces so a real provider can be plugged in later.

Production path:

- Use provider webhooks, immutable case logs, retention policies, and admin-only access with strong audit trails.

### 4.3 Property Listing And Metadata

Required features:

- Full property schema: year built, floors, parking, lot size, zoning, furnishing, utilities, energy rating, HOA/condo fees, tax estimate, ownership type, occupancy status, availability dates.
- Sale-specific fields: asking price, minimum offer, appraisal, title status, closing timeline, accepted payment methods.
- Rent-specific fields: deposit policy, lease term, pet policy, occupancy limit, furnished status, utilities included, available from, application criteria.
- Commercial-specific fields: lease type, cap rate, NOI, zoning, frontage, loading dock, ceiling height, permitted use.
- Draft autosave and completeness score.
- Listing quality checks.
- Duplicate detection with stronger matching.
- Listing moderation and fraud flags.
- SEO/public slug support.
- Listing version history.
- Change request workflow after publication.

Current baseline:

- The backend supports basic sale/rent fields, photos, documents, location, amenities, and review workflow.

Missing for production:

- Deep metadata, versioning, moderation queues, owner change requests, fraud scoring, and listing quality automation.

### 4.4 Advanced Spatial Discovery

Required features:

- Map viewport search.
- Radius search.
- Polygon/custom boundary search.
- Drawn search areas saved to user profile.
- Map clustering.
- Geocoding and reverse geocoding.
- Neighborhood boundaries.
- Neighborhood analytics: median price/rent, rent yield, days on market, demand, comparable listings.
- Transit, school, healthcare, grocery, and amenity overlays.
- Commute-time search.
- Sort and ranking: newest, price, verified, relevance, distance, yield.
- Full-text search for address, neighborhood, title, and amenities.
- Saved searches and alerts.

Current baseline:

- Viewport, radius, and simple filters are implemented.

Missing for production:

- Polygon search, analytics, geocoding, external POI data, clustering, ranking, saved searches, and alerts.

### 4.5 Media And Documents

Required features:

- Photo gallery ordering, captions, cover image.
- Image transformations and responsive variants.
- Video tours and floor plans.
- 3D/virtual tour URLs.
- Private document categories and access policies.
- Document OCR and metadata extraction.
- Virus scanning.
- Watermarking for sensitive documents.
- Signed URL expiration policy.
- Document versioning.
- Document deletion/retention policies.

Current baseline:

- Cloudinary photos and private ownership/KYC documents exist.

Missing for production:

- Virus scanning, OCR, versioning, retention, floor plans, video tours, and fine-grained document permissions.

### 4.6 Owner And Representative Portal

Required features:

- Owner dashboard for listing status, views, favorites, inquiries, lead conversion, occupancy, and rental yield.
- Representative dashboard for assigned listings, leads, follow-ups, pipeline stages, commissions, and tasks. Representatives should use the `PROPERTY_OWNER` role with profile/license metadata, not a separate role.
- Organization/team management for property owner accounts.
- Lead routing and assignment within owner organizations.
- Tenant screening dashboard.
- Calendar availability and viewing appointments.
- Messaging inbox.
- Rental income and expense tracking.
- Maintenance request management.
- Portfolio analytics for multiple properties.

Current baseline:

- Owners can manage listings, documents, inquiries, and leases through APIs.

Missing for production:

- Representative profile metadata, dashboards, lead analytics, tenant management, appointments, maintenance, and portfolio financial analytics.

### 4.7 Buyer/Renter Experience

Required features:

- Search and browse listings.
- Favorite/save listings.
- Send inquiries.
- Schedule viewing.
- Rental application.
- Offer submission for purchases.
- Lease application and tenant screening.
- Document upload for applicant proof.
- Secure messaging with property owner or authorized representative.
- Notification center.
- Transaction timeline.
- Wallet connection and title/escrow verification.

Current baseline:

- Favorites and inquiries exist.

Missing for production:

- Viewing appointments, applications, offers, messaging, notifications, tenant screening, and transaction timeline.

### 4.8 Lease And Rental Management

Required features:

- Lease template builder.
- Lease terms negotiation.
- Tenant e-signature and landlord e-signature.
- On-chain terms hash after both parties accept.
- Tenant-funded escrow or payment provider collection.
- Recurring rent payments.
- Rent reminders and late fees.
- Renewal workflow.
- Move-in/move-out inspection.
- Maintenance requests.
- Deposit deduction itemization.
- Partial deposit release/refund.
- Dispute workflow with evidence.

Current baseline:

- Lease creation, proposal, admin-funded escrow, activation, cancellation, completion, termination, disputes, and on-chain escrow readback exist.

Missing for production:

- Party signatures, tenant funding, recurring rent, renewals, inspection, maintenance, partial settlements, and robust dispute resolution.

### 4.9 Sale Transaction And Closing

Required features:

- Buyer offers and seller counteroffers.
- Offer expiration.
- Purchase agreement generation.
- Buyer deposit/earnest money escrow.
- Inspection contingencies.
- Financing contingencies.
- Title search and lien checks.
- Closing checklist.
- Final settlement statement.
- Tax/fee calculation.
- Title transfer or title-certificate update.
- Buyer/seller signatures.
- Refund and cancellation rules.

Current baseline:

- Sale listings exist, but purchase workflow does not.

Production requirement:

- Add a separate sale transaction domain model and purchase escrow contract or integrate a regulated payment/escrow provider.

### 4.10 Blockchain And Web3

Required features:

- Wallet linking with signed nonce.
- Chain/network configuration per environment.
- Contract address registry.
- Event indexer for title and escrow contracts.
- Transaction table with pending/mined/failed/reorg-aware states.
- Retry and reconciliation jobs.
- Gas estimation and fee tracking.
- Multisig owner wallet.
- Role-based contract permissions.
- Upgrade/migration plan.
- Contract verification on block explorer.
- Contract audit.
- Token URI metadata for property title NFTs.
- Revocation/dispute status for titles.
- One title per verified listing or explicit title versioning policy.
- Non-custodial or hybrid mint/escrow flows.

Current baseline:

- Backend can mint title NFTs and operate escrow through a custodial private key.

Missing for production:

- Indexer, reconciliation, wallet consent, multisig, contract roles, title lifecycle, metadata, audits, and non-custodial flows.

### 4.11 Payments And Treasury

Required features:

- Fiat payments and/or stablecoin deposits.
- Treasury wallet management.
- Fee calculation and collection.
- Refunds.
- Payment receipts.
- Reconciliation.
- Chargeback/dispute handling if fiat is used.
- Accounting exports.
- Tax reporting support.
- Currency conversion policy.

Current baseline:

- ERC-20 escrow contract exists, but money movement is platform-funded and prototype-oriented.

Missing for production:

- Real payment onboarding, tenant deposits, buyer deposits, accounting, treasury controls, and reconciliation.

### 4.12 Admin And Oversight Dashboard

Required features:

- Listing review queue.
- KYC/KYB review queue.
- Broker license review.
- Property ownership verification queue.
- Duplicate/fraud queue.
- AML transaction monitoring.
- User management.
- Audit log explorer.
- Compliance case management.
- Transaction monitoring.
- Chain transaction monitor.
- Manual reconciliation tools.
- Metrics dashboards.

Current baseline:

- Admin listing review, KYC review, account status changes, duplicate warnings, and audit logs exist.

Missing for production:

- Compliance case management, representative/license verification, AML monitoring, fraud queues, metrics, and reconciliation tools.

### 4.13 Notifications And Communication

Required features:

- Email notifications.
- In-app notifications.
- SMS/WhatsApp optional notifications.
- Inquiry responses.
- Lease status changes.
- KYC review status.
- Listing review updates.
- Escrow/title transaction updates.
- Saved search alerts.
- Appointment reminders.
- Messaging between tenant and property owner or authorized representative.

Current baseline:

- API state changes exist, but no notification delivery.

### 4.14 Search, Analytics, And Reporting

Required features:

- Search index using Atlas Search, Elasticsearch, OpenSearch, Meilisearch, or similar.
- Event analytics for views, saves, inquiries, conversion, and lead source.
- Owner rental yield dashboard.
- Market/neighborhood analytics.
- Admin operational dashboards.
- Compliance reporting.
- Data export tools.

Current baseline:

- Basic DB queries and audit logs exist.

Missing for production:

- Search engine, analytics events, dashboards, and reporting exports.

### 4.15 Platform Operations

Required features:

- Background worker service.
- Scheduled jobs.
- Queue system for uploads, webhooks, chain indexing, notifications, and reconciliation.
- Structured logs with correlation ids.
- Metrics and dashboards.
- Error tracking.
- Health checks for DB, Cloudinary, blockchain RPC, and queues.
- Backups and restore drills.
- CI/CD deployment pipeline.
- Environment separation.
- Rate limits per role/endpoint.
- API versioning policy.

Current baseline:

- Health checks, logging, rate limiting, Docker, and tests exist.

Missing for production:

- Queue/worker architecture, monitoring stack, backups, CI/CD deployment details, and operational runbooks.

## 5. Recommended Domain Model Additions

Add or expand these backend modules:

| Module | Purpose |
| --- | --- |
| `wallets` | Wallet linking, nonce challenge, signatures, multiple wallets. |
| `ownerProfiles` | Individual/company owner metadata, authorized representative details, licenses, and team permissions under the `PROPERTY_OWNER` role. |
| `compliance` | AML/KYB/KYC cases, screenings, risk scoring, reviews. |
| `transactions` | Sale/rental transaction timeline, offers, agreements, statuses. |
| `offers` | Buyer offers and seller counteroffers. |
| `applications` | Rental applications and tenant screening. |
| `appointments` | Viewing requests, calendar slots, confirmations. |
| `messages` | Secure tenant/property-owner/admin communication. |
| `notifications` | Email/in-app/SMS delivery and preferences. |
| `analytics` | Listing views, leads, conversion, rental yield. |
| `neighborhoods` | Boundaries, market stats, local analytics. |
| `payments` | Fiat/stablecoin payment intents, receipts, refunds. |
| `chainTransactions` | Pending/mined/failed tx lifecycle and reconciliation. |
| `contractEvents` | Indexed on-chain events. |
| `savedSearches` | Search polygons, filters, alerts. |
| `maintenance` | Tenant maintenance requests and owner workflows. |

## 6. Recommended Smart Contract Additions

### Property Title V2

Recommended features:

- Role-based access using `AccessControl`.
- `MINTER_ROLE`, `VERIFIER_ROLE`, `PAUSER_ROLE`, `UPGRADER_ROLE` if upgradeable.
- One-title-per-listing guard or versioned titles.
- Token URI support.
- Title status enum: active, disputed, revoked, transferred, superseded.
- Revocation/dispute events.
- Property owner wallet as recipient after verified wallet linking.
- Optional soulbound/non-transferable mode until legal transfer is completed.
- Metadata hash and document hash separation.
- Batch read helpers for frontend/indexer efficiency.

### Purchase Escrow

Recommended features:

- Buyer-funded earnest money.
- Seller acceptance.
- Milestone/contingency states.
- Admin/arbiter dispute controls.
- Refund and release rules.
- Fee collection.
- Partial releases if required.
- Explicit event model for indexing.

### Lease Escrow V2

Recommended features:

- Tenant-funded escrow.
- Landlord and tenant signature verification over lease terms.
- Partial deposit settlement.
- Fee support.
- Emergency pause.
- Arbiter role or multisig dispute role.
- Clear token allowlist.
- Optional recurring rent payment support.

## 7. Integration Architecture Needed For Production

Recommended services:

- API service: current Express backend.
- Worker service: background jobs, webhooks, chain polling, notifications.
- Chain indexer: reads contract events into MongoDB/Postgres.
- Search service: full-text and geo search.
- Notification service: email/SMS/in-app.
- Compliance provider integration: KYC/KYB/AML.
- Payment provider integration: fiat or stablecoin on/off-ramp.
- Object storage/security service: uploads, virus scanning, document lifecycle.

Recommended infrastructure:

- MongoDB Atlas or managed MongoDB with backups.
- Redis/BullMQ or equivalent queue.
- Observability: logs, metrics, tracing, error tracking.
- Secret manager/KMS.
- Multisig wallet for contract ownership.
- RPC provider with fallback.

## 8. Production Readiness Checklist

### Security

- Enforce strong password rules and reset flow.
- Add email verification.
- Add 2FA for privileged roles.
- Add wallet signature challenge.
- Move refresh tokens to secure cookies or hardened storage strategy.
- Add authorization tests for every endpoint.
- Add object upload malware scanning.
- Add dependency and container scanning.
- Store private keys in KMS or remove backend custody where possible.
- Use multisig for contract owner.

### Blockchain

- Audit contracts.
- Add event indexer and reconciliation.
- Add tx persistence with retry/recovery.
- Verify contracts on explorer.
- Add staging/testnet deployment workflow.
- Add gas, RPC, and event monitoring.
- Define chain reorg behavior.

### Compliance

- Integrate KYC/KYB/AML provider.
- Add broker/representative license checks without adding a separate broker role.
- Add compliance cases.
- Add jurisdiction rules.
- Add retention/deletion policies.
- Add audit export.

### Reliability

- Add worker and queue.
- Add retries with idempotency keys.
- Add DB indexes for all common filters.
- Add backups and restore tests.
- Add uptime/error monitoring.
- Add load tests.

### Product

- Add frontend-ready dashboards.
- Add notifications.
- Add search ranking and saved searches.
- Add transaction timelines.
- Add lease signatures and sale offers.
- Add analytics.

## 9. Suggested Increment Roadmap

### Increment 1: Stabilize Existing Prototype

Goal: make the current backend/contracts demo reliable.

Tasks:

- Run and fix all tests.
- Add missing README updates for lease escrow env vars.
- Add chain transaction persistence for title mint and escrow actions.
- Add reconciliation endpoint/job for title and escrow states.
- Add wallet-linking endpoint using signed nonce.
- Add listing photo ordering and cover image.
- Add notification stubs for KYC/listing/lease events.

### Increment 2: Complete Marketplace Core

Goal: make listings, search, inquiries, and owner/admin workflows feel complete.

Tasks:

- Add richer property metadata.
- Add full-text search.
- Add saved searches.
- Add map clustering and polygon search.
- Add listing analytics events.
- Add owner dashboard data endpoints.
- Add admin review dashboards.

### Increment 3: Compliance And Owner Portal

Goal: support regulated marketplace operations.

Tasks:

- Add owner organization and authorized representative models under `PROPERTY_OWNER`.
- Add broker/representative license verification workflow.
- Add compliance case module.
- Add AML screening abstraction.
- Add admin assignment and review queues.
- Add risk scoring.

### Increment 4: Rental Management

Goal: make rentals production-like.

Tasks:

- Add tenant applications.
- Add lease negotiation and e-signature.
- Add tenant-funded escrow.
- Add recurring rent.
- Add move-in/move-out inspection.
- Add partial deposit settlement.
- Add maintenance requests.

### Increment 5: Sale Transactions

Goal: support property purchases.

Tasks:

- Add offer/counteroffer workflow.
- Add purchase agreement generation.
- Add purchase escrow.
- Add contingencies and closing checklist.
- Add title transfer/update.
- Add settlement statements.

### Increment 6: Production Hardening

Goal: launch-ready operational posture.

Tasks:

- Contract audit and fixes.
- Security review and penetration test.
- KMS/multisig/private key removal.
- Monitoring and alerting.
- Backups and runbooks.
- Load testing.
- Provider integrations.
- Legal/compliance review.

## 10. Prototype Completion Definition

A strong prototype should demonstrate:

- User registration/login.
- Property owner KYC submission and admin approval.
- Owner creates listing.
- Owner uploads photos and ownership document.
- Admin approves ownership document.
- Admin mints on-chain title.
- Public user searches map/listing results.
- Public user verifies title hash on-chain.
- Tenant sends inquiry or favorites listing.
- Owner creates rental lease.
- Admin funds and activates lease escrow.
- Admin settles deposit.
- Admin views audit log and transaction transparency.

The current codebase already supports most of this prototype path. The highest-value next step is to wire a frontend against the existing APIs, add wallet-linking, and add transaction/event reconciliation so the Web3 story is visible and trustworthy.

## 11. Highest Priority Gaps

1. Wallet linking and signed user consent.
2. Chain transaction persistence and reconciliation.
3. Event indexer for `TitleMinted`, `EscrowFunded`, `RentReleased`, `DepositReleased`, and `DepositRefunded`.
4. Notifications for workflow state changes.
5. Authorized representative and broker license verification within the `PROPERTY_OWNER` role.
6. Real compliance provider abstraction.
7. Polygon search, full-text search, and saved searches.
8. Rental application and lease signature workflow.
9. Sale offer/purchase escrow workflow.
10. Production key management and contract audit.
