pragma solidity ^0.8.0;
import "../order/Order.sol";
import "../exchange/OrderHandler.sol";
import "../router/ExchangeRouter.sol";

contract CancelAttackCallback {
    address owner;
    OrderHandler handler;
    ExchangeRouter router;

    constructor(OrderHandler _handler, ExchangeRouter _router) {
        owner = msg.sender;
        handler = _handler;
        router = _router;
    }

    // Cancel the order before it gets executed
    function beforeOrderExecution(bytes32 key, Order.Props memory order) external {
        router.cancelOrder(key);
    }

    receive() external payable {}
}
