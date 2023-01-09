// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../exchange/DepositHandler.sol";
import "../exchange/WithdrawalHandler.sol";
import "../exchange/OrderHandler.sol";
import "../utils/PayableMulticall.sol";

import "./Router.sol";

/**
 * @title ExchangeRouter
 * @dev Router for exchange functions, supports functions which require
 * token transfers from the user
 *
 * IMPORTANT: PayableMulticall uses delegatecall, msg.value will be the same for each delegatecall
 * extra care should be taken when using msg.value in any of the functions in this contract
 *
 * To avoid front-running issues, most actions require two steps to execute:
 *
 * - User sends transaction with request details, e.g. deposit / withdraw liquidity,
 * swap, increase / decrease position
 * - Keepers listen for the transactions, include the prices for the request then
 * send a transaction to execute the request
 *
 * Prices are provided by an off-chain oracle system:
 *
 * - Oracle keepers continually check the latest blocks
 * - When there is a new block, oracle keepers fetch the latest prices from
 * reference exchanges
 * - Oracle keepers then sign the median price for each token together with
 * the block hash
 * - Oracle keepers then send the data and signature to archive nodes
 * - Archive nodes display this information for anyone to query
 *
 * Example:
 *
 * - Block 100 is finalized on the blockchain
 * - Oracle keepers observe this block
 * - Oracle keepers pull the latest prices from reference exchanges,
 * token A: price 20,000, token B: price 80,000
 * - Oracle keepers sign [chainId, blockhash(100), 20,000], [chainId, blockhash(100), 80,000]
 * - If in block 100, there was a market order to open a long position for token A,
 * the market order would have a block number of 100
 * - The prices signed at block 100 can be used to execute this order
 * - Order keepers would bundle the signature and price data for token A
 * then execute the order
 */
