# SuperAuction

**Streamable Auction**

SuperAuction is a different type of auction because is based on the __continuous streaming of tokens__ in opposition to traditional biding methods. Each participate need to initiate a stream to the auction contract to bid. If the stream is accepted then that user have to maintain the stream running for X __(ex. 24hours)__ amount of time. Each new bidder take the position of winner, starting to collect time. But only the winner collects time, the other bidders have to out bid the winner just like a traditional auction.



## Requirements

The smart contract is design and implemented to take in consideration the following:

- Must use Superfluid capacities to implement the streaming functionality.
- Players that drop the auction, either by terminating or liquidation, must not rejoin the auction.
- For each non winner player is send back a equal amount of stream to "cancel-out" the receiving stream. Users don't need to change anything and are still on the auction.
- For each dropping winner, should be select the second bidder in the auction to be selected as winner.
- The smart contract should limit the admin functionality to the minimal. Protecting all participants of a fair auction.
- The winner in the end of the auction, is entitle to the NFT of the auction, paying the amount defined in one or several bids.
- Non winners can collect the excess amount payed when losing the winner position.
- Must be one Owner defined.
- The profits of the auctions must be transfer to Owner account.
.
.
.



## Details and clarifications

Almost all interactions from the users perspective consist on creating, update and deleting streams. This interactions are done on Superfluid smart contracts. Please see [Docs](https://docs.superfluid.finance/superfluid/) and [Protocol-Draft](https://www.notion.so/superfluidhq/Superfluid-Technical-Paper-DRAFT-1-906968c3684b4bd88a8878ff51f08316) for more details about Superfluid protocol.


Each bidder is register on a map structure flowing the definition

---
```solidity
struct Bidder {
        uint256 cumulativeTimer;
        uint256 lastSettleAmount;
        address nextAccount;
    }
```

**cumulativeTimer** : timer that account all **past** winning stream time. To get the actual time, one should add the time of the current stream.

**lastSettleAmount** : Cumulative balance when the user stop being the winner and start receiving one "cancel-out" stream.

**nextAccount** : Pointer to next account on the structure. Can be zero.

---

Global Variables

```step``` defines the minimal amount to add to previous winning flow rate, to be considered a valid bid.

```streamTime``` defines the requirement of winning time to be considered a user as winner.

---

```solidity
    function _newPlayer(
        address account,
        int96 flowRate,
        bytes memory ctx
    )
```

The new user is always to be a new winner. Should go to top of data structure and set the global variables accordingly. The old winner stream is "cancel-out" and the settlement information is saved.



```solidity
function _updatePlayer(
        address account,
        int96 oldFlowRate,
        uint256 oldTimestamp,
        bytes memory ctx
    )
```

The user that is updating the existing flow is always to be a new winner. If necessery should go to top of data structure and set the global variables accordingly. The old winner stream is "cancel-out" and the settlement information is saved.


```solidity
function _dropPlayer(
        address account,
        uint256 oldTimestamp,
        int96 oldFlowRate,
        bytes memory ctx
    )
```

The user dropping will be blocked from rejoining the auction. The smart contract has to find the next sutable winner, and change the structure and variables accordingly. We can end up in a situation where there's no winner to be pick. In this case, delete global variables to signal that no one is winning. 

If the auction is finish, users can drop from the game to collect, in case of the winner NFT token, in case of non winners the settlement balance.

The non winners can execute a specific function to get back the settlement balance, if they here drop before the auction ended.
---

## Others notes

The smart-contract SuperAuctionViewer is just to collect front end information.


## Installation

### Download this project and run

```bash
npm install
```
### Run tests
```bash
truffle test test/contracts/Auction.test.js
```

Run Fuzzy tests

```bash
truffle test test/contracts/AuctionFuzzy.test.js
```

### Run code Coverage 
```bash
truffle run coverage
```

