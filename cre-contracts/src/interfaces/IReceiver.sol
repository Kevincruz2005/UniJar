// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Chainlink CRE IReceiver/ERC165 standard.
/// @dev Reference: https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