contract ExchangeRouter is ReentrancyGuard, PayableMulticall, FundReceiver {
    using SafeERC20 for IERC20;
    using Order for Order.Props;

    Router public immutable router;
    EventEmitter public immutable eventEmitter;
    DepositHandler public immutable depositHandler;
    WithdrawalHandler public immutable withdrawalHandler;
    OrderHandler public immutable orderHandler;
    DepositStore public immutable depositStore;
    WithdrawalStore public immutable withdrawalStore;
    OrderStore public immutable orderStore;
    IReferralStorage public immutable referralStorage;

    // @dev Constructor that initializes the contract with the provided Router, RoleStore, DataStore,
    // EventEmitter, DepositHandler, WithdrawalHandler, OrderHandler, DepositStore, WithdrawalStore,
    // OrderStore, and IReferralStorage instances
    constructor(
        Router _router,
        RoleStore _roleStore,
        DataStore _dataStore,
        EventEmitter _eventEmitter,
        DepositHandler _depositHandler,
        WithdrawalHandler _withdrawalHandler,
        OrderHandler _orderHandler,
        DepositStore _depositStore,
        WithdrawalStore _withdrawalStore,
        OrderStore _orderStore,
        IReferralStorage _referralStorage
    ) FundReceiver(_roleStore, _dataStore) {
        router = _router;
        eventEmitter = _eventEmitter;

        depositHandler = _depositHandler;
        withdrawalHandler = _withdrawalHandler;
        orderHandler = _orderHandler;

        depositStore = _depositStore;
        withdrawalStore = _withdrawalStore;
        orderStore = _orderStore;

        referralStorage = _referralStorage;
    }

    // @dev Fallback function that allows the contract to receive Ether
    receive() external payable {}

    // @dev Wraps the specified amount of native tokens into WNT then sends the WNT to the specified address
    function sendWnt(address receiver, uint256 amount) external payable nonReentrant {
        TokenUtils.depositAndSendWrappedNativeToken(dataStore, receiver, amount);
    }

    // @dev Sends the given amount of tokens to the given address
    function sendTokens(address token, address receiver, uint256 amount) external payable nonReentrant {
        address account = msg.sender;
        router.pluginTransfer(token, account, receiver, amount);
    }

    /**
     * @dev Creates a new deposit with the given long token, short token, long token amount, short token
     * amount, and deposit parameters. The deposit is created by transferring the specified amounts of
     * long and short tokens from the caller's account to the deposit store, and then calling the
     * `createDeposit()` function on the deposit handler contract.
     *
     * @param params The deposit parameters, as specified in the `DepositUtils.CreateDepositParams` struct
     * @return The unique ID of the newly created deposit
     */
    function createDeposit(
        DepositUtils.CreateDepositParams calldata params
    ) external payable nonReentrant returns (bytes32) {
        address account = msg.sender;

        return depositHandler.createDeposit(
            account,
            params
        );
    }

    /**
     * @dev Creates a new withdrawal with the given withdrawal parameters. The withdrawal is created by
     * calling the `createWithdrawal()` function on the withdrawal handler contract.
     *
     * @param params The withdrawal parameters, as specified in the `WithdrawalUtils.CreateWithdrawalParams` struct
     * @return The unique ID of the newly created withdrawal
     */
    function createWithdrawal(
        WithdrawalUtils.CreateWithdrawalParams calldata params
    ) external payable nonReentrant returns (bytes32) {
        address account = msg.sender;

        return withdrawalHandler.createWithdrawal(
            account,
            params
        );
    }

    /**
     * @dev Creates a new order with the given amount, order parameters, and referral code. The order is
     * created by transferring the specified amount of collateral tokens from the caller's account to the
     * order store, and then calling the `createOrder()` function on the order handler contract. The
     * referral code is also set on the caller's account using the referral storage contract.
     */
    function createOrder(
        OrderBaseUtils.CreateOrderParams calldata params,
        bytes32 referralCode
    ) external payable nonReentrant returns (bytes32) {
        require(params.orderType != Order.OrderType.Liquidation, "ExchangeRouter: invalid order type");

        address account = msg.sender;

        ReferralUtils.setTraderReferralCode(referralStorage, account, referralCode);

        return orderHandler.createOrder(
            account,
            params
        );
    }

    /**
     * @dev Updates the given order with the specified size delta, acceptable price, and trigger price.
     * The `updateOrder()` feature must be enabled for the given order type. The caller must be the owner
     * of the order, and the order must not be a market order. The size delta, trigger price, and
     * acceptable price are updated on the order, and the order is unfrozen. Any additional WNT that is
     * transferred to the contract is added to the order's execution fee. The updated order is then saved
     * in the order store, and an `OrderUpdated` event is emitted.
     *
     * @param key The unique ID of the order to be updated
     * @param sizeDeltaUsd The new size delta for the order
     * @param acceptablePrice The new acceptable price for the order
     * @param triggerPrice The new trigger price for the order
     */
    function updateOrder(
        bytes32 key,
        uint256 sizeDeltaUsd,
        uint256 acceptablePrice,
        uint256 triggerPrice
    ) external payable nonReentrant {
        OrderStore _orderStore = orderStore;
        Order.Props memory order = _orderStore.get(key);

        FeatureUtils.validateFeature(dataStore, Keys.updateOrderFeatureKey(address(this), uint256(order.orderType())));

        require(order.account() == msg.sender, "ExchangeRouter: forbidden");

        if (OrderBaseUtils.isMarketOrder(order.orderType())) {
            revert("ExchangeRouter: invalid orderType");
        }

        order.setSizeDeltaUsd(sizeDeltaUsd);
        order.setTriggerPrice(triggerPrice);
        order.setAcceptablePrice(acceptablePrice);
        order.setIsFrozen(false);

        // allow topping up of executionFee as partially filled or frozen orders
        // will have their executionFee reduced
        address wnt = TokenUtils.wnt(dataStore);
        uint256 receivedWnt = _orderStore.recordTransferIn(wnt);
        order.setExecutionFee(order.executionFee() + receivedWnt);

        uint256 estimatedGasLimit = GasUtils.estimateExecuteOrderGasLimit(dataStore, order);
        GasUtils.validateExecutionFee(dataStore, estimatedGasLimit, order.executionFee());

        order.touch();
        _orderStore.set(key, order);

        eventEmitter.emitOrderUpdated(key, sizeDeltaUsd, triggerPrice, acceptablePrice);
    }

    /**
     * @dev Cancels the given order. The `cancelOrder()` feature must be enabled for the given order
     * type. The caller must be the owner of the order, and the order must not be a market order. The
     * order is cancelled by calling the `cancelOrder()` function in the `OrderUtils` contract. This
     * function also records the starting gas amount and the reason for cancellation, which is passed to
     * the `cancelOrder()` function.
     *
     * @param key The unique ID of the order to be cancelled
     */
    function cancelOrder(bytes32 key) external payable nonReentrant {
        uint256 startingGas = gasleft();

        OrderStore _orderStore = orderStore;
        Order.Props memory order = _orderStore.get(key);

        FeatureUtils.validateFeature(dataStore, Keys.cancelOrderFeatureKey(address(this), uint256(order.orderType())));

        require(order.account() == msg.sender, "ExchangeRouter: forbidden");

        if (OrderBaseUtils.isMarketOrder(order.orderType())) {
            revert("ExchangeRouter: invalid orderType");
        }

        OrderUtils.cancelOrder(
            dataStore,
            eventEmitter,
            orderStore,
            key,
            msg.sender,
            startingGas,
            "USER_INITIATED_CANCEL"
        );
    }

    /**
     * @dev Claims funding fees for the given markets and tokens on behalf of the caller, and sends the
     * fees to the specified receiver. The length of the `markets` and `tokens` arrays must be the same.
     * For each market-token pair, the `claimFundingFees()` function in the `MarketUtils` contract is
     * called to claim the fees for the caller.
     *
     * @param markets An array of market addresses
     * @param tokens An array of token addresses, corresponding to the given markets
     * @param receiver The address to which the claimed fees should be sent
     */
    function claimFundingFees(address[] memory markets, address[] memory tokens, address receiver) external payable nonReentrant {
        if (markets.length != tokens.length) {
            revert("Invalid input");
        }

        address account = msg.sender;

        for (uint256 i = 0; i < markets.length; i++) {
            MarketUtils.claimFundingFees(
                dataStore,
                eventEmitter,
                markets[i],
                tokens[i],
                account,
                receiver
            );
        }
    }

    /**
     * @dev Claims affiliate rewards for the given markets and tokens on behalf of the caller, and sends
     * the rewards to the specified receiver. The length of the `markets` and `tokens` arrays must be
     * the same. For each market-token pair, the `claimAffiliateReward()` function in the `ReferralUtils`
     * contract is called to claim the rewards for the caller.
     *
     * @param markets An array of market addresses
     * @param tokens An array of token addresses, corresponding to the given markets
     * @param receiver The address to which the claimed rewards should be sent
     */
    function claimAffiliateRewards(address[] memory markets, address[] memory tokens, address receiver) external payable nonReentrant {
        if (markets.length != tokens.length) {
            revert("Invalid input");
        }

        address account = msg.sender;

        for (uint256 i = 0; i < markets.length; i++) {
            ReferralUtils.claimAffiliateReward(
                dataStore,
                eventEmitter,
                markets[i],
                tokens[i],
                account,
                receiver
            );
        }
    }
}
