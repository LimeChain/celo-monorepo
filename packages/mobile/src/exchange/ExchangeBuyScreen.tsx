import Button, { BtnTypes } from '@celo/react-components/components/Button'
import KeyboardAwareScrollView from '@celo/react-components/components/KeyboardAwareScrollView'
import KeyboardSpacer from '@celo/react-components/components/KeyboardSpacer'
import colors from '@celo/react-components/styles/colors'
import { fontStyles } from '@celo/react-components/styles/fonts'
import { componentStyles } from '@celo/react-components/styles/styles'
import { parseInputAmount } from '@celo/utils/src/parsing'
import BigNumber from 'bignumber.js'
import * as React from 'react'
import { withNamespaces, WithNamespaces } from 'react-i18next'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import SafeAreaView from 'react-native-safe-area-view'
import { NavigationInjectedProps } from 'react-navigation'
import { connect } from 'react-redux'
import { hideAlert, showError } from 'src/alert/actions'
import { errorSelector } from 'src/alert/reducer'
import componentWithAnalytics from 'src/analytics/wrapper'
import { ErrorMessages } from 'src/app/ErrorMessages'
import { DOLLAR_TRANSACTION_MIN_AMOUNT, GOLD_TRANSACTION_MIN_AMOUNT } from 'src/config'
import { fetchExchangeRate } from 'src/exchange/actions'
import { ExchangeRatePair } from 'src/exchange/reducer'
import { CURRENCIES, CURRENCY_ENUM } from 'src/geth/consts'
import i18n, { Namespaces } from 'src/i18n'
import { headerWithCancelButton } from 'src/navigator/Headers'
import { navigate, navigateBack } from 'src/navigator/NavigationService'
import { Screens } from 'src/navigator/Screens'
import { RootState } from 'src/redux/reducers'
import DisconnectBanner from 'src/shared/DisconnectBanner'
import { getRateForMakerToken, getTakerAmount } from 'src/utils/currencyExchange'
import { getMoneyDisplayValue } from 'src/utils/formatting'

interface State {
  makerToken: CURRENCY_ENUM
  makerTokenAvailableBalance: string
  goldAmount: string
  dollarAmount: string
}

interface StateProps {
  exchangeRatePair: ExchangeRatePair | null
  error: ErrorMessages | null
}

interface DispatchProps {
  fetchExchangeRate: typeof fetchExchangeRate
  showError: typeof showError
  hideAlert: typeof hideAlert
}

type Props = StateProps & DispatchProps & NavigationInjectedProps & WithNamespaces

const mapStateToProps = (state: RootState): StateProps => ({
  exchangeRatePair: state.exchange.exchangeRatePair,
  error: errorSelector(state),
})

export class ExchangeBuyScreen extends React.Component<Props, State> {
  static navigationOptions = () => ({
    ...headerWithCancelButton,
    headerStyle: {
      marginTop: 20,
      height: 24,
      elevation: 0, // remove shadow on Android
      shadowOpacity: 0, // remove shadow on iOS
    },
    headerTitle: (
      <View style={{ flex: 1, alignSelf: 'center', alignItems: 'center' }}>
        <Text style={fontStyles.headerBoldTitle}>
          {i18n.t(`${Namespaces.exchangeFlow9}:buyGold`)}
        </Text>
      </View>
    ),
  })

  state: State = {
    makerToken: CURRENCY_ENUM.DOLLAR,
    makerTokenAvailableBalance: '',
    goldAmount: '',
    dollarAmount: '',
  }

  getMakerTokenPropertiesFromNavProps(): {
    makerToken: CURRENCY_ENUM
    makerTokenAvailableBalance: string
  } {
    const makerToken = this.props.navigation.getParam('makerToken')
    const makerTokenAvailableBalance = this.props.navigation.getParam('makerTokenBalance')
    if (!makerToken || !makerTokenAvailableBalance) {
      throw new Error('Maker token or maker token balance missing from nav props')
    }
    return { makerToken, makerTokenAvailableBalance }
  }

  componentDidMount() {
    this.props.fetchExchangeRate()
    const { makerToken, makerTokenAvailableBalance } = this.getMakerTokenPropertiesFromNavProps()
    this.setState({
      makerToken,
      makerTokenAvailableBalance,
    })
  }

  onChangeExchangeAmount = (amount: string) => {
    this.setState({ goldAmount: amount })
  }

  updateError(amount: string) {
    if (new BigNumber(amount).isGreaterThan(this.state.makerTokenAvailableBalance)) {
      this.props.showError(
        this.isDollarToGold() ? ErrorMessages.NSF_DOLLARS : ErrorMessages.NSF_GOLD
      )
    } else {
      this.props.hideAlert()
    }
  }

  goBack = () => {
    this.props.hideAlert()
    navigateBack()
  }

  getDollarAmount = () => {
    const exchangeRate = getRateForMakerToken(this.props.exchangeRatePair, CURRENCY_ENUM.GOLD)
    const dollarAmount = getTakerAmount(parseInputAmount(this.state.goldAmount), exchangeRate)
    return dollarAmount.toString()
  }

  goToReview = () => {
    const { makerToken, goldAmount } = this.state
    const makerAmount = this.isDollarToGold() ? this.getDollarAmount() : goldAmount
    navigate(Screens.ExchangeReview, {
      confirmationInput: { makerToken, makerAmount: parseInputAmount(makerAmount) },
    })
  }

