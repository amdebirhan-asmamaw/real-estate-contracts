// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PropertyTitle
/// @notice ERC-721 digital title for a verified real-estate listing. Each token
///         anchors the sha-256 hash of the approved ownership document and the
///         off-chain listing id. Minting is restricted to the platform owner
///         (the custodial minter wallet) in this increment.
contract PropertyTitle is ERC721, Ownable {
    enum TitleStatus {
        None,
        Active,
        Disputed,
        Revoked
    }

    uint256 private _nextTokenId = 1;

    mapping(uint256 => bytes32) private _documentHash;
    mapping(uint256 => string) private _listingId;
    mapping(uint256 => TitleStatus) private _titleStatus;
    mapping(bytes32 => uint256) private _tokenByListingHash;

    error ListingAlreadyMinted(string listingId, uint256 tokenId);
    error InvalidTitleStatus(uint256 tokenId, TitleStatus status);

    event TitleMinted(
        uint256 indexed tokenId,
        address indexed to,
        string listingId,
        bytes32 documentHash
    );
    event TitleStatusChanged(
        uint256 indexed tokenId,
        TitleStatus indexed status,
        string reason
    );

    constructor() ERC721("PropertyTitle", "PTITLE") Ownable(msg.sender) {}

    /// @notice Mints a title to `to`, anchoring the listing id and document hash.
    /// @dev onlyOwner — the backend's custodial minter wallet. A later increment
    ///      can relax this to mint directly to a property owner's wallet.
    function mintTitle(
        address to,
        string calldata listingId,
        bytes32 documentHash
    ) external onlyOwner returns (uint256 tokenId) {
        bytes32 listingHash = keccak256(bytes(listingId));
        uint256 existingTokenId = _tokenByListingHash[listingHash];
        if (existingTokenId != 0) {
            revert ListingAlreadyMinted(listingId, existingTokenId);
        }

        tokenId = _nextTokenId++;
        _tokenByListingHash[listingHash] = tokenId;
        _safeMint(to, tokenId);
        _documentHash[tokenId] = documentHash;
        _listingId[tokenId] = listingId;
        _titleStatus[tokenId] = TitleStatus.Active;
        emit TitleMinted(tokenId, to, listingId, documentHash);
    }

    function documentHashOf(uint256 tokenId) external view returns (bytes32) {
        _requireOwned(tokenId);
        return _documentHash[tokenId];
    }

    function listingIdOf(uint256 tokenId) external view returns (string memory) {
        _requireOwned(tokenId);
        return _listingId[tokenId];
    }

    function tokenIdOfListing(
        string calldata listingId
    ) external view returns (uint256) {
        return _tokenByListingHash[keccak256(bytes(listingId))];
    }

    function titleStatusOf(
        uint256 tokenId
    ) external view returns (TitleStatus) {
        _requireOwned(tokenId);
        return _titleStatus[tokenId];
    }

    function markDisputed(
        uint256 tokenId,
        string calldata reason
    ) external onlyOwner {
        _requireOwned(tokenId);
        TitleStatus current = _titleStatus[tokenId];
        if (current != TitleStatus.Active) {
            revert InvalidTitleStatus(tokenId, current);
        }
        _titleStatus[tokenId] = TitleStatus.Disputed;
        emit TitleStatusChanged(tokenId, TitleStatus.Disputed, reason);
    }

    function clearDispute(
        uint256 tokenId,
        string calldata reason
    ) external onlyOwner {
        _requireOwned(tokenId);
        TitleStatus current = _titleStatus[tokenId];
        if (current != TitleStatus.Disputed) {
            revert InvalidTitleStatus(tokenId, current);
        }
        _titleStatus[tokenId] = TitleStatus.Active;
        emit TitleStatusChanged(tokenId, TitleStatus.Active, reason);
    }

    function revokeTitle(
        uint256 tokenId,
        string calldata reason
    ) external onlyOwner {
        _requireOwned(tokenId);
        TitleStatus current = _titleStatus[tokenId];
        if (current == TitleStatus.Revoked) {
            revert InvalidTitleStatus(tokenId, current);
        }
        _titleStatus[tokenId] = TitleStatus.Revoked;
        emit TitleStatusChanged(tokenId, TitleStatus.Revoked, reason);
    }

    // ─── Token URI (off-chain metadata) ──────────────────────────────────────

    string private _baseTokenURI;

    /// @notice Sets the base URI for token metadata (e.g. https://api.example.com/titles/).
    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
