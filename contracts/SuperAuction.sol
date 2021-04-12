// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma experimental ABIEncoderV2;

import {
    ISuperfluid,
    ISuperToken,
    ISuperAgreement,
    SuperAppDefinitions
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {
    IConstantFlowAgreementV1
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";

import {
    SuperAppBase
} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";

import {
    ISuperAuction
} from "./interfaces/ISuperAuction.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "@superfluid-finance/ethereum-contracts/contracts/utils/Int96SafeMath.sol";

contract SuperAuction is Ownable, SuperAppBase, ISuperAuction {

    using Int96SafeMath for int96;
    using SafeMath for uint256;
    using SignedSafeMath for int256;

    struct Bidder {
        uint256 cumulativeTimer;
        uint256 lastSettleAmount;
        address nextAccount;
    }

    uint256 public immutable override streamTime;
    address public override winner;
    int96 public override winnerFlowRate;
    uint256 public override lastTick;
    int96 public override immutable step;

    bool public override isFinish;
    mapping(address => Bidder) public override bidders;
    address public immutable nftContract;
    uint256 public immutable tokenId;

    ISuperfluid private _host;
    IConstantFlowAgreementV1 public immutable override _cfa;
    ISuperToken public immutable override _superToken;

    constructor(
        ISuperfluid host,
        IConstantFlowAgreementV1 cfa,
        ISuperToken superToken,
        address nft,
        uint256 _tokenId,
        uint256 winnerTime,
        int96 stepBid,
        string memory registrationKey
    ) {
        require(address(host) != address(0), "Auction: host is empty");
        require(address(cfa) != address(0), "Auction: cfa is empty");
        require(address(superToken) != address(0), "Auction: superToken is empty");
        require(nft != address(0), "Auction: NFT contract is empty");
        require(winnerTime > 0, "Auction: Provide a winner stream time");
        require(stepBid > 0 && stepBid <=100, "Auction: Step value wrong" );

        _host = host;
        _cfa = cfa;
        nftContract = nft;
        tokenId = _tokenId;
        _superToken = superToken;
        streamTime = winnerTime;
        step = stepBid + 100;

        uint256 configWord =
            SuperAppDefinitions.APP_LEVEL_FINAL |
            SuperAppDefinitions.BEFORE_AGREEMENT_CREATED_NOOP |
            SuperAppDefinitions.BEFORE_AGREEMENT_UPDATED_NOOP |
            SuperAppDefinitions.BEFORE_AGREEMENT_TERMINATED_NOOP;

        if(bytes(registrationKey).length > 0) {
            _host.registerAppWithKey(configWord, registrationKey);
        } else {
            _host.registerApp(configWord);
        }
    }

    /**
     * @dev Set Auction to finish state. Has to exist one winner
     */
    function finishAuction() public {
        _endAuction();
    }

    /**
     * @dev Set Auction to finish state. Check winner time of flow to close auction
     */
    function _endAuction() private {
        if(!isFinish && winner != address(0)) {
            if(bidders[winner].cumulativeTimer.add(
                block.timestamp.sub(lastTick)
                ) >= streamTime) {
                isFinish = true;
                emit Winner(winner);
                emit AuctionClosed();
            }
        }
    }

    /**************************************************************************
     * CFA Reative Functions
     *************************************************************************/

     /**
     * @dev Add new player to Auction.
     * @param account Address joining the auction.
     * @param flowRate Flow rate in amount per second for this flow.
     * @param ctx Context from Superfluid callback.
     * @return newCtx NewCtx to Superfluid callback caller.
     */
    function _newPlayer(
        address account,
        int96 flowRate,
        bytes memory ctx
    )
    private
    isRunning
    returns(bytes memory newCtx)
    {
        require(
            (flowRate.mul(100, "Int96SafeMath: multiplication error")) >=
            (winnerFlowRate.mul(step, "Int96SafeMath: multiplication error")),
            "Auction: FlowRate is not enough"
        );
        require(bidders[account].cumulativeTimer == 0, "Auction: sorry no rejoins");
        newCtx = ctx;
        _endAuction();
        if(!isFinish) {
            bidders[account].nextAccount = winner;
            if(winner != address(0)) {
                _settleWinnerAccount();
                newCtx = _startStream(winner, winnerFlowRate, ctx);
            } else {
                lastTick = block.timestamp;
            }
            winner = account;
            winnerFlowRate = flowRate;
            emit NewHighestBid(winner, winnerFlowRate);
        } else {
            revert("Auction: Closed auction.");
        }
    }

    /**
     * @dev Update player flowRate. Each call will try to close the auction.
     * @param account Address to update.
     * @param ctx Context from Superfluid callback.
     * @return newCtx NewCtx to Superfluid callback caller.
     */
    function _updatePlayer(
        address account,
        bytes memory ctx
    )
    private
    isRunning
    returns(bytes memory newCtx)
    {
        newCtx = ctx;
        (, int96 flowRate) = _getFlowInfo(account, address(this));
        require(
            (flowRate.mul(100, "Int96SafeMath: multiplication error"))
            >= (winnerFlowRate.mul(step,"Int96SafeMath: multiplication error")
            ), "Auction: FlowRate is not enough"
        );
        _endAuction();
        if(!isFinish) {
            address oldWinner = winner;
            _settleWinnerAccount();
            if(account != winner) {
                address previousAccount = abi.decode(_host.decodeCtx(ctx).userData, (address));
                require(bidders[previousAccount].nextAccount == account, "Auction: Previous Bidder is wrong");
                bidders[previousAccount].nextAccount = bidders[account].nextAccount;
                newCtx = _endStream(address(this), account, newCtx);
                newCtx = _startStream(oldWinner, winnerFlowRate, newCtx);
                bidders[account].nextAccount = oldWinner;
                winner = account;
            }
            winnerFlowRate = flowRate;
            emit NewHighestBid(winner, winnerFlowRate);
        } else {
            revert("Auction: Closed auction.");
        }
    }

    /**
     * @dev Drop player from auction. Each call will try to close the auction.
     * @param account Address to drop.
     * @param ctx Context from Superfluid callback.
     * @return newCtx NewCtx to Superfluid callback caller.
     */
    function _dropPlayer(
        address account,
        bytes memory ctx
    )
    private
    returns(bytes memory newCtx)
    {
        newCtx = ctx;
        _endAuction();
        if(!isFinish) {
            emit DropPlayer(account);
            if(account == winner) {
                //if winner there is no reverse back stream, we just settle the current stream
                _settleWinnerAccount();
                //Find next winner
                if(bidders[winner].nextAccount != address(0)) {
                    address next = bidders[winner].nextAccount;
                    //Unlink present winner from queque
                    delete bidders[winner].nextAccount;

                    int96 flowRate;
                    while(next != address(0)) {
                        (, flowRate) = _getFlowInfo(next, address(this));
                        if(flowRate > 0) {
                            winnerFlowRate = flowRate;
                            winner = next;
                            emit NewHighestBid(winner, flowRate);
                            //Close reverse back stream to next winner
                            return _endStream(address(this), next, newCtx);
                        }
                        next = bidders[next].nextAccount;
                    }
                }
                //Note: There is no winner in list.
                delete winner;
                delete winnerFlowRate;
                delete lastTick;
            } else {
                    newCtx = _endStream(account, address(this), newCtx);
                    newCtx = _endStream(address(this), account,  newCtx);
            }
        } else {

            if(account != winner) {
                newCtx = _endStream(account, address(this), newCtx);
                newCtx = _endStream(address(this), account, newCtx);
                _withdrawNonWinnerPlayer(account);
            }

            //If there is a winner, settle balance close that stream
            if(winnerFlowRate > 0) {
                _settleWinnerAccount();
                newCtx = _endStream(winner, address(this), newCtx);
                delete winnerFlowRate;
            }
        }
    }

    /**
     * @dev Get the Flow Rate the player is sending to auction contract.
     * @param sender Address to query.
     * @return timestamp of the stream.
     * @return flowRate of the stream.
     */
    function _getFlowInfo(
        address sender,
        address receiver
    )
    private
    view
    returns (uint256 timestamp, int96 flowRate)
    {
        (timestamp, flowRate , ,) = _cfa.getFlow(_superToken, sender, receiver);
    }

    /**
     * @dev Get the Settlement information for player.
     * @param account Address to get information.
     * @return settleBalance of the player.
     * @return cumulativeTimer of the player.
     */
    function getSettledInfo(
        address account
    )
    public
    view
    override
    returns(
        uint256 settleBalance,
        uint256 cumulativeTimer
    )
    {
        if(account == winner) {
            cumulativeTimer = ((block.timestamp).sub(lastTick));
            settleBalance = cumulativeTimer.mul(uint256(winnerFlowRate));
        } else {
            cumulativeTimer = bidders[account].cumulativeTimer;
            settleBalance = bidders[account].lastSettleAmount;
        }
    }

    /**
     * @dev Change Winner settlement information.
     * @notice call the settlement before chaging the global winner / winnerFlowRate variables
     */
    function _settleWinnerAccount()
    private
    {
        (uint256 settleBalance, uint256 cumulativeTimer) = getSettledInfo(winner);
        bidders[winner].cumulativeTimer = bidders[winner].cumulativeTimer.add(cumulativeTimer);
        bidders[winner].lastSettleAmount = bidders[winner].lastSettleAmount.add(settleBalance);
        lastTick = block.timestamp;
    }

        /**
     * @dev Check if is possible to find a winner.
     * @dev If winning conditions are meet, any drop player will close the auction.
     * @notice Closing the auction will not close the winning flow to this contract.
     */
    function isWinningConditionMeet() public view override returns(bool) {
        if(winner != address(0)) {
            return bidders[winner].cumulativeTimer.add(
                block.timestamp.sub(lastTick)
                ) >= streamTime;
        }

        return false;
    }

    /**
     * @dev Non winners players collect the settlement tokens balance in the end.
     * @param account Address to send SuperTokens.
     */
    function _withdrawNonWinnerPlayer(address account) private {
        uint256 settleBalance = bidders[account].lastSettleAmount;
        bidders[account].lastSettleAmount = 0;
        if(_superToken.balanceOf(address(this)) >= settleBalance) {
            _superToken.transferFrom(address(this), account, settleBalance);
        }
    }

    /**
     * @dev Non winner players retrive balance.
     */
    function withdrawNonWinner() external {
        require(msg.sender != winner, "Auction: Caller is the winner");
        require(isFinish, "Auction: Still running");
        (, int96 flowRate) = _getFlowInfo(address(this), msg.sender);
        require(flowRate == 0, "Auction: Close your stream to auction");
        _withdrawNonWinnerPlayer(msg.sender);
    }

    /**
     * @dev Owner collects winners bid payment.
     */
    function withdraw() external onlyOwner {
        require(isFinish, "Auction: Still running");
        assert(_superToken.transferFrom(
            address(this),
            owner(),
            bidders[winner].lastSettleAmount)
        );
    }

    function withdrawAmount(uint256 amount) external onlyOwner {
        assert(_superToken.transferFrom(address(this), owner(), amount));
    }

    /**
     * @dev Owner can stop the auction if there is no winner.
     */
    function stopAuction() external onlyOwner isRunning {
        if(winner == address(0)) {
            isFinish = true;
        }
    }

    /**************************************************************************
     * Constant Flow Agreements Functions
     *************************************************************************/

    /**
     * @dev Helper function to start a stream from auction to user.
     * @param account Address to drop.
     * @param flowRate Flow rate to send.
     * @param ctx Context from Superfluid callback.
     * @return newCtx NewCtx to Superfluid callback caller.
     */
    function _startStream(
        address account,
        int96 flowRate,
        bytes memory ctx
    )
    private
    returns(bytes memory newCtx)
    {
        (newCtx, ) = _host.callAgreementWithContext(
            _cfa,
            abi.encodeWithSelector(
                _cfa.createFlow.selector,
                _superToken,
                account,
                flowRate,
                new bytes(0)
            ),
            "0x",
            ctx
        );
    }

    /**
     * @dev Helper function to stop a stream from auction to user.
     * @param receiver Address to stop sending the stream.
     * @param ctx Context from Superfluid callback.
     * @return newCtx NewCtx to Superfluid callback caller.
     */
    function _endStream(
        address sender,
        address receiver,
        bytes memory ctx
    )
    private
    returns(bytes memory newCtx)
    {
        newCtx = ctx;
        (, int96 flowRate) = _getFlowInfo(sender, receiver);
        if(flowRate > int96(0)) {
            (newCtx, ) = _host.callAgreementWithContext(
                _cfa,
                abi.encodeWithSelector(
                    _cfa.deleteFlow.selector,
                    _superToken,
                    sender,
                    receiver,
                    new bytes(0)
                ),
                "0x",
                ctx
            );
        }
    }

    /**************************************************************************
     * SuperApp callbacks
     * https://github.com/superfluid-finance/protocol-monorepo/tree/master/packages/ethereum-contracts
     *************************************************************************/

    function afterAgreementCreated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 /*agreementId*/,
        bytes calldata /*agreementData*/,
        bytes calldata /*cbdata*/,
        bytes calldata ctx
    )
    external
    override
    onlyHost
    onlyExpected(superToken, agreementClass)
    isRunning
    returns (bytes memory newCtx)
    {
        address account = _host.decodeCtx(ctx).msgSender;
        (, int96 flowRate) = _getFlowInfo(account, address(this));
        return _newPlayer(account, flowRate, ctx);
    }

    function afterAgreementUpdated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 /*agreementId*/,
        bytes calldata /*agreementData*/,
        bytes calldata /*cbdata*/,
        bytes calldata ctx
    )
    external
    override
    onlyHost
    onlyExpected(superToken, agreementClass)
    returns (bytes memory newCtx)
    {
        return _updatePlayer(
            _host.decodeCtx(ctx).msgSender,
            ctx
        );
    }

    function afterAgreementTerminated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 /*agreementId*/,
        bytes calldata agreementData,
        bytes calldata /*cbdata*/,
        bytes calldata ctx
    )
    external
    override
    onlyHost
    returns (bytes memory newCtx) {
        newCtx = ctx;
        if(_isSameToken(superToken) && _isCFAv1(agreementClass)) {
            (address sender, address receiver) = abi.decode(agreementData, (address, address));
            newCtx = _dropPlayer(sender == address(this) ? receiver : sender, ctx);
        }
    }

    function _isSameToken(ISuperToken superToken) private view returns (bool) {
        return address(superToken) == address(_superToken);
    }

    function _isCFAv1(address agreementClass) private view returns (bool) {
        return ISuperAgreement(agreementClass).agreementType()
        == keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");
    }

    /*Modifier*/
    modifier isRunning() {
        require(!isFinish, "Auction: Not running");
        _;
    }

    modifier onlyHost() {
        require(msg.sender == address(_host), "Auction: support only one host");
        _;
    }

    modifier onlyExpected(ISuperToken superToken, address agreementClass) {
        require(_isSameToken(superToken), "Auction: not accepted token");
        require(_isCFAv1(agreementClass), "Auction: only CFAv1 supported");
        _;
    }
}
