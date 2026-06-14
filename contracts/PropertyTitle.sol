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
    uint256 private _nextTokenId = 1;

    mapping(uint256 => bytes32) private _documentHash;
    mapping(uint256 => string) private _listingId;

    event TitleMinted(
        uint256 indexed tokenId,
        address indexed to,
        string listingId,
        bytes32 documentHash
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
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _documentHash[tokenId] = documentHash;
        _listingId[tokenId] = listingId;
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
}
