// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;
import "../order/Order.sol";
import "../exchange/OrderHandler.sol";
import "../router/ExchangeRouter.sol";

contract ToggleAcceptContract {
    bool canAccept = true;

    constructor() {}

    receive() external payable {
        if (canAccept) return;
        assert(false);
    }

    function setCanAccept(bool _canAccept) external {
        canAccept = _canAccept;
    }
}
