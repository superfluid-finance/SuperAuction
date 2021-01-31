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

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "@superfluid-finance/ethereum-contracts/contracts/utils/Int96SafeMath.sol";

contract SuperAuction is Ownable, SuperAppBase {

    using Int96SafeMath for int96;
    using SafeMath for uint256;
    using SignedSafeMath for int256;

    struct Bidder {
        uint256 cumulativeTimer;
        uint256 lastSettleAmount;
        address nextAccount;
    }

    struct ViewBidder {
        address account;
        uint256 timeToWin;
        int96 flowRate;
        uint256 balance;
    }

    uint256 public immutable streamTime;
    address public winner;
    int96 public winnerFlowRate;
    address public _tail;

    bool public isFinish;
    mapping(address => Bidder) public bidders;

    ISuperfluid private _host;
    IConstantFlowAgreementV1 public _cfa;
    ISuperToken public _superToken;

    constructor(
        ISuperfluid host,
        IConstantFlowAgreementV1 cfa,
        ISuperToken superToken,
        uint256 winnerTime
    ) {
        require(address(host) != address(0), "Auction: host is empty");
        require(address(cfa) != address(0), "Auction: cfa is empty");
        require(address(superToken) != address(0), "Auction: superToken is empty");
        require(winnerTime > 0, "Auction: Provide a winner stream time");

        _host = host;
        _cfa = cfa;
        _superToken = superToken;
        streamTime = winnerTime;

        uint256 configWord =
            SuperAppDefinitions.APP_LEVEL_FINAL |
            SuperAppDefinitions.BEFORE_AGREEMENT_CREATED_NOOP;

        _host.registerApp(configWord);
    }

    function finishAuction() public {
        if(winner != address(0)) {
            (uint256 timestamp, ) = _getFlowInfo(winner);
            _endAuction(timestamp);
        }
    }

    function _endAuction(uint256 timestamp) internal {
        if(!isFinish) {
            if(bidders[winner].cumulativeTimer.add(block.timestamp.sub(timestamp)) >= streamTime) {
                isFinish = true;
                //emit event
           }
        }
    }

     //A new Player is always going to top as winner
    function _newPlayer(
        address account,
        int96 flowRate,
        bytes memory ctx
    )
    internal
    isRunning
    returns(bytes memory newCtx)
    {
        require(flowRate > winnerFlowRate, "Auction: FlowRate is not enough");
        newCtx = ctx;
        if(bidders[account].cumulativeTimer == 0) {
            bidders[account].cumulativeTimer = 1;
        }
        bidders[account].nextAccount = (winner == address(0) ? _tail : winner);
        if(winner != address(0)) {
            _settleAccount(winner, 0, 0);
            newCtx = _startStream(winner, winnerFlowRate, ctx);
        }
        if(_tail == address(0)) {
            _tail = account;
        }
        winner = account;
        winnerFlowRate = flowRate;
        //emit event
    }


    //TODO: refactor
    function _dropPlayer(address account, uint256 oldTimestamp, int96 oldFlowRate, bytes memory ctx) internal returns(bytes memory newCtx) {
        newCtx = ctx;
        _endAuction(oldTimestamp);
        if(!isFinish) {
            if(account == winner) {
                _settleAccount(account, oldTimestamp, oldFlowRate);
                //Only one bidder and is dropping
                if(bidders[winner].nextAccount == address(0)) {
                    delete winner;
                    delete winnerFlowRate;
                } else {
                    address _winner =  winner;
                    int96 flowRate;
                    do {
                        account = bidders[_winner].nextAccount;
                        if(account != address(0)) {
                            (, flowRate) = _getFlowInfo(account);
                            if(flowRate > 0) {
                                bidders[winner].nextAccount = address(0);
                                if(_tail != winner) {
                                    bidders[_tail].nextAccount = winner;
                                    _tail = winner;
                                }
                                winner  = account;
                                winnerFlowRate = flowRate;
                                return _endStream(address(this), winner, ctx);
                            }
                        }
                        _winner = account;

                    } while ( _winner != address(0) && flowRate > 0);


                    //there is no winner in query
                    delete winner;
                    delete winnerFlowRate;
                }
            } else {
                newCtx = _endStream(address(this), account, ctx);
            }
        //Withdraw phase
        } else {
            if(account != winner) {
                newCtx = _endStream(address(this), account, ctx);
                //_withdrawSettleBalance(account);
            } else {
                _settleAccount(account, oldTimestamp, oldFlowRate);
            }
        }
    }

    //Update Flow - Review
    function _updatePlayer(
        address account,
        int96 oldFlowRate,
        uint256 oldTimestamp,
        bytes memory ctx
    )
    internal
    isRunning
    returns(bytes memory newCtx)
    {
        (, int96 flowRate) = _getFlowInfo(account);
        require(flowRate > winnerFlowRate, "Auction: FlowRate is not enough");

        newCtx = ctx;
        address oldWinner = winner;
        (uint256  settleBalance, uint256 cumulativeTimer) = getSettleInfo(oldWinner, oldTimestamp, oldFlowRate);

        if(account != winner) {
            require(_host.decodeCtx(ctx).userData.length > 0, "Auction: No Previous Player information");
            address previousAccount = abi.decode(_host.decodeCtx(ctx).userData, (address));
            require(bidders[previousAccount].nextAccount == account, "Auction: Previous Bidder is wrong");
            bidders[previousAccount].nextAccount = bidders[account].nextAccount;
            if(oldFlowRate > 0) {
                newCtx = _endStream(address(this), account, ctx);
            }
            (, int96 _flowRate) = _getFlowInfo(oldWinner);
            newCtx = _startStream(oldWinner, _flowRate, newCtx);
            bidders[account].nextAccount = oldWinner;
            winner = account;
        }

        bidders[oldWinner].cumulativeTimer = bidders[oldWinner].cumulativeTimer.add(cumulativeTimer);
        bidders[oldWinner].lastSettleAmount = bidders[oldWinner].lastSettleAmount.add(settleBalance);
        winnerFlowRate = flowRate;
    }

    function _getFlowInfo(
        address sender
    )
    internal
    view
    returns (uint256 timestamp, int96 flowRate)
    {
        (timestamp, flowRate , ,) = _cfa.getFlow(_superToken, sender, address(this));
    }

    function getSettleInfo(
        address account,
        uint256 oldTimestamp,
        int96 oldFlowRate
    )
    public
    view
    returns(
        uint256 settleBalance,
        uint256 cumulativeTimer
    )
    {
        if(oldTimestamp > 0 && oldFlowRate > 0) {
            cumulativeTimer = (block.timestamp).sub(oldTimestamp);
            settleBalance = cumulativeTimer.mul(uint256(oldFlowRate));
        } else {
            (uint256 timestamp, int96 flowRate) = _getFlowInfo(account);
            cumulativeTimer = (block.timestamp).sub(timestamp);
            settleBalance = cumulativeTimer.mul(uint256(flowRate));
        }
    }

    function _settleAccount(
        address account,
        uint256 cbTimestamp,
        int96 cbFlowRate
    )
    internal
    {
          (uint256  settleBalance, uint256 cumulativeTimer) = getSettleInfo(account, cbTimestamp, cbFlowRate);
          bidders[account].cumulativeTimer = bidders[account].cumulativeTimer.add(cumulativeTimer);
          bidders[account].lastSettleAmount = bidders[account].lastSettleAmount.add(settleBalance);
    }



    /**************************************************************************
     * GateKeeper Functions
     *************************************************************************/




    /**************************************************************************
     * Constant Flow Agreements Functions
     *************************************************************************/
    function _startStream(address account, int96 flowRate, bytes memory ctx) internal returns(bytes memory newCtx) {
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

    function _updateStream(
        address account,
        int96 flowRate,
        bytes memory ctx
    )
    internal
    returns(bytes memory newCtx)
    {
        (newCtx, ) = _host.callAgreementWithContext(
            _cfa,
            abi.encodeWithSelector(
                _cfa.updateFlow.selector,
                _superToken,
                address(this),
                account,
                flowRate,
                new bytes(0)
            ),
            "0x",
            ctx
        );
    }

    function _endStream(address sender, address receiver, bytes memory ctx) internal returns(bytes memory newCtx) {
        newCtx = ctx;
        (, int96 flowRate , ,) = _cfa.getFlow(_superToken, sender, receiver);
        if(ctx.length > 0 && flowRate > 0) {
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
        } else if(flowRate > 0) {
            _host.callAgreement(
                _cfa,
                abi.encodeWithSelector(
                    _cfa.deleteFlow.selector,
                    _superToken,
                    sender,
                    receiver,
                    new bytes(0)
                ),
                "0x"
            );

        }
    }

    /**************************************************************************
     * SuperApp callbacks
     *************************************************************************/

    function afterAgreementCreated(
        ISuperToken /*superToken*/,
        address /*agreementClass*/,
        bytes32 /*agreementId*/,
        bytes calldata /*agreementData*/,
        bytes calldata /*cbdata*/,
        bytes calldata ctx
    )
    external
    override
    onlyHost
    isRunning
    returns (bytes memory newCtx)
    {
        address account = _host.decodeCtx(ctx).msgSender;
        if(bidders[account].cumulativeTimer > 0) {
            return _updatePlayer(account, 0, 0, ctx);
        } else {
            (, int96 flowRate) = _getFlowInfo(account);
            return _newPlayer(account, flowRate, ctx);
        }
    }

    function beforeAgreementUpdated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 /*agreementId*/,
        bytes calldata /*agreementData*/,
        bytes calldata ctx
    )
    external
    view
    override
    onlyHost
    onlyExpected(superToken, agreementClass)
    returns (bytes memory cbdata)
    {
        address account = _host.decodeCtx(ctx).msgSender;
        (uint256 timestamp, int96 flowRate) = _getFlowInfo(account);
        cbdata = abi.encode(timestamp, flowRate);
    }

    function afterAgreementUpdated(
        ISuperToken /*superToken*/,
        address /*agreementClass*/,
        bytes32 /*agreementId*/,
        bytes calldata /*agreementData*/,
        bytes calldata cbdata,
        bytes calldata ctx
    )
    external
    override
    onlyHost
    returns (bytes memory newCtx)
    {
        address account = _host.decodeCtx(ctx).msgSender;
        (uint256 oldTimestamp, int96 oldFlowRate) = abi.decode(cbdata, (uint256, int96));
        return _updatePlayer(account, oldFlowRate, oldTimestamp, ctx);
    }

    function beforeAgreementTerminated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 /*agreementId*/,
        bytes calldata /*agreementData*/,
        bytes calldata ctx
    )
        external
        view
        override
        onlyHost
        returns (bytes memory cbdata)
    {
        if(_isSameToken(superToken) && _isCFAv1(agreementClass)) {
            address account = _host.decodeCtx(ctx).msgSender;
            (uint256 timestamp, int96 flowRate) = _getFlowInfo(account);
            cbdata = abi.encode(timestamp, flowRate);
        }
    }

     function afterAgreementTerminated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 /*agreementId*/,
        bytes calldata /*agreementData*/,
        bytes calldata cbdata,
        bytes calldata ctx
    )
    external
    override
    onlyHost
    returns (bytes memory newCtx) {
        if(_isSameToken(superToken) && _isCFAv1(agreementClass)) {
            address account = _host.decodeCtx(ctx).msgSender;
            (uint256 timestamp, int96 flowRate) = abi.decode(cbdata, (uint256, int96));
            return _dropPlayer(account, timestamp, flowRate, ctx);
        }
        return ctx;
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