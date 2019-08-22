/* tslint:disable:no-console */

import { CeloContractName } from '@celo/protocol/lib/registry-utils'
import {
  deploymentForCoreContract,
  getDeployedProxiedContract,
  transferOwnershipOfProxy,
  transferOwnershipOfProxyAndImplementation,
} from '@celo/protocol/lib/web3-utils'
import { config } from '@celo/protocol/migrationsConfig'
import { GovernanceInstance, ReserveInstance } from 'types'

const initializeArgs = async (networkName: string): Promise<any[]> => {
  const approver = require('@celo/protocol/truffle.js').networks[networkName].from

  return [
    config.registry.predeployedProxyAddress,
    approver,
    config.governance.concurrentProposals,
    web3.utils.toWei(config.governance.minDeposit.toString(), 'ether'),
    config.governance.queueExpiry,
    config.governance.dequeueFrequency,
    config.governance.approvalStageDuration,
    config.governance.referendumStageDuration,
    config.governance.executionStageDuration,
  ]
}

module.exports = deploymentForCoreContract<GovernanceInstance>(
  web3,
  artifacts,
  CeloContractName.Governance,
  initializeArgs,
  async (governance: GovernanceInstance) => {
    console.log('Setting Governance as a Reserve spender')
    const reserve: ReserveInstance = await getDeployedProxiedContract<ReserveInstance>(
      'Reserve',
      artifacts
    )
    await reserve.addSpender(governance.address)

    const proxyOwnedByGovernance = ['GoldToken', 'Random']
    await Promise.all(
      proxyOwnedByGovernance.map((contractName) =>
        transferOwnershipOfProxy(contractName, governance.address, artifacts)
      )
    )

    const proxyAndImplementationOwnedByGovernance = [
      'Attestations',
      'BondedDeposits',
      'Escrow',
      'Exchange',
      'GasCurrencyWhitelist',
      'GasPriceMinimum',
      'Governance',
      'Registry',
      'Reserve',
      'SortedOracles',
      'StableToken',
      'Validators',
    ]

    await Promise.all(
      proxyAndImplementationOwnedByGovernance.map((contractName) =>
        transferOwnershipOfProxyAndImplementation(contractName, governance.address, artifacts)
      )
    )
  }
)
