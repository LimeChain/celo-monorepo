pragma solidity ^0.5.3;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

import "./VestingInstance.sol";
import "./interfaces/IVestingFactory.sol";

import "../common/Initializable.sol";
import "../common/UsingRegistry.sol";

contract VestingFactory is Initializable, UsingRegistry, IVestingFactory {
  // mapping between beneficiary addresses and associated vesting contracts (schedules)
  mapping(address => address) public vestings;

  function initialize(address registryAddress) external initializer {
    _transferOwnership(msg.sender);
    setRegistry(registryAddress);
  }

  event NewVestingInstanceCreated(address indexed beneficiary, address atAddress);

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
   * @return The address of the newly created vesting instance
   */
  function createVestingInstance(
    address payable vestingBeneficiary,
    uint256 vestingAmount,
    uint256 vestingCliff,
    uint256 vestingStartTime,
    uint256 vestingPeriodSec,
    uint256 vestAmountPerPeriod,
    bool vestingRevokable,
    address payable vestingRevoker
  ) external onlyOwner returns (address) {
    require(
      getGoldToken().balanceOf(address(this)) >= vestingAmount,
      "factory balance is unsufficient to create a new vesting"
    );

    require(vestings[vestingBeneficiary] == address(0), "only one vesting per beneficiary allowed");

    address newVestingInstance = address(
      new VestingInstance(
        vestingBeneficiary,
        vestingAmount,
        vestingCliff,
        vestingStartTime,
        vestingPeriodSec,
        vestAmountPerPeriod,
        vestingRevokable,
        vestingRevoker,
        address(registry)
      )
    );
    vestings[vestingBeneficiary] = newVestingInstance;
    getGoldToken().transfer(vestings[vestingBeneficiary], vestingAmount);
    emit NewVestingInstanceCreated(vestingBeneficiary, newVestingInstance);
    return newVestingInstance;
  }
}