  hasError = () => {
    return !!this.props.error
  }

  isExchangeInvalid = () => {
    const amount = parseInputAmount(this.state.goldAmount)
    const amountIsInvalid =
      amount.isGreaterThan(this.state.makerTokenAvailableBalance) ||
      amount.isLessThan(
        this.isDollarToGold() ? DOLLAR_TRANSACTION_MIN_AMOUNT : GOLD_TRANSACTION_MIN_AMOUNT
      )
    const exchangeRate = getRateForMakerToken(this.props.exchangeRatePair, this.state.makerToken)
    const exchangeRateIsInvalid = exchangeRate.isLessThanOrEqualTo(0)
    const takerToken = this.isDollarToGold() ? CURRENCY_ENUM.GOLD : CURRENCY_ENUM.DOLLAR
    const takerAmountIsInvalid = getTakerAmount(
      amount,
      exchangeRate,
      CURRENCIES[takerToken].displayDecimals
    ).isLessThanOrEqualTo(0)

    return amountIsInvalid || exchangeRateIsInvalid || takerAmountIsInvalid || this.hasError()
  }

  isDollarToGold = () => {
    return this.state.makerToken === CURRENCY_ENUM.DOLLAR
  }

  getInputValue = () => {
    if (this.state.goldAmount) {
      return this.state.goldAmount
    } else {
      return ''
    }
  }

  render() {
    const { makerToken, goldAmount } = this.state
    const { t, exchangeRatePair } = this.props

    const makerSymbol = CURRENCIES[makerToken].symbol
    const exchangeRateDisplay = getRateForMakerToken(exchangeRatePair, CURRENCY_ENUM.DOLLAR) // Always show rate in dollars

    const exchangeRate = getRateForMakerToken(exchangeRatePair, CURRENCY_ENUM.GOLD)
    const subtotal = getTakerAmount(parseInputAmount(goldAmount), exchangeRate)

    return (
      <SafeAreaView
        // Force inset as this screen uses auto focus and KeyboardSpacer padding is initially
        // incorrect because of that
        forceInset={{ top: 'never', bottom: 'always' }}
        style={styles.container}
      >
        <DisconnectBanner />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={fontStyles.subSmall}>
            {makerSymbol + this.state.makerTokenAvailableBalance + ' ' + t('lowerCaseAvailable')}
          </Text>
        </View>
        <KeyboardAwareScrollView keyboardShouldPersistTaps={'always'}>
          <View style={{ flexDirection: 'column', padding: 16, justifyContent: 'flex-start' }}>
            {/* Row 1 */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[fontStyles.body]}>{CURRENCY_ENUM.GOLD}</Text>
              <TextInput
                autoFocus={true}
                keyboardType={'decimal-pad'}
                onChangeText={this.onChangeExchangeAmount}
                value={this.getInputValue()}
                placeholderTextColor={'#BDBDBD'}
                placeholder={'0'}
              />
            </View>
            <View style={styles.line} />
            {/* Row 2*/}
            <View style={{ flexDirection: 'row', flex: 1, justifyContent: 'space-between' }}>
              <Text style={fontStyles.body}>{`Subtotal (@ $${exchangeRateDisplay})`}</Text>
              <Text style={fontStyles.regular}>
                {getMoneyDisplayValue(subtotal, CURRENCY_ENUM.DOLLAR, true)}
              </Text>
            </View>
          </View>
        </KeyboardAwareScrollView>
        <View style={componentStyles.bottomContainer}>
          <Button
            onPress={this.goToReview}
            text={t('continue')}
            accessibilityLabel={t('continue')}
            standard={false}
            disabled={this.isExchangeInvalid()}
            type={BtnTypes.PRIMARY}
          />
        </View>
        <KeyboardSpacer />
      </SafeAreaView>
    )
  }
}

export default componentWithAnalytics(
  connect<StateProps, DispatchProps, {}, RootState>(
    mapStateToProps,
    {
      fetchExchangeRate,
      showError,
      hideAlert,
    }
  )(withNamespaces(Namespaces.exchangeFlow9)(ExchangeBuyScreen))
)

const styles = StyleSheet.create({
  line: {
    borderBottomColor: colors.darkLightest,
    borderBottomWidth: 1,
    margin: 10,
  },

  container: {
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'space-between',
  },
  transferArea: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 20,
    marginBottom: 15,
  },
  transferInfo: {
    justifyContent: 'space-between',
    alignItems: 'center',
    flex: 1,
    flexDirection: 'column',
  },
  transferMeta: {
    alignItems: 'center',
  },
  currencyLabel: {
    color: colors.darkSecondary,
  },
  exchangeButtonBackground: {
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 15,
    marginVertical: 15 + 18,
  },
  amountText: {
    fontSize: 22,
  },
  ioBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    width: '100%',
    marginHorizontal: 15,
    marginVertical: 10,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 22,
  },
  inputBox: {
    borderWidth: 1,
    borderRadius: 3,
    paddingTop: 15,
    paddingBottom: 10,
    height: 54, // setting height manually b.c. of bug causing text to jump
  },
  outputText: {
    paddingTop: 2,
    flexDirection: 'row',
    alignItems: 'flex-start',
    height: 22,
  },
  superscript: {
    fontSize: 12,
    lineHeight: 16,
  },
  green: { color: colors.celoGreen },
  gold: { color: colors.celoGold },
})