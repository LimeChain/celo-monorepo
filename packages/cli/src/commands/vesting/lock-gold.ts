import { NULL_ADDRESS } from '@celo/contractkit'
import { Address } from '@celo/utils/lib/address'
import { flags } from '@oclif/command'
import BigNumber from 'bignumber.js'
import { BaseCommand } from '../../base'
import { newCheckBuilder } from '../../utils/checks'
import { displaySendTx } from '../../utils/cli'
import { Flags } from '../../utils/command'
import { LockedGoldArgs } from '../../utils/lockedgold'

export default class LockGold extends BaseCommand {
  static description = 'Locks Celo Gold to be used in governance and validator elections.'

  static flags = {
    ...BaseCommand.flags,
    from: Flags.address({ required: true, description: 'Beneficiary of the vesting ' }),
    value: flags.string({ ...LockedGoldArgs.valueArg, required: true }),
  }

  static args = []

  static examples = [
    'lock-gold --from 0x47e172F6CfB6c7D01C1574fa3E2Be7CC73269D95 --value 10000000000000000000000',
  ]

  async run() {
    const res = this.parse(LockGold)
    const address: Address = res.flags.from

    this.kit.defaultAccount = address
    const value = new BigNumber(res.flags.value)

    const vestingFactory = await this.kit.contracts.getVestingFactory()
    const vestingFactoryInstance = await vestingFactory.getVestedAt(res.flags.from)
    if (vestingFactoryInstance.address === NULL_ADDRESS) {
      console.error(`No vested instance found under the given beneficiary`)
      return
    }
    if ((await vestingFactoryInstance.getRevoker()) !== res.flags.from) {
      console.error(`Vested instance has a different revoker`)
      return
    }

    await newCheckBuilder(this)
      .addCheck(`Value [${value.toFixed()}] is not > 0`, () => value.gt(0))
      .isAccount(address)
      .runChecks()

    await newCheckBuilder(this)
      .isAccount(vestingFactoryInstance.address)
      .runChecks()

    const lockedGold = await this.kit.contracts.getLockedGold()
    const pendingWithdrawalsValue = await lockedGold.getPendingWithdrawalsTotalValue(
      vestingFactoryInstance.address
    )
    const relockValue = BigNumber.minimum(pendingWithdrawalsValue, value)
    const lockValue = value.minus(relockValue)

    await newCheckBuilder(this)
      .hasEnoughGold(vestingFactoryInstance.address, lockValue)
      .runChecks()

    const txos = await lockedGold.relock(address, relockValue)
    for (const txo of txos) {
      await displaySendTx('relock', txo, { from: vestingFactoryInstance.address })
    }
    const tx = lockedGold.lock()
    await displaySendTx('lock', tx, { value: lockValue.toFixed() })
  }
}
