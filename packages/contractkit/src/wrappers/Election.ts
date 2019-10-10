import { eqAddress } from '@celo/utils/lib/address'
import { zip } from '@celo/utils/lib/collections'
import BigNumber from 'bignumber.js'
import { Address, NULL_ADDRESS } from '../base'
import { Election } from '../generated/types/Election'
import {
  BaseWrapper,
  CeloTransactionObject,
  identity,
  proxyCall,
  proxySend,
  toBigNumber,
  toNumber,
  tupleParser,
  wrapSend,
} from './BaseWrapper'

export interface Validator {
  address: Address
  name: string
  url: string
  publicKey: string
  affiliation: Address | null
}

export interface ValidatorGroup {
  address: Address
  name: string
  url: string
  members: Address[]
}

export interface ValidatorGroupVote {
  address: Address
  votes: BigNumber
  eligible: boolean
}

export interface ElectableValidators {
  min: BigNumber
  max: BigNumber
}

export interface ElectionConfig {
  electableValidators: ElectableValidators
  electabilityThreshold: BigNumber
  maxNumGroupsVotedFor: BigNumber
}

/**
 * Contract for voting for validators and managing validator groups.
 */
export class ElectionWrapper extends BaseWrapper<Election> {
  activate = proxySend(this.kit, this.contract.methods.activate)
  /**
   * Returns the minimum and maximum number of validators that can be elected.
   * @returns The minimum and maximum number of validators that can be elected.
   */
  async electableValidators(): Promise<ElectableValidators> {
    const { min, max } = await this.contract.methods.electableValidators().call()
    return { min: toBigNumber(min), max: toBigNumber(max) }
  }
  /**
   * Returns the current election threshold.
   * @returns Election threshold.
   */
  electabilityThreshold = proxyCall(
    this.contract.methods.getElectabilityThreshold,
    undefined,
    toBigNumber
  )
  validatorAddressFromCurrentSet: (index: number) => Promise<Address> = proxyCall(
    this.contract.methods.validatorAddressFromCurrentSet,
    tupleParser<number, number>(identity)
  )

  numberValidatorsInCurrentSet = proxyCall(
    this.contract.methods.numberValidatorsInCurrentSet,
    undefined,
    toNumber
  )

  getGroupsVotedForByAccount: (account: Address) => Promise<Address[]> = proxyCall(
    this.contract.methods.getGroupsVotedForByAccount
  )

  /**
   * Returns current configuration parameters.
   */
  async getConfig(): Promise<ElectionConfig> {
    const res = await Promise.all([
      this.electableValidators(),
      this.electabilityThreshold(),
      this.contract.methods.maxNumGroupsVotedFor().call(),
    ])
    return {
      electableValidators: res[0],
      electabilityThreshold: res[1],
      maxNumGroupsVotedFor: toBigNumber(res[2]),
    }
  }

  async getValidatorSetAddresses(): Promise<string[]> {
    const numberValidators = await this.numberValidatorsInCurrentSet()

    const validatorAddressPromises = []

    for (let i = 0; i < numberValidators; i++) {
      validatorAddressPromises.push(this.validatorAddressFromCurrentSet(i))
    }

    return Promise.all(validatorAddressPromises)
  }

  async getValidatorGroupsVotes(): Promise<ValidatorGroupVote[]> {
    const validators = await this.kit.contracts.getValidators()
    const validatorGroupAddresses = (await validators.getRegisteredValidatorGroups()).map(
      (g) => g.address
    )
    const validatorGroupVotes = await Promise.all(
      validatorGroupAddresses.map((g) => this.contract.methods.getTotalVotesForGroup(g).call())
    )
    const validatorGroupEligible = await Promise.all(
      validatorGroupAddresses.map((g) => this.contract.methods.getGroupEligibility(g).call())
    )
    return validatorGroupAddresses.map((a, i) => ({
      address: a,
      votes: toBigNumber(validatorGroupVotes[i]),
      eligible: validatorGroupEligible[i],
    }))
  }

  async getEligibleValidatorGroupsVotes(): Promise<ValidatorGroupVote[]> {
    const res = await this.contract.methods.getTotalVotesForEligibleValidatorGroups().call()
    return zip((a, b) => ({ address: a, votes: new BigNumber(b), eligible: true }), res[0], res[1])
  }

  async vote(validatorGroup: Address, value: BigNumber): Promise<CeloTransactionObject<boolean>> {
    if (this.kit.defaultAccount == null) {
      throw new Error(`missing from at new ValdidatorUtils()`)
    }

    const { lesser, greater } = await this.findLesserAndGreaterAfterVote(validatorGroup, value)

    return wrapSend(
      this.kit,
      this.contract.methods.vote(validatorGroup, value.toString(), lesser, greater)
    )
  }

  async findLesserAndGreaterAfterVote(
    votedGroup: Address,
    voteWeight: BigNumber
  ): Promise<{ lesser: Address; greater: Address }> {
    const currentVotes = await this.getEligibleValidatorGroupsVotes()

    const selectedGroup = currentVotes.find((votes) => eqAddress(votes.address, votedGroup))

    // modify the list
    if (selectedGroup) {
      selectedGroup.votes = selectedGroup.votes.plus(voteWeight)
    } else {
      currentVotes.push({
        address: votedGroup,
        votes: voteWeight,
        eligible: true,
      })
    }

    // re-sort
    currentVotes.sort((a, b) => a.votes.comparedTo(b.votes))

    // find new index
    const newIdx = currentVotes.findIndex((votes) => eqAddress(votes.address, votedGroup))

    return {
      lesser: newIdx === 0 ? NULL_ADDRESS : currentVotes[newIdx - 1].address,
      greater: newIdx === currentVotes.length - 1 ? NULL_ADDRESS : currentVotes[newIdx + 1].address,
    }
  }
}
