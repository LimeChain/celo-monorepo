pragma solidity ^0.5.3;

import "./VestingInstance.sol";

contract VestingFactory {
  // mapping between beneficiary addresses and associated vesting contracts (schedules)
  mapping(address => VestingInstance) public hasVestedAt;

  /**
     * @notice Factory function for creating a new vesting contract instance
     * @param vestingBeneficiary address of the beneficiary to whom vested tokens are transferred
     * @param vestingAmount the amount that is to be vested by the contract
     * @param vestingCliff duration in seconds of the cliff in which tokens will begin to vest
     * @param vestingStartTime the time (as Unix time) at which point vesting starts
     * @param vestingPeriodSec duration in seconds of the period in which the tokens will vest
     * @param vestAmountPerPeriod the vesting amound per period where period is the vestingAmount distributed over the vestingPeriodSec
     * @param vestingRevokable whether the vesting is revocable or not
     * @param vestingRevoker address of the person revoking the vesting
     * @param vestingRefundDestination address of the refund receiver after the vesting is deemed revoked
     */
  function createVestingInstance(
    address vestingBeneficiary,
    uint256 vestingAmount,
    uint256 vestingCliff,
    uint256 vestingStartTime,
    uint256 vestingPeriodSec,
    uint256 vestAmountPerPeriod,
    bool vestingRevokable,
    address vestingRevoker,
    address vestingRefundDestination
  ) public {
    // creation of a new vesting contract
    hasVestedAt[vestingBeneficiary] = new VestingInstance(
      vestingBeneficiary,
      vestingAmount,
      vestingCliff,
      vestingStartTime,
      vestingPeriodSec,
      vestAmountPerPeriod,
      vestingRevokable,
      vestingRevoker,
      vestingRefundDestination
    );
  }
}
