// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LeaseEscrow
/// @notice Holds a lease's first month's rent + security deposit in an ERC-20
///         stablecoin. First month is released to the landlord on activation;
///         the deposit is held and settled (to landlord or tenant) at lease end.
///         Custodial: only the platform owner moves funds, mirroring
///         PropertyTitle's trust model. The tenant pays the platform off-chain;
///         the owner funds the on-chain escrow.
/// @dev    `token` MUST be a standard, non-fee-on-transfer, non-rebasing ERC-20
///         stablecoin. The contract pays out the stored `rentAmount`/`depositAmount`
///         exactly; a fee-on-transfer token would under-fund the shared balance and
///         cause later transfers to revert.
contract LeaseEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State { None, Funded, Active, Closed }

    struct Escrow {
        string leaseId;
        address landlord;
        address tenant;
        address token;
        uint256 rentAmount;
        uint256 depositAmount;
        bytes32 termsHash;
        State state;
    }

    uint256 private _nextEscrowId = 1;
    // Invariant: the contract's token balance must always cover the sum of all
    //            outstanding (non-Closed) escrow obligations.
    mapping(uint256 => Escrow) private _escrows;

    event EscrowFunded(uint256 indexed escrowId, string leaseId, address indexed landlord, address indexed tenant, uint256 rentAmount, uint256 depositAmount);
    event RentReleased(uint256 indexed escrowId, address indexed landlord, uint256 amount);
    event EscrowRefunded(uint256 indexed escrowId, address indexed tenant, uint256 amount);
    event DepositReleased(uint256 indexed escrowId, address indexed landlord, uint256 amount);
    event DepositRefunded(uint256 indexed escrowId, address indexed tenant, uint256 amount);

    constructor() Ownable(msg.sender) {}

    function openAndFund(
        string calldata leaseId,
        address landlord,
        address tenant,
        address token,
        uint256 rentAmount,
        uint256 depositAmount,
        bytes32 termsHash
    ) external onlyOwner nonReentrant returns (uint256 escrowId) {
        require(landlord != address(0) && tenant != address(0), "zero party");
        require(token != address(0), "zero token");
        escrowId = _nextEscrowId++;
        _escrows[escrowId] = Escrow({
            leaseId: leaseId,
            landlord: landlord,
            tenant: tenant,
            token: token,
            rentAmount: rentAmount,
            depositAmount: depositAmount,
            termsHash: termsHash,
            state: State.Funded
        });
        IERC20(token).safeTransferFrom(msg.sender, address(this), rentAmount + depositAmount);
        emit EscrowFunded(escrowId, leaseId, landlord, tenant, rentAmount, depositAmount);
    }

    function activate(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Funded, "not funded");
        e.state = State.Active;
        IERC20(e.token).safeTransfer(e.landlord, e.rentAmount);
        emit RentReleased(escrowId, e.landlord, e.rentAmount);
    }

    function cancel(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Funded, "not funded");
        e.state = State.Closed;
        IERC20(e.token).safeTransfer(e.tenant, e.rentAmount + e.depositAmount);
        emit EscrowRefunded(escrowId, e.tenant, e.rentAmount + e.depositAmount);
    }

    function releaseDeposit(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Active, "not active");
        e.state = State.Closed;
        IERC20(e.token).safeTransfer(e.landlord, e.depositAmount);
        emit DepositReleased(escrowId, e.landlord, e.depositAmount);
    }

    function refundDeposit(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.state == State.Active, "not active");
        e.state = State.Closed;
        IERC20(e.token).safeTransfer(e.tenant, e.depositAmount);
        emit DepositRefunded(escrowId, e.tenant, e.depositAmount);
    }

    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        Escrow memory e = _escrows[escrowId];
        require(e.state != State.None, "no escrow");
        return e;
    }

    function escrowState(uint256 escrowId) external view returns (State) {
        State s = _escrows[escrowId].state;
        require(s != State.None, "no escrow");
        return s;
    }
}
