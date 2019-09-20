pragma solidity ^0.5.3;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/utils/ReentrancyGuard.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "./interfaces/IValidators.sol";
import "../common/Initializable.sol";
import "../common/FixidityLib.sol";
import "../common/linkedlists/AddressLinkedList.sol";
import "../common/UsingRegistry.sol";


/**
 * @title A contract for registering and electing Validator Groups and Validators.
 */
contract Validators is IValidators, Ownable, ReentrancyGuard, Initializable, UsingRegistry {

  using FixidityLib for FixidityLib.Fraction;
  using AddressLinkedList for LinkedList.List;
  using SafeMath for uint256;
  using BytesLib for bytes;

  address constant PROOF_OF_POSSESSION = address(0xff - 4);
  uint256 constant MAX_INT = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

  struct RegistrationRequirements {
    uint256 group;
    uint256 validator;
  }

  struct DeregistrationLockups {
    uint256 group;
    uint256 validator;
  }

  struct ValidatorGroup {
    string name;
    string url;
    FixidityLib.Fraction commission;
    LinkedList.List members;
  }

  struct Validator {
    string name;
    string url;
    bytes publicKeysData;
    address affiliation;
  }

  mapping(address => ValidatorGroup) private groups;
  mapping(address => Validator) private validators;
  address[] private _groups;
  address[] private _validators;
  RegistrationRequirements public registrationRequirements;
  DeregistrationLockups public deregistrationLockups;
  uint256 public maxGroupSize;

  event MaxGroupSizeSet(
    uint256 size
  );

  event RegistrationRequirementsSet(
    uint256 group,
    uint256 validator
  );

  event DeregistrationLockupsSet(
    uint256 group,
    uint256 validator
  );

  event ValidatorRegistered(
    address indexed validator,
    string name,
    string url,
    bytes publicKeysData
  );

  event ValidatorDeregistered(
    address indexed validator
  );

  event ValidatorAffiliated(
    address indexed validator,
    address indexed group
  );

  event ValidatorDeaffiliated(
    address indexed validator,
    address indexed group
  );

  event ValidatorGroupRegistered(
    address indexed group,
    string name,
    string url
  );

  event ValidatorGroupDeregistered(
    address indexed group
  );

  event ValidatorGroupMemberAdded(
    address indexed group,
    address indexed validator
  );

  event ValidatorGroupMemberRemoved(
    address indexed group,
    address indexed validator
  );

  event ValidatorGroupMemberReordered(
    address indexed group,
    address indexed validator
  );

  /**
   * @notice Initializes critical variables.
   * @param registryAddress The address of the registry contract.
   * @param groupRequirement The minimum locked gold needed to register a group.
   * @param validatorRequirement The minimum locked gold needed to register a validator. 
   * @param groupLockup The duration the above gold remains locked after deregistration.
   * @param validatorLockup The duration the above gold remains locked after deregistration.
   * @param _maxGroupSize The maximum group size.
   * @dev Should be called only once.
   */
  function initialize(
    address registryAddress,
    uint256 groupRequirement,
    uint256 validatorRequirement,
    uint256 groupLockup,
    uint256 validatorLockup,
    uint256 _maxGroupSize
  )
    external
    initializer
  {
    _transferOwnership(msg.sender);
    setRegistry(registryAddress);
    registrationRequirements = RegistrationRequirements(groupRequirement, validatorRequirement);
    deregistrationLockups = DeregistrationLockups(groupLockup, validatorLockup);
    maxGroupSize = _maxGroupSize;
  }

  /**
   * @notice Updates the maximum number of members a group can have.
   * @param size The maximum group size.
   * @return True upon success.
   */
  function setMaxGroupSize(uint256 size) external onlyOwner returns (bool) {
    require(0 < size && size != maxGroupSize);
    maxGroupSize = size;
    emit MaxGroupSizeSet(size);
    return true;
  }

  /**
   * @notice Updates the minimum gold requirements to register a validator group or validator.
   * @param groupRequirement The minimum locked gold needed to register a group.
   * @param validatorRequirement The minimum locked gold needed to register a validator. 
   * @return True upon success.
   * @dev The new requirement is only enforced for future validator or group registrations.
   */
  function setRegistrationRequirements(
    uint256 groupRequirement,
    uint256 validatorRequirement
  )
    external
    onlyOwner
    returns (bool)
  {
    require(
      groupRequirement != registrationRequirements.group ||
      validatorRequirement != registrationRequirements.validator
    );
    registrationRequirements = RegistrationRequirements(groupRequirement, validatorRequirement);
    emit RegistrationRequirementsSet(groupRequirement, validatorRequirement);
    return true;
  }

  /**
   * @notice Updates the duration for which gold remains locked after deregistration.
   * @param groupLockup The duration for groups.
   * @param validatorLockup The duration for validators.
   * @return True upon success.
   * @dev The new requirement is only enforced for future validator or group deregistrations.
   */
  function setDeregistrationLockup(
    uint256 groupLockup,
    uint256 validatorLockup
  )
    external
    onlyOwner
    returns (bool)
  {
    require(
      groupLockup != deregistrationLockups.group ||
      validatorLockup != deregistrationLockups.validator
    );
    deregistrationLockups = DeregistrationLockups(groupLockup, validatorLockup);
    emit DeregistrationLockupsSet(groupLockup, validatorLockup);
    return true;
  }

  /**
   * @notice Registers a validator unaffiliated with any validator group.
   * @param name A name for the validator.
   * @param url A URL for the validator.
   * @param publicKeysData Comprised of three tightly-packed elements:
   *    - publicKey - The public key that the validator is using for consensus, should match
   *      msg.sender. 64 bytes.
   *    - blsPublicKey - The BLS public key that the validator is using for consensus, should pass
   *      proof of possession. 48 bytes.
   *    - blsPoP - The BLS public key proof of possession. 96 bytes.
   * @return True upon success.
   * @dev Fails if the account is already a validator or validator group.
   * @dev Fails if the account does not have sufficient weight.
   */
  function registerValidator(
    string calldata name,
    string calldata url,
    bytes calldata publicKeysData
  )
    external
    nonReentrant
    returns (bool)
  {
    require(
      bytes(name).length > 0 &&
      bytes(url).length > 0 &&
      // secp256k1 public key + BLS public key + BLS proof of possession
      publicKeysData.length == (64 + 48 + 96)
    );
    bytes memory proofOfPossessionBytes = publicKeysData.slice(64, 48 + 96);
    require(checkProofOfPossession(proofOfPossessionBytes));

    address account = getLockedGold().getAccountFromValidator(msg.sender);
    require(!isValidator(account) && !isValidatorGroup(account));
    require(meetsValidatorRegistrationRequirement(account));

    Validator memory validator = Validator(name, url, publicKeysData, address(0));
    validators[account] = validator;
    _validators.push(account);
    getLockedGold().setAccountMustMaintain(account, registrationRequirements.validator, MAX_INT);
    emit ValidatorRegistered(account, name, url, publicKeysData);
    return true;
  }

  /**
   * @notice Checks a BLS proof of possession.
   * @param proofOfPossessionBytes The public key and signature of the proof of possession.
   * @return True upon success.
   */
  function checkProofOfPossession(bytes memory proofOfPossessionBytes) private returns (bool) {
    bool success;
    (success, ) = PROOF_OF_POSSESSION.call.value(0).gas(gasleft())(proofOfPossessionBytes);
    return success;
  }

  /**
   * @notice Returns whether an account meets the requirements to register a validator.
   * @param account The account.
   * @return Whether an account meets the requirements to register a validator.
   */
  function meetsValidatorRegistrationRequirement(address account) public view returns (bool) {
    getLockedGold().getAccountTotalLockedGold(account) >= registrationRequirements.validator;
  }

  /**
   * @notice Returns whether an account meets the requirements to register a group.
   * @param account The account.
   * @return Whether an account meets the requirements to register a group.
   */
  function meetsValidatorGroupRegistrationRequirement(address account) public view returns (bool) {
    getLockedGold().getAccountTotalLockedGold(account) >= registrationRequirements.group;
  }

  /**
   * @notice De-registers a validator, removing it from the group for which it is a member.
   * @param index The index of this validator in the list of all validators.
   * @return True upon success.
   * @dev Fails if the account is not a validator.
   */
  function deregisterValidator(uint256 index) external nonReentrant returns (bool) {
    address account = getLockedGold().getAccountFromValidator(msg.sender);
    require(isValidator(account));
    Validator storage validator = validators[account];
    if (validator.affiliation != address(0)) {
      _deaffiliate(validator, account);
    }
    delete validators[account];
    deleteElement(_validators, account, index);
    getLockedGold().setAccountMustMaintain(account, registrationRequirements.validator, now.add(deregistrationLockups.validator));
    emit ValidatorDeregistered(account);
    return true;
  }

  /**
   * @notice Affiliates a validator with a group, allowing it to be added as a member.
   * @param group The validator group with which to affiliate.
   * @return True upon success.
   * @dev De-affiliates with the previously affiliated group if present.
   */
  function affiliate(address group) external nonReentrant returns (bool) {
    address account = getLockedGold().getAccountFromValidator(msg.sender);
    require(isValidator(account) && isValidatorGroup(group));
    Validator storage validator = validators[account];
    if (validator.affiliation != address(0)) {
      _deaffiliate(validator, account);
    }
    validator.affiliation = group;
    emit ValidatorAffiliated(account, group);
    return true;
  }

  /**
   * @notice De-affiliates a validator, removing it from the group for which it is a member.
   * @return True upon success.
   * @dev Fails if the account is not a validator with non-zero affiliation.
   */
  function deaffiliate() external nonReentrant returns (bool) {
    address account = getLockedGold().getAccountFromValidator(msg.sender);
    require(isValidator(account));
    Validator storage validator = validators[account];
    require(validator.affiliation != address(0));
    _deaffiliate(validator, account);
    return true;
  }

  /**
   * @notice Registers a validator group with no member validators.
   * @param name A name for the validator group.
   * @param url A URL for the validator group.
   * @return True upon success.
   * @dev Fails if the account is already a validator or validator group.
   * @dev Fails if the account does not have sufficient weight.
   */
  function registerValidatorGroup(
    string calldata name,
    string calldata url,
    uint256 commission,
    address[] calldata members
  )
    external
    nonReentrant
    returns (bool)
  {
    require(bytes(name).length > 0);
    require(bytes(url).length > 0);
    // TODO(asa)
    // require(isFraction(commission));
    require(members.length <= maxGroupSize);
    address account = getLockedGold().getAccountFromValidator(msg.sender);
    require(!isValidator(account) && !isValidatorGroup(account));
    require(meetsValidatorGroupRegistrationRequirement(account));

    ValidatorGroup storage group = groups[account];
    group.name = name;
    group.url = url;
    group.commission = FixidityLib.wrap(commission);
    for (uint256 i = 0; i < members.length; i = i.add(1)) {
      _addMember(account, members[i]);
    }
    _groups.push(account);
    getLockedGold().setAccountMustMaintain(account, registrationRequirements.group, MAX_INT);
    emit ValidatorGroupRegistered(account, name, url);
    return true;
  }

  /**
   * @notice De-registers a validator group.
   * @param index The index of this validator group in the list of all validator groups.
   * @return True upon success.
   * @dev Fails if the account is not a validator group with no members.
   */
  function deregisterValidatorGroup(uint256 index) external nonReentrant returns (bool) {
    address account = getLockedGold().getAccountFromValidator(msg.sender);
    // Only empty Validator Groups can be deregistered.
    require(isValidatorGroup(account) && groups[account].members.numElements == 0);
    delete groups[account];
    deleteElement(_groups, account, index);
    getLockedGold().setAccountMustMaintain(account, registrationRequirements.group, now.add(deregistrationLockups.group));
    emit ValidatorGroupDeregistered(account);
    return true;
  }

  /**
   * @notice Adds a member to the end of a validator group's list of members.
   * @param validator The validator to add to the group
   * @return True upon success.
   * @dev Fails if `validator` has not set their affiliation to this account.
   */
  function addMember(address validator) external nonReentrant returns (bool) {
    address account = getLockedGold().getAccountFromValidator(msg.sender);
    require(isValidatorGroup(account) && isValidator(validator));
    return _addMember(account, validator);
  }

  function _addMember(address group, address validator) private returns (bool) {
    ValidatorGroup storage _group = groups[group];
    require(_group.members.numElements < maxGroupSize);
    require(validators[validator].affiliation == group && !_group.members.contains(validator));
    _group.members.push(validator);
    emit ValidatorGroupMemberAdded(group, validator);
    return true;
  }

  /**
   * @notice De-affiliates a validator, removing it from the group for which it is a member.

  /**
   * @notice Removes a member from a validator group.
   * @param validator The validator to remove from the group
   * @return True upon success.
   * @dev Fails if `validator` is not a member of the account's group.
   */
  function removeMember(address validator) external nonReentrant returns (bool) {
    address account = getLockedGold().getAccountFromValidator(msg.sender);
    require(isValidatorGroup(account) && isValidator(validator));
    return _removeMember(account, validator);
  }

  /**
   * @notice Reorders a member within a validator group.
   * @param validator The validator to reorder.
   * @param lesserMember The member who will be behind `validator`, or 0 if `validator` will be the
   *   last member.
   * @param greaterMember The member who will be ahead of `validator`, or 0 if `validator` will be
   *   the first member.
   * @return True upon success.
   * @dev Fails if `validator` is not a member of the account's validator group.
   */
  function reorderMember(
    address validator,
    address lesserMember,
    address greaterMember
  )
    external
    nonReentrant
    returns (bool)
  {
    address account = getLockedGold().getAccountFromValidator(msg.sender);
    require(isValidatorGroup(account) && isValidator(validator));
    ValidatorGroup storage group = groups[account];
    require(group.members.contains(validator));
    group.members.update(validator, lesserMember, greaterMember);
    emit ValidatorGroupMemberReordered(account, validator);
    return true;
  }

  /**
   * @notice Returns validator information.
   * @param account The account that registered the validator.
   * @return The unpacked validator struct.
   */
  function getValidator(
    address account
  )
    external
    view
    returns (
      string memory name,
      string memory url,
      bytes memory publicKeysData,
      address affiliation
    )
  {
    require(isValidator(account));
    Validator storage validator = validators[account];
    return (
      validator.name,
      validator.url,
      validator.publicKeysData,
      validator.affiliation
    );
  }

  /**
   * @notice Returns validator group information.
   * @param account The account that registered the validator group.
   * @return The unpacked validator group struct.
   */
  function getValidatorGroup(
    address account
  )
    external
    view
    returns (string memory, string memory, address[] memory)
  {
    require(isValidatorGroup(account));
    ValidatorGroup storage group = groups[account];
    return (group.name, group.url, group.members.getKeys());
  }

  function getGroupNumMembers(address account) public view returns (uint256) {
    return groups[account].members.numElements;
  }

  function getTopValidatorsFromGroup(address account, uint256 n) external view returns (address[] memory) {
    address[] memory topAccounts = groups[account].members.headN(n);
    address[] memory topValidators = new address[](n);
    for (uint256 i = 0; i < n; i = i.add(1)) {
      topValidators[i] = getLockedGold().getValidatorFromAccount(topAccounts[i]);
    }
    return topValidators;
  }

  function getGroupsNumMembers(address[] calldata accounts) external view returns (uint256[] memory) {
    uint256[] memory numMembers = new uint256[](accounts.length);
    for (uint256 i = 0; i < accounts.length; i = i.add(1)) {
      numMembers[i] = getGroupNumMembers(accounts[i]);
    }
    return numMembers;
  }

  function getNumRegisteredValidators() external view returns (uint256) {
    return _validators.length;
  }

  /**
   * @notice Returns the Locked Gold requirements to register a validator or group.
   * @return The locked gold requirements to register a validator or group.
   */
  function getRegistrationRequirements() external view returns (uint256, uint256) {
    return (registrationRequirements.group, registrationRequirements.validator);
  }

  /**
   * @notice Returns the list of registered validator accounts.
   * @return The list of registered validator accounts.
   */
  function getRegisteredValidators() external view returns (address[] memory) {
    return _validators;
  }

  /**
   * @notice Returns the list of registered validator group accounts.
   * @return The list of registered validator group addresses.
   */
  function getRegisteredValidatorGroups() external view returns (address[] memory) {
    return _groups;
  }

  /**
   * @notice Returns whether a particular account has a registered validator group.
   * @param account The account.
   * @return Whether a particular address is a registered validator group.
   */
  function isValidatorGroup(address account) public view returns (bool) {
    return bytes(groups[account].name).length > 0;
  }

  /**
   * @notice Returns whether a particular account has a registered validator.
   * @param account The account.
   * @return Whether a particular address is a registered validator.
   */
  function isValidator(address account) public view returns (bool) {
    return bytes(validators[account].name).length > 0;
  }

  /**
   * @notice Deletes an element from a list of addresses.
   * @param list The list of addresses.
   * @param element The address to delete.
   * @param index The index of `element` in the list.
   */
  function deleteElement(address[] storage list, address element, uint256 index) private {
    require(index < list.length && list[index] == element);
    uint256 lastIndex = list.length.sub(1);
    list[index] = list[lastIndex];
    list[lastIndex] = address(0);
    list.length = lastIndex;
  }

  /**
   * @notice Removes a member from a validator group.
   * @param group The group from which the member should be removed.
   * @param validator The validator to remove from the group.
   * @return True upon success.
   * @dev If `validator` was the only member of `group`, `group` becomes unelectable.
   * @dev Fails if `validator` is not a member of `group`.
   */
  function _removeMember(address group, address validator) private returns (bool) {
    ValidatorGroup storage _group = groups[group];
    require(validators[validator].affiliation == group && _group.members.contains(validator));
    _group.members.remove(validator);
    emit ValidatorGroupMemberRemoved(group, validator);

    // Empty validator groups are not electable.
    if (groups[group].members.numElements == 0) {
      getElection().markGroupIneligible(group);
    }
    return true;
  }

  /**
   * @notice De-affiliates a validator, removing it from the group for which it is a member.
   * @param validator The validator to deaffiliate from their affiliated validator group.
   * @param validatorAccount The LockedGold account of the validator.
   * @return True upon success.
   */
  function _deaffiliate(
    Validator storage validator,
    address validatorAccount
  )
    private
    returns (bool)
  {
    address affiliation = validator.affiliation;
    ValidatorGroup storage group = groups[affiliation];
    if (group.members.contains(validatorAccount)) {
      _removeMember(affiliation, validatorAccount);
    }
    emit ValidatorDeaffiliated(validatorAccount, affiliation);
    validator.affiliation = address(0);
    return true;
  }
}
