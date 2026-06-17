// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SaleEscrow
/// @notice Holds a property sale payment in an ERC-20 stablecoin until the
///         platform owner releases it to the seller or refunds it to the buyer.
///         Custodial: only the platform owner moves funds, mirroring
///         LeaseEscrow's trust model. The buyer pays the platform off-chain;
///         the owner funds the on-chain escrow.
/// @dev    `token` MUST be a standard, non-fee-on-transfer, non-rebasing ERC-20
///         stablecoin. The contract pays out the stored `amount` exactly; a
///         fee-on-transfer token would under-fund the shared balance and cause
///         later transfers to revert.
contract SaleEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State { None, Funded, Released, Refunded }

    struct Escrow {
        string saleId;
        address buyer;
        address seller;
        address token;
        uint256 amount;
        bytes32 termsHash;
        State state;
    }

    uint256 private _nextEscrowId = 1;
    // Invariant: the contract's token balance must always cover the sum of all
    //            outstanding (non-terminal) escrow obligations.
    mapping(uint256 => Escrow) private _escrows;

    event EscrowFunded(uint256 indexed escrowId, string saleId, address indexed buyer, address indexed seller, uint256 amount);
    event EscrowReleased(uint256 indexed escrowId, address indexed seller, uint256 amount);
    event EscrowRefunded(uint256 indexed escrowId, address indexed buyer, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /// @notice Open a new sale escrow and pull `amount` tokens from the caller.
    /// @dev    Caller (owner) must have pre-approved at least `amount` to this
    ///         contract. `token` must be a standard non-fee-on-transfer ERC-20.
    /// @param saleId    Off-chain sale identifier.
    /// @param buyer     Address that receives a refund if the sale is cancelled.
    /// @param seller    Address that receives funds when the sale completes.
    /// @param token     ERC-20 stablecoin address (non-fee-on-transfer only).
    /// @param amount    Exact sale amount in token's smallest unit.
    /// @param termsHash SHA-256 hash of the off-chain sale terms document.
    /// @return escrowId Auto-incrementing id starting at 1.
    function openAndFund(
        string calldata saleId,
        address buyer,
        address seller,
        address token,
        uint256 amount,
        bytes32 termsHash
    ) external onlyOwner nonReentrant returns (uint256 escrowId) {
        require(buyer != address(0) && seller != address(0), "zero party");
        require(token != address(0), "zero token");
        escrowId = _nextEscrowId++;
        _escrows[escrowId] = Escrow({
            saleId: saleId,
            buyer: buyer,
            seller: seller,
            token: token,
            amount: amount,
            termsHash: termsHash,
            state: State.Funded
        });
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit EscrowFunded(escrowId, saleId, buyer, seller, amount);
    }

    /// @notice Release the escrowed funds to the seller (sale completed).
    /// @dev    Requires state Funded. Sets state Released before transfer
    ///         (checks-effects-interactions).
    function release(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Funded, "not funded");
        e.state = State.Released;
        IERC20(e.token).safeTransfer(e.seller, e.amount);
        emit EscrowReleased(escrowId, e.seller, e.amount);
    }

    /// @notice Refund the escrowed funds to the buyer (sale cancelled).
    /// @dev    Requires state Funded. Sets state Refunded before transfer
    ///         (checks-effects-interactions).
    function refund(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Funded, "not funded");
        e.state = State.Refunded;
        IERC20(e.token).safeTransfer(e.buyer, e.amount);
        emit EscrowRefunded(escrowId, e.buyer, e.amount);
    }

    /// @notice Return the full escrow record.
    /// @dev    Reverts with "no escrow" for non-existent or uninitialized ids.
    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        Escrow memory e = _escrows[escrowId];
        require(e.state != State.None, "no escrow");
        return e;
    }

    /// @notice Return the current state of an escrow.
    /// @dev    Caches the storage read. Reverts with "no escrow" for non-existent ids.
    function escrowState(uint256 escrowId) external view returns (State) {
        State s = _escrows[escrowId].state;
        require(s != State.None, "no escrow");
        return s;
    }
}
