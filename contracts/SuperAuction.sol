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
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
/*import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";*/
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "@superfluid-finance/ethereum-contracts/contracts/utils/Int96SafeMath.sol";


contract SuperAuction is Ownable, SuperAppBase/*, IERC721Receiver */{

    using Int96SafeMath for int96;
    using SafeMath for uint256;
    using SignedSafeMath for int256;

    event NewWinner(address indexed account, int96 flowRate);
    event DropPlayer(address indexed account);
    event TransferNFT(address indexed to, uint256 indexed tokenId);
    event AuctionClosed();

    struct Bidder {
        uint256 cumulativeTimer;
        uint256 lastSettleAmount;
        address nextAccount;
    }

    uint256 public immutable streamTime;
    address public winner;
    int96 public winnerFlowRate;
    int96 public step;

    bool public isFinish;
    mapping(address => Bidder) public bidders;
    IERC721 public nftContract;
    uint256 public tokenId;
    ISuperfluid private _host;
    IConstantFlowAgreementV1 public _cfa;
    ISuperToken public _superToken;

    constructor(
        ISuperfluid host,
        IConstantFlowAgreementV1 cfa,
        ISuperToken superToken,
        IERC721 nft,
        uint256 _tokenId,
        uint256 winnerTime,
        int96 stepBid
    ) {
        require(address(host) != address(0), "Auction: host is empty");
        require(address(cfa) != address(0), "Auction: cfa is empty");
        require(address(superToken) != address(0), "Auction: superToken is empty");
        require(address(nft) != address(0), "Auction: NFT is empty");
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
            SuperAppDefinitions.BEFORE_AGREEMENT_CREATED_NOOP;

        _host.registerApp(configWord);
    }

    /*
    function onERC721Received(address, address, uint256, bytes memory) public override returns (bytes4) {
        return this.onERC721Received.selector;
    }
    */

    /**
     * @dev Set Auction to finish state. Has to exist one winner
     */
    function finishAuction() public {
        if(winner != address(0)) {
            (uint256 timestamp, ) = _getFlowInfo(winner);
            _endAuction(timestamp);
        }
    }

    /**
     * @dev Set Auction to finish state. Check winner time of flow to close auction
     */
    function _endAuction(uint256 timestamp) internal {
        if(!isFinish) {
            if(bidders[winner].cumulativeTimer.add(
                block.timestamp.sub(timestamp)
                ) >= streamTime) {
                isFinish = true;
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
    internal
    isRunning
    returns(bytes memory newCtx)
    {
        require(
            (flowRate.mul(100, "Int96SafeMath: multiplication error")) >=
            (winnerFlowRate.mul(step, "Int96SafeMath: multiplication error")),
            "Auction: FlowRate is not enough"
        );
        require(bidders[account].cumulativeTimer == 0, "Auction: Sorry no rejoins");
        newCtx = ctx;
        bidders[account].nextAccount = winner;
        if(winner != address(0)) {
            _settleAccount(winner, 0, 0);
            newCtx = _startStream(winner, winnerFlowRate, ctx);
        }
        winner = account;
        winnerFlowRate = flowRate;
        emit NewWinner(winner, flowRate);
    }

    /**
     * @dev Update player flowRate. Each call will try to close the auction.
     * @param account Address to update.
     * @param oldFlowRate Flow rate before the update.
     * @param oldTimestamp Timestamp before the update.
     * @param ctx Context from Superfluid callback.
     * @return newCtx NewCtx to Superfluid callback caller.
     */
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
        newCtx = ctx;
        (, int96 flowRate) = _getFlowInfo(account);
        require(
            (flowRate.mul(100, "Int96SafeMath: multiplication error"))
            >= (winnerFlowRate.mul(step,"Int96SafeMath: multiplication error")
            ), "Auction: FlowRate is not enough"
        );

        newCtx = ctx;
        address oldWinner = winner;

        if(account != winner) {
            address previousAccount = abi.decode(_host.decodeCtx(ctx).userData, (address));
            require(bidders[previousAccount].nextAccount == account, "Auction: Previous Bidder is wrong");
            bidders[previousAccount].nextAccount = bidders[account].nextAccount;
            (oldTimestamp, oldFlowRate) = _getFlowInfo(oldWinner);
            newCtx = _endStream(account, newCtx);
            newCtx = _startStream(oldWinner, oldFlowRate, newCtx);
            bidders[account].nextAccount = oldWinner;
            winner = account;
        }
        _settleAccount(oldWinner, oldTimestamp, oldFlowRate);
        winnerFlowRate = flowRate;
        finishAuction();
    }

    /**
     * @dev Drop player from auction. Each call will try to close the auction.
     * @param account Address to drop.
     * @param oldFlowRate Flow rate before the drop.
     * @param oldTimestamp Timestamp before the drop.
     * @param ctx Context from Superfluid callback.
     * @return newCtx NewCtx to Superfluid callback caller.
     */
    function _dropPlayer(
        address account,
        uint256 oldTimestamp,
        int96 oldFlowRate,
        bytes memory ctx
    )
    internal
    returns(bytes memory newCtx)
    {
        newCtx = ctx;
        _endAuction(oldTimestamp);
        if(!isFinish) {
            if(account == winner) {
                _settleAccount(account, oldTimestamp, oldFlowRate);
                if(bidders[winner].nextAccount != address(0)) {
                    address next = bidders[winner].nextAccount;
                    delete bidders[winner].nextAccount;
                    int96 flowRate;
                    while(next != address(0)) {
                        (, flowRate) = _getFlowInfo(next);
                        if(flowRate > 0) {
                            winnerFlowRate = flowRate;
                            winner = next;
                            emit NewWinner(winner, flowRate);
                            return _endStream(next, ctx);
                        }
                        next = bidders[next].nextAccount;
                    }
                }
                //Note: There is no winner in list.
                delete winner;
                delete winnerFlowRate;
            } else {
                newCtx = _endStream(account, ctx);
            }
            emit DropPlayer(account);
        } else {
            if(account != winner) {
                newCtx = _endStream(account, ctx);
                _withdrawNonWinnerPlayer(account);
            } else {
                _settleAccount(account, oldTimestamp, oldFlowRate);
                _withdrawWinner(account);
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
        address sender
    )
    internal
    view
    returns (uint256 timestamp, int96 flowRate)
    {
        (timestamp, flowRate , ,) = _cfa.getFlow(_superToken, sender, address(this));
    }

    /**
     * @dev Get the Settlement information for player.
     * @dev If no FlowRate and Timestamp query it using _getFlowInfo().
     * @param account Address to drop.
     * @param oldFlowRate Flow rate before the action.
     * @param oldTimestamp Timestamp before the action.
     * @return settleBalance of the player.
     * @return cumulativeTimer of the player.
     */
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

    /**
     * @dev Change player information based on parameters.
     * @param account Address to drop.
     * @param cbTimestamp Flow rate before the action.
     * @param cbFlowRate Timestamp before the action.
     */
    function _settleAccount(
        address account,
        uint256 cbTimestamp,
        int96 cbFlowRate
    )
    internal
    {
          (uint256 settleBalance, uint256 cumulativeTimer) = getSettleInfo(account, cbTimestamp, cbFlowRate);
          bidders[account].cumulativeTimer = bidders[account].cumulativeTimer.add(cumulativeTimer);
          bidders[account].lastSettleAmount = bidders[account].lastSettleAmount.add(settleBalance);
    }

    /**
     * @dev Non winners players collect the settlement tokens balance in the end.
     * @param account Address to send SuperTokens.
     */
    function _withdrawNonWinnerPlayer(address account) internal {
        uint256 settleBalance = bidders[account].lastSettleAmount;
        bidders[msg.sender].lastSettleAmount = 0;
        if(_superToken.balanceOf(address(this)) >= settleBalance) {
            _superToken.transferFrom(address(this), account, settleBalance);
        }
    }

    /**
     * @dev Winner collects the NFT tokens from auction.
     * @param account Address to send NFT.
     */
    function _withdrawWinner(address account) internal {
        //Transfer NFT Token
        //if(nftContract.ownerOf(tokenId) == address(this)) {
            //nftContract.safeTransferFrom(address(this), account, tokenId);
        //   emit TransferNFT(account, tokenId);
        //}
    }

    /**
     * @dev Owner collects winners bid payment.
     */
    function withdraw() external onlyOwner {
        require(isFinish, "Auction: Still running");
        (uint256 timestamp, int96 flowRate) = _getFlowInfo(winner);
        uint256 lastSettleAmount = bidders[winner].lastSettleAmount;
        delete bidders[winner].lastSettleAmount;
        uint256 balance = lastSettleAmount.add(
            uint256((int256(block.timestamp).sub(int256(timestamp))
            ).mul(flowRate)));
        assert(_superToken.transferFrom(address(this), owner(), balance));
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
    internal
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
        address receiver,
        bytes memory ctx
    )
    internal
    returns(bytes memory newCtx)
    {
        newCtx = ctx;
        (newCtx, ) = _host.callAgreementWithContext(
            _cfa,
            abi.encodeWithSelector(
                _cfa.deleteFlow.selector,
                _superToken,
                address(this),
                receiver,
                new bytes(0)
            ),
            "0x",
            ctx
        );
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
        (, int96 flowRate) = _getFlowInfo(account);
        return _newPlayer(account, flowRate, ctx);
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
    onlyExpected(superToken, agreementClass)
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
        newCtx = ctx;
        if(_isSameToken(superToken) && _isCFAv1(agreementClass)) {
            address account = _host.decodeCtx(ctx).msgSender;
            (uint256 timestamp, int96 flowRate) = abi.decode(cbdata, (uint256, int96));
            newCtx = _dropPlayer(account, timestamp, flowRate, ctx);
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
