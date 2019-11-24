import { CeloContractName } from '@celo/protocol/lib/registry-utils'
import { assertEqualBN, assertRevert, NULL_ADDRESS } from '@celo/protocol/lib/test-utils'
import { BigNumber } from 'bignumber.js'
import * as _ from 'lodash'
import {
  AccountsContract,
  AccountsInstance,
  GoldTokenContract,
  GoldTokenInstance,
  LockedGoldContract,
  LockedGoldInstance,
  RegistryContract,
  RegistryInstance,
  VestingFactoryContract,
  VestingFactoryInstance,
  VestingInstanceContract,
} from 'types'

const ONE_GOLDTOKEN = new BigNumber('1000000000000000000')

const VestingFactory: VestingFactoryContract = artifacts.require('VestingFactory')
const VestingInstance: VestingInstanceContract = artifacts.require('VestingInstance')
const Accounts: AccountsContract = artifacts.require('Accounts')
const LockedGold: LockedGoldContract = artifacts.require('LockedGold')
const GoldToken: GoldTokenContract = artifacts.require('GoldToken')
const Registry: RegistryContract = artifacts.require('Registry')

// @ts-ignore
// TODO(mcortesi): Use BN
LockedGold.numberFormat = 'BigNumber'

const MINUTE = 60
const HOUR = 60 * 60
const DAY = 24 * HOUR
const MONTH = 30 * DAY

contract('Vesting', (accounts: string[]) => {
  const owner = accounts[0]
  const beneficiary = accounts[1]
  const revoker = accounts[2]
  const refundDestination = accounts[3]
  let accountsInstance: AccountsInstance
  let lockedGoldInstance: LockedGoldInstance
  let goldTokenInstance: GoldTokenInstance
  let vestingFactoryInstance: VestingFactoryInstance
  let registry: RegistryInstance

  let vestingDefaultSchedule = {
    vestingBeneficiary: beneficiary,
    vestingAmount: ONE_GOLDTOKEN,
    vestingCliff: HOUR,
    vestingStartTime: Math.round((Date.now() + 5 * MINUTE * 1000) / 1000),
    vestingPeriodSec: MONTH * 3,
    vestAmountPerPeriod: ONE_GOLDTOKEN.div(4),
    vestingRevokable: true,
    vestingRevoker: revoker,
    vestingRefundDestination: refundDestination,
  }

  beforeEach(async () => {
    accountsInstance = await Accounts.new()
    lockedGoldInstance = await LockedGold.new()
    goldTokenInstance = await GoldToken.new()
    vestingFactoryInstance = await VestingFactory.new()

    registry = await Registry.new()
    await registry.setAddressFor(CeloContractName.Accounts, accountsInstance.address)
    await registry.setAddressFor(CeloContractName.LockedGold, lockedGoldInstance.address)
    await registry.setAddressFor(CeloContractName.GoldToken, goldTokenInstance.address)
    await registry.setAddressFor(CeloContractName.VestingFactory, vestingFactoryInstance.address)
    await vestingFactoryInstance.initialize(registry.address)
    await accountsInstance.createAccount()

    // prefund the vesting factory instance to simulate well-funded core contract in the genesis block
    await goldTokenInstance.transfer(vestingFactoryInstance.address, ONE_GOLDTOKEN.times(2), {
      from: owner,
    })
  })

  describe('#initialize()', () => {
    it('should set the owner', async () => {
      const vestingFactoryOwner: string = await vestingFactoryInstance.owner()
      assert.equal(vestingFactoryOwner, owner)
    })

    it('should set the registry address', async () => {
      const registryAddress: string = await vestingFactoryInstance.registry()
      assert.equal(registryAddress, registry.address)
    })

    it('should revert if already initialized', async () => {
      await assertRevert(vestingFactoryInstance.initialize(registry.address))
    })
  })

  describe('#setRegistry()', () => {
    const anAddress: string = accounts[2]

    it('should set the registry when called by the owner', async () => {
      await vestingFactoryInstance.setRegistry(anAddress)
      assert.equal(await vestingFactoryInstance.registry(), anAddress)
    })

    it('should revert when not called by the owner', async () => {
      await assertRevert(vestingFactoryInstance.setRegistry(anAddress, { from: beneficiary }))
    })
  })

  describe('#vesting creation()', () => {
    const createNewVestingInstanceTx = async () => {
      const vestingInstanceTx = await vestingFactoryInstance.createVestingInstance(
        vestingDefaultSchedule.vestingBeneficiary,
        vestingDefaultSchedule.vestingAmount,
        vestingDefaultSchedule.vestingCliff,
        vestingDefaultSchedule.vestingStartTime,
        vestingDefaultSchedule.vestingPeriodSec,
        vestingDefaultSchedule.vestAmountPerPeriod,
        vestingDefaultSchedule.vestingRevokable,
        vestingDefaultSchedule.vestingRevoker,
        vestingDefaultSchedule.vestingRefundDestination
      )
      return vestingInstanceTx
    }

    it('should create a new vesting instance and emit event', async () => {
      const newVestingInstanceTx = await createNewVestingInstanceTx()

      const newVestingInstanceCreatedEvent = _.find(newVestingInstanceTx.logs, {
        event: 'NewVestingInstanceCreated',
      })
      assert.exists(newVestingInstanceCreatedEvent)
    })

    it('should create a new vesting instance and map beneficiary to vesting', async () => {
      const newVestingInstanceTx = await createNewVestingInstanceTx()
      const newVestingInstanceCreatedEvent = _.find(newVestingInstanceTx.logs, {
        event: 'NewVestingInstanceCreated',
      })
      assert.exists(newVestingInstanceCreatedEvent)
      const newVestingInstanceAddress = newVestingInstanceCreatedEvent.args.atAddress
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      assert.equal(newVestingInstanceAddress, vestingInstanceRegistryAddress)
    })

    it('should set a beneficiary to vesting instance', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const vestingBeneficiary = await vestingInstance.beneficiary()
      assert.equal(vestingBeneficiary, vestingDefaultSchedule.vestingBeneficiary)
    })

    it('should set vesting amount to vesting instance', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const [
        vestingAmount,
        vestAmountPerPeriod,
        vestingPeriods,
        vestingPeriodSec,
        vestingStartTime,
        vestingCliffStartTime,
      ] = await vestingInstance.vestingScheme()
      assertEqualBN(vestingAmount, vestingDefaultSchedule.vestingAmount)
    })

    it('should set vesting amount per period to vesting instance', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const [
        vestingAmount,
        vestAmountPerPeriod,
        vestingPeriods,
        vestingPeriodSec,
        vestingStartTime,
        vestingCliffStartTime,
      ] = await vestingInstance.vestingScheme()
      assertEqualBN(vestAmountPerPeriod, vestingDefaultSchedule.vestAmountPerPeriod)
    })

    it('should set vesting periods to vesting instance', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const [
        vestingAmount,
        vestAmountPerPeriod,
        vestingPeriods,
        vestingPeriodSec,
        vestingStartTime,
        vestingCliffStartTime,
      ] = await vestingInstance.vestingScheme()
      const vestingPeriodsComputed = vestingDefaultSchedule.vestingAmount.div(
        vestingDefaultSchedule.vestAmountPerPeriod
      )
      assertEqualBN(vestingPeriodsComputed, vestingPeriods)
    })

    it('should set vesting period per sec to vesting instance', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const [
        vestingAmount,
        vestAmountPerPeriod,
        vestingPeriods,
        vestingPeriodSec,
        vestingStartTime,
        vestingCliffStartTime,
      ] = await vestingInstance.vestingScheme()
      assertEqualBN(vestingPeriodSec, vestingDefaultSchedule.vestingPeriodSec)
    })

    it('should set vesting start time to vesting instance', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const [
        vestingAmount,
        vestAmountPerPeriod,
        vestingPeriods,
        vestingPeriodSec,
        vestingStartTime,
        vestingCliffStartTime,
      ] = await vestingInstance.vestingScheme()
      assertEqualBN(vestingStartTime, vestingDefaultSchedule.vestingStartTime)
    })

    it('should set vesting cliff to vesting instance', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const [
        vestingAmount,
        vestAmountPerPeriod,
        vestingPeriods,
        vestingPeriodSec,
        vestingStartTime,
        vestingCliffStartTime,
      ] = await vestingInstance.vestingScheme()
      const vestingCliffStartTimeComputed = new BigNumber(
        vestingDefaultSchedule.vestingStartTime
      ).plus(vestingDefaultSchedule.vestingCliff)
      assertEqualBN(vestingCliffStartTime, vestingCliffStartTimeComputed)
    })

    it('should set revokable flag to vesting instance', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const vestingRevocable = await vestingInstance.revocable()
      assert.equal(vestingRevocable, vestingDefaultSchedule.vestingRevokable)
    })

    it('should set revoker to vesting instance', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const vestingRevoker = await vestingInstance.revoker()
      assert.equal(vestingRevoker, vestingDefaultSchedule.vestingRevoker)
    })

    it('should set refund destination to vesting instance', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const vestingRefundDestination = await vestingInstance.refundDestination()
      assert.equal(vestingRefundDestination, vestingDefaultSchedule.vestingRefundDestination)
    })

    it('should have zero currently withdrawn on init', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const currentlyWithdrawn = await vestingInstance.currentlyWithdrawn()
      assertEqualBN(currentlyWithdrawn, 0)
    })

    it('should be unrevoked on init', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const isRevoked = await vestingInstance.revoked()
      assert.equal(isRevoked, false)
    })

    it('should be unpaused on init', async () => {
      await createNewVestingInstanceTx()
      const vestingInstanceRegistryAddress = await vestingFactoryInstance.hasVestedAt(beneficiary)
      const vestingInstance = await VestingInstance.at(vestingInstanceRegistryAddress)
      const isPaused = await vestingInstance.paused()
      assert.equal(isPaused, false)
    })

    it('should revert when vesting amount is zero', async () => {
      vestingDefaultSchedule.vestingAmount = new BigNumber('0')
      await assertRevert(createNewVestingInstanceTx())
    })

    it('should revert when vesting beneficiary is the genesis address', async () => {
      vestingDefaultSchedule.vestingBeneficiary = NULL_ADDRESS
      await assertRevert(createNewVestingInstanceTx())
    })

    it('should revert when refund destination is the genesis address', async () => {
      vestingDefaultSchedule.vestingRefundDestination = NULL_ADDRESS
      await assertRevert(createNewVestingInstanceTx())
    })

    it('should revert when vesting period per sec is zero', async () => {
      vestingDefaultSchedule.vestingPeriodSec = 0
      await assertRevert(createNewVestingInstanceTx())
    })

    it('should revert when vesting cliff is longer than vesting period per sec', async () => {
      vestingDefaultSchedule.vestingCliff = 4 * MONTH
      await assertRevert(createNewVestingInstanceTx())
    })

    it('should revert when vesting amount per period is greater than total vesting amout', async () => {
      vestingDefaultSchedule.vestAmountPerPeriod = ONE_GOLDTOKEN.times(2)
      await assertRevert(createNewVestingInstanceTx())
    })

    it('should revert when vesting cliff start point lies in the past', async () => {
      vestingDefaultSchedule.vestingStartTime = Math.round(Date.now() / 1000) - 2 * HOUR
      await assertRevert(createNewVestingInstanceTx())
    })
  })
})
