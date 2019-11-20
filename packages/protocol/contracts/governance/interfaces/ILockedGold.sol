pragma solidity ^0.5.3;

interface ILockedGold {
  function incrementNonvotingAccountBalance(address, uint256) external;
  function decrementNonvotingAccountBalance(address, uint256) external;
  function getAccountTotalLockedGold(address) external view returns (uint256);
  function getTotalLockedGold() external view returns (uint256);
  function lock() external payable;
  function unlock(uint256) external;
  function relock(uint256) external;
  function withdraw(uint256) external;
}
