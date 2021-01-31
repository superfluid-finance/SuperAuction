// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma experimental ABIEncoderV2;


import {
    ISuperToken
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {
    IConstantFlowAgreementV1
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";

import {ISuperAuction} from "./interfaces/ISuperAuction.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";



contract SuperAuctionViewer {

    using SafeMath for uint256;
    using SignedSafeMath for int256;

    function getBiddersAddresses(
        address auctionAddress,
        uint256 listFrom,
        uint256 listTo
    )
    public
    view
    returns(ISuperAuction.ViewBidder[100] memory top)
    {

        ISuperAuction auction = ISuperAuction(auctionAddress);
        address winner = auction.winner();

        winner = winner;
        if(winner == address(0)) {
            return top;
        }

        //Winner if always on top
        top[0] = _getViewBidder(auctionAddress, winner);
        address _bidder = winner;
        uint256 j;
        for(uint256 i = 0; i < 100; i++) {
            if(i > listFrom && i < listTo) {
                j++;
                (, , _bidder) = auction.bidders(_bidder);
                if(_bidder == address(0)) {
                    return top;
                }
                top[j] = _getViewBidder(auctionAddress, _bidder);
            }
        }
    }

    function _getViewBidder(address auctionAddress, address account) private view returns(ISuperAuction.ViewBidder memory) {
        ISuperAuction auction = ISuperAuction(auctionAddress);
        (uint256 timestamp, int96 _flowRate) = _getFlowInfo(
            auction._cfa(),
            auction._superToken(),
            account,
            auctionAddress);
        uint256 timeToWin;
        (uint256 cumulativeTimer, ,) = auction.bidders(account);
        if(cumulativeTimer > auction.streamTime()) {
            timeToWin = 0;
        } else {
            timeToWin = auction.streamTime().sub(cumulativeTimer);
        }
        (,uint256 lastSettleAmount,) = auction.bidders(account);
        uint256 balance = lastSettleAmount.add(uint256((int256(block.timestamp).sub(int256(timestamp))).mul(_flowRate)));
        return ISuperAuction.ViewBidder(account, timeToWin, _flowRate, balance);

    }

    function _getFlowInfo(
        IConstantFlowAgreementV1 _cfa,
        ISuperToken _superToken,
        address sender,
        address auctionAddress
    )
    internal
    view
    returns (uint256 timestamp, int96 flowRate)
    {
        (timestamp, flowRate , ,) = _cfa.getFlow(_superToken, sender, auctionAddress);
    }
}