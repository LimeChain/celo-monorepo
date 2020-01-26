import { NULL_ADDRESS } from '@celo/contractkit'
import { Address } from '@celo/utils/lib/address'
import { flags } from '@oclif/command'
import BigNumber from 'bignumber.js'
import { BaseCommand } from '../../base'
import { newCheckBuilder } from '../../utils/checks'
import { displaySendTx } from '../../utils/cli'
import { Flags } from '../../utils/command'
import { LockedGoldArgs } from '../../utils/lockedgold'

export default class Withdraw extends BaseCommand {
  static description = 'Withdraws gold from vesting instance as per vesting schedule.'

  static flags = {
    ...BaseCommand.flags,
    from: Flags.address({ required: true, description: 'Beneficiary of the vesting' }),
    value: flags.string({ ...LockedGoldArgs.valueArg, required: true }),
  }

  static args = []

  static examples = [
    'withdraw --from 0x47e172F6CfB6c7D01C1574fa3E2Be7CC73269D95 --value 10000000000000000000000',
  ]

  async run() {
    const res = this.parse(Withdraw)
    const address: Address = res.flags.from
    const value = new BigNumber(res.flags.value)

    this.kit.defaultAccount = address

    const vestingFactory = await this.kit.contracts.getVestingFactory()
    const vestingInstance = await vestingFactory.getVestedAt(res.flags.from)

    await newCheckBuilder(this)
      .addCheck(
        `No vested instance found under the given beneficiary ${res.flags.from}`,
        () => vestingInstance.address !== NULL_ADDRESS
      )
      .addCheck(
        `Vested instance has a different beneficiary`,
        async () => (await vestingInstance.getBeneficiary()) === res.flags.from
      )
      .runChecks()

    await displaySendTx('withdraw', vestingInstance.withdraw(value.toFixed()), {
      from: await vestingInstance.getBeneficiary(),
    })
  }
}