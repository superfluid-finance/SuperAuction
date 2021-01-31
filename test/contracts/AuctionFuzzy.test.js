const { web3tx, toWad, toBN } = require("@decentral.ee/web3-helpers");
const { expectRevert } = require("@openzeppelin/test-helpers");
const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");
const SuperfluidSDK = require("@superfluid-finance/js-sdk");
const SuperAuction = artifacts.require("SuperAuction");
const Viewer = artifacts.require("SuperAuctionViewer");

const traveler = require("ganache-time-traveler");

const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers").constants;
const TEST_TRAVEL_TIME = 100; // 24 hours

contract("SuperAuction", accounts => {
  const errorHandler = err => {
    if (err) throw err;
  };

  accounts = accounts.slice(0, 6);
  const [admin, bob, carol, dan, alice, karl] = accounts;
  const userNames = {};
  userNames[admin] = "Admin";
  userNames[bob] = "Bob  ";
  userNames[carol] = "Carol";
  userNames[dan] = "Dan  ";
  userNames[alice] = "Alice";
  userNames[karl] = "Karl ";

  let sf;
  let dai;
  let daix;
  let app;
  let viewer;

  async function timeTravelOnce(time) {
    const _time = time || TEST_TRAVEL_TIME;
    const block1 = await web3.eth.getBlock("latest");
    console.log("current block time", block1.timestamp);
    console.log(`time traveler going to the future +${_time}...`);
    await traveler.advanceTimeAndBlock(_time);
    const block2 = await web3.eth.getBlock("latest");
    console.log("new block time", block2.timestamp);
  }

  async function joinAuction(account, flowRate) {
    const data = await app.bidders(account);
    if (data.cumulativeTimer.toString() !== "0") {
      console.log(`${userNames[account]} is rejoining`);
    }

    const previousPlayerAddress = await getPreviousPlayerUnfiltered(account);
    let userData;
    if (previousPlayerAddress !== undefined) {
      console.log(previousPlayerAddress);
      userData = await web3.eth.abi.encodeParameters(
        ["address"],
        [previousPlayerAddress]
      );
    }
    await sf.cfa.createFlow({
      superToken: daix.address,
      sender: account,
      receiver: app.address,
      flowRate: flowRate,
      userData: userData
    });
    let obj = {};
    obj = await sf.cfa.getFlow({
      superToken: daix.address,
      sender: account,
      receiver: app.address
    });
    obj.account = account;
    return obj;
  }

  async function updateAuction(account, flowRate) {
    const previousPlayerAddress = (await getPreviousPlayer(account)).account;
    console.log("previousPlayerAddress: ", userNames[previousPlayerAddress]);
    const userData =
      previousPlayerAddress === undefined
        ? "0x"
        : await web3.eth.abi.encodeParameters(
            ["address"],
            [previousPlayerAddress]
          );
    await sf.cfa.updateFlow({
      superToken: daix.address,
      sender: account,
      receiver: app.address,
      flowRate: flowRate,
      userData
    });
    let obj = {};
    obj = await sf.cfa.getFlow({
      superToken: daix.address,
      sender: account,
      receiver: app.address
    });
    obj.account = account;
    return obj;
  }

  async function dropAuction(account) {
    await sf.cfa.deleteFlow({
      superToken: daix.address,
      sender: account,
      receiver: app.address
    });

    return await sf.cfa.getFlow({
      superToken: daix.address,
      sender: account,
      receiver: app.address
    });
  }

  async function getFlowFromAuction(account) {
    return await getFlow(app.address, account);
  }

  async function getFlowFromUser(account) {
    return await getFlow(account, app.address);
  }

  async function getFlow(sender, receiver) {
    return await sf.cfa.getFlow({
      superToken: daix.address,
      sender: sender,
      receiver: receiver
    });
  }

  async function getListTop100() {
    return await viewer.getBiddersAddresses(app.address, 0, 100);
  }

  async function getPlayerPositionUnfiltered(account) {
    const scoreboard = await getListTop100();
    for (let i = 0; i < 100; i++) {
      if (scoreboard[i].account.toLowerCase() == account.toLowerCase()) {
        return i + 1;
      }
    }
    return 0;
  }

  async function getPreviousPlayerUnfiltered(account) {
    const pos = await getPlayerPositionUnfiltered(account);
    console.log("Unfiltered position:", pos);
    return pos < 2 ? ZERO_ADDRESS : (await getListTop100())[pos - 2].account;
  }

  async function checkPosition(account, scoreboardPosition) {
    return scoreboardPosition == 0
      ? false
      : (await getPlayerPosition(account)) == scoreboardPosition;
  }
  async function checkPosition(account, scoreboardPosition) {
    if (scoreboardPosition == 0) {
      return false;
    }

    return (await getPlayerPosition(account)) == scoreboardPosition;
  }

  async function getPreviousPlayer(account) {
    const pos = await getPlayerPositionUnfiltered(account);
    if (pos == 1) {
      return ZERO_ADDRESS;
    }
    return (await getListTop100())[pos - 2];
  }

  beforeEach(async function() {
    const web3Provider = web3.currentProvider;

    await deployFramework(errorHandler, { from: admin });
    await deployTestToken(errorHandler, [":", "fDAI"], {
      web3Provider,
      from: admin
    });
    await deploySuperToken(errorHandler, [":", "fDAI"], {
      web3Provider,
      from: admin
    });

    sf = new SuperfluidSDK.Framework({
      web3Provider,
      tokens: ["fDAI"]
    });
    await sf.initialize();
    daix = sf.tokens.fDAIx;

    if (!dai) {
      const daiAddress = await sf.tokens.fDAI.address;
      dai = await sf.contracts.TestToken.at(daiAddress);
      for (let i = 0; i < accounts.length; ++i) {
        await web3tx(dai.mint, `Account ${i} mints many dai`)(
          accounts[i],
          toWad(10000000),
          { from: accounts[i] }
        );
        await web3tx(dai.approve, `Account ${i} approves daix`)(
          daix.address,
          toWad(100),
          { from: accounts[i] }
        );

        await web3tx(daix.upgrade, `Account ${i} upgrades many DAIx`)(
          toWad(100),
          { from: accounts[i] }
        );
      }
    }

    app = await web3tx(SuperAuction.new, "Deploy SuperAuction")(
      sf.host.address,
      sf.agreements.cfa.address,
      daix.address,
      500
    );
    viewer = await web3tx(Viewer.new, "Deploy SuperAuctionViewer")();
  });

  async function assertNoWinner() {
    const winner = await app.winner.call();
    const winnerFlowRate = await app.winnerFlowRate.call();
    assert.equal(winner, ZERO_ADDRESS, "no one should be the winner");
    assert.equal(
      winnerFlowRate.toString(),
      "0",
      "should not flowRate as winner"
    );
  }

  async function assertUserWinner(flowInfo) {
    const winner = await app.winner.call();
    const winnerFlowRate = await app.winnerFlowRate.call();
    assert.equal(
      winner,
      flowInfo.account,
      `${userNames[flowInfo.account]} should be the winner`
    );
    assert.equal(
      winnerFlowRate.toString(),
      flowInfo.flowRate.toString(),
      `${
        userNames[flowInfo.account]
      } should have the correct flowRate as winner`
    );
  }

  async function assertWinnerCorrect() {
    const winner = await app.winner.call();
    if (winner === ZERO_ADDRESS) await assertNoWinner();
    else assertUserWinner(winner);
  }

  async function getAllUsers() {
    const top100 = await getListTop100();
    const allUsers = await Promise.all(
      accounts.map(async account => {
        var fromAuction = (await getFlowFromAuction(account)).flowRate;
        fromAuction = fromAuction === undefined ? 0 : Number(fromAuction);
        var fromUser = (await getFlowFromUser(account)).flowRate;
        fromUser = fromUser === undefined ? 0 : Number(fromUser);
        var filteredResult = top100.filter(
          user => user.account.toLowerCase() === account.toLowerCase()
        )[0];
        filteredResult =
          filteredResult === undefined
            ? { timeToWin: 0, balance: 0, flowRate: 0 }
            : filteredResult;
        var timeToWin = filteredResult["timeToWin"];
        timeToWin = timeToWin === undefined ? 0 : Number(timeToWin);
        var balance = filteredResult["balance"];
        balance = balance === undefined ? 0 : Number(balance);
        var nextAccount = filteredResult["nextAccount"];
        nextAccount = nextAccount === undefined ? "" : nextAccount;
        const user = {
          address: account,
          position: await getPlayerPositionUnfiltered(account),
          flowRate: fromUser,
          timeToWin,
          accumulatedAmount: balance,
          nextAccount,
          isCancelled: fromUser === fromAuction,
          isSendingMoney: fromUser > 0 && fromAuction === 0,
          isWinner:
            (await app.winner.call()).toLowerCase() === account.toLowerCase()
        };
        const {
          position,
          flowRate,
          isCancelled,
          isWinner,
          isSendingMoney
        } = user;
        // NOTE: This function depends on "position" working properly. And I haven't tested position
        // NOTE: Position will return "zero" for users who are "unlinked"
        // NOTE: Position will return a position for users who have dropped but are still in list
        if (position < 1) {
          //if user isn't participating
          assert.ok(
            flowRate === 0,
            `User ${userNames[account]} isn't in game but has active flow`
          );
          assert.ok(
            !isWinner,
            `User ${userNames[account]} isn't in game but is the winner`
          );
        } else {
          if (isSendingMoney) {
            assert.ok(
              position === 1,
              `user ${userNames[account]} is sending money but isn't in first position`
            );
            assert.ok(
              isWinner,
              `user ${userNames[account]} is sending money but isn't the winner`
            );
          } else {
            //if user isn't sending money (should be cancelled back)
            assert.ok(
              isCancelled,
              `user ${userNames[account]} isn't being cancelled`
            );
            assert.ok(
              !isWinner,
              `user ${userNames[account]} isn't sending money but is the winner`
            );
          }
        }
        return user;
      })
    );
    return allUsers.sort((a, b) => {
      if (a.position > 0 && b.position > 0) return a.position - b.position;
      if (a.position > 0) return -1;
      return 1;
    });
  }

  async function assertTablePositions(orderUsers) {
    for (let i = 0; i < orderUsers.length; i++) {
      assert.ok(
        await checkPosition(orderUsers[i], i + 1),
        `${userNames[orderUsers[i]]} not in fist place on listTop`
      );
    }
  }

  async function assertNoLeaks() {
    const winner = await app.winner.call();
    const winnerFlowRate = (await app.winnerFlowRate.call()).toString();
    const appNetFlow = (await sf.cfa.getNetFlow({
      superToken: daix.address,
      account: app.address
    })).toString();
    assert.equal(
      winnerFlowRate,
      appNetFlow,
      `There is a leak!! WinnerFlowRate is ${winnerFlowRate} and appFlowRate is ${appNetFlow}`
    );
  }

  async function assertEverything() {
    // check no leaks: winner should be only payer, or no players
    await assertNoLeaks();
    // get sorted list of participants. Prechecks a number of things
    const list = await getAllUsers();
    console.log(
      "time since beginning: ",
      (await web3.eth.getBlock("latest")).timestamps - initialGlobalTime
    );
    console.log("pos\tuser\tflow\ttime\tfunds\tnext");
    for (var user of list) {
      console.log(
        "#",
        user.position,
        "\t",
        userNames[user.address],
        "\t",
        user.flowRate.toString(),
        "\t",
        user.timeToWin,
        "\t",
        user.accumulatedAmount,
        "\t",
        userNames[user.nextAccount]
      );
    }
    // this function checks that the list is sorted. If a user has dropped out, it ignores them and moves on.
    var flowRate = 0;
    for (var i = 0; i < list.length - 2; i++) {
      flowRate = list[i].flowRate > 0 ? list[i].flowRate : flowRate; //saves non zero amounts to check with next bid.
      if (flowRate === 0) {
        console.log("looks like everyone has left");
        return;
      }
      assert(
        flowRate > list[i + 1].flowRate,
        `The list isn't sorted properly: ${
          userNames[list[i].address]
        }'s flowrate (${list[i].flowRate.toString()}) isn't higher than ${
          userNames[list[i + 1].address]
        }'s flowrate(${list[i + 1].flowRate.toString()})`
      );
    }
  }

  async function hasPlayedBefore(account) {
    return (await app.bidders(account)).cumulativeTimer > 0;
  }
  async function isPlayer(account) {
    var fromUser = (await getFlowFromUser(account)).flowRate;
    fromUser = fromUser === undefined ? 0 : Number(fromUser);
    return fromUser > 0;
  }

  describe("Fuzzy testing", async function() {
    it("Case #6 - Random testing", async () => {
      initialGlobalTime = await (await web3.eth.getBlock("latest")).timestamp;
      const appInitialBalance = await daix.balanceOf(app.address);
      for (var i = 0; i < 25; i++) {
        const user = accounts[Math.floor(Math.random() * accounts.length)];
        const winner = await app.winner.call();
        const winnerFlowRate = await app.winnerFlowRate.call();
        console.log(
          `${userNames[winner]} is current winner, with flowRate: ${winnerFlowRate}`
        );
        var seed = Math.floor(Math.random() * 2);
        switch (seed) {
          case 1: //user becomes the winner
            if ((await getFlowFromUser(user)).flowRate > 0) {
              console.log(`${userNames[user]} is deleting flow`);
              await dropAuction(user);
              break;
            }
          default:
            if (await isPlayer(user)) {
              console.log(`${userNames[user]} is updating flow`);
              await updateAuction(user, Number(winnerFlowRate) + 10);
            } else {
              console.log(`${userNames[user]} is creating flow`);
              await joinAuction(user, Number(winnerFlowRate) + 10);
            }
        }
        // move time
        await timeTravelOnce();
        // print stuff

        // check stuff
        await assertEverything();
      }
    }).timeout(10000000);
  });
});
