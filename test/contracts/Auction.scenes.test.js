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
const TEST_TRAVEL_TIME = 3600 * 24; // 24 hours

contract("SuperAuction - Scripted scenes ", accounts => {
  const errorHandler = err => {
    if (err) throw err;
  };

  accounts = accounts.slice(0,10);
  const [admin, bob, carol, dan, alice, karl, anna, ben, john, dude] = accounts;
  const userNames = {};
  userNames[admin] = "Admin";
  userNames[bob] = "Bob";
  userNames[carol] = "Carol";
  userNames[dan] = "Dan";
  userNames[alice] = "Alice";
  userNames[karl] = "Karl";
  userNames[anna] = "Anna";
  userNames[ben] = "Ben";
  userNames[john] = "John";
  userNames[dude] = "Dude";


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

    const previousPlayerAddress = (await getPreviousPlayerUnfiltered(account))
      .account;
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
    let userData;
    if (previousPlayerAddress !== undefined) {
      userData = await web3.eth.abi.encodeParameters(
        ["address"],
        [previousPlayerAddress]
      );
    }

    await sf.cfa.updateFlow({
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

  async function getFlowInfo(sender, receiver) {
    return await sf.cfa.getFlow({
      superToken: daix.address,
      sender: sender,
      receiver: receiver 
    });
  }

  async function dropStream(sender, receiver, by) {
    await sf.cfa.deleteFlow({
      superToken: daix.address,
      sender: sender,
      receiver: receiver,
      by: by
    });

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
    for (let i = 0; i < scoreboard.length; i++) {
      if (scoreboard[i].account == account) {
        return i;
      }
    }
    return 0;
  }

  async function getPreviousPlayerUnfiltered(account) {
    const pos = await getPlayerPositionUnfiltered(account);
    return pos == 0 ? ZERO_ADDRESS : (await getListTop100())[pos - 1];
  }

  async function getPlayerPosition(account) {
    const scoreboard = await getListTop100();

    const top = scoreboard.filter(item => item.flowRate > 0);

    for (let i = 0; i < top.length; i++) {
      if (top[i].account == account) {
        return i + 1;
      }
    }
    return 0;
  }

  async function checkPosition(account, scoreboardPosition) {
    return scoreboardPosition == 0
      ? false
      : (await getPlayerPosition(account)) == scoreboardPosition;
  }

  async function getPreviousPlayer(account) {
    const pos = await getPlayerPosition(account);
    return pos == 1 ? ZERO_ADDRESS : (await getListTop100())[pos - 2];
  }

  beforeEach(async function() {

    await deployFramework(errorHandler, { web3: web3, from: admin });
    await deployTestToken(errorHandler, [":", "fDAI"], {
      web3: web3,
      from: admin
    });
    await deploySuperToken(errorHandler, [":", "fDAI"], {
      web3: web3,
      from: admin
    });

    sf = new SuperfluidSDK.Framework({
      web3: web3,
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
      "0x00F96712cd4995bCd8647dd9Baa995286e4d5c99", //Fake
      99, //Fake
      86400,
      10
    );

    viewer = await web3tx(Viewer.new, "Deploy SuperAuctionViewer")();
  });

  afterEach(async function() {
    assert.ok(!(await sf.host.isAppJailed(app.address)), "App is Jailed");
    assert.equal((await daix.balanceOf(app.address)).toString(), "0", "Auction should be empty");
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


  async function userFinishAuctionCall(account) {
    await app.finishAuction({from:account});
    assert.ok(await app.isFinish.call(), "Auction not closed");
  }

  async function assertNoRunningFlow(account) {
    const a = await getFlowInfo(account, app.address);
    const b = await getFlowInfo(app.address, account);
    assert.equal(a.flowRate.toString(), "0", "User is sending a flow to auction");
    assert.equal(b.flowRate.toString(), "0", "Auctions is sending a flow to user");
  }

  it("#1 - Winner have the time, but no one close the auction - New Player try to enter the game", async() => {
    const bobBalance = await daix.balanceOf(bob);
    const bobFlowInfo = await joinAuction(bob, "10000000");
    await timeTravelOnce(3600 * 25);
    await assertUserWinner(bobFlowInfo);
    await expectRevert(joinAuction(alice, "11000000"), "Auction: Closed auction");
    await assertNoRunningFlow(alice);
    assert.equal((await getFlowInfo(bob, app.address)).flowRate, bobFlowInfo.flowRate, "Bob flow rate should keep running");
    assert.equal((await getFlowInfo(app.address,bob)).flowRate.toString(), "0", "Auction should not send streams to winner");
    await assertUserWinner(bobFlowInfo);
    await userFinishAuctionCall(bob);
    await dropAuction(bob);
    await assertNoRunningFlow(bob);
    const bobBalanceFinal = await daix.balanceOf(bob);
    const adminWithdraw = bobBalance.sub(bobBalanceFinal);
    const adminBalance = (await daix.balanceOf(admin)).add(adminWithdraw);
    await app.withdraw({from:admin});
    assert.ok(adminBalance.eq((await daix.balanceOf(admin))), "Admin did not withdraw");
  });

  it("#2 - Winner have the time, but no one close the auction - Older player updates flow", async() => {
    const bobBalance = await daix.balanceOf(bob);
    const aliceFlowInfo = await joinAuction(alice, "10000000");
    await timeTravelOnce(3600);
    const bobFlowInfo = await joinAuction(bob, "11000000");
    await timeTravelOnce(3600 * 25);
    await expectRevert(updateAuction(alice, "14000000"), "Auction: Closed auction")
    await dropAuction(alice); //Force bob settlement
    await assertNoRunningFlow(alice);
    await assertNoRunningFlow(bob);
    const bobBalanceFinal = await daix.balanceOf(bob);
    const adminWithdraw = bobBalance.sub(bobBalanceFinal);
    const adminBalance = (await daix.balanceOf(admin)).add(adminWithdraw);
    await app.withdraw({from:admin});
    assert.ok(adminBalance.eq((await daix.balanceOf(admin))), "Admin did not withdraw");
    const aliceBlance = daix.balanceOf(alice);
    await app.withdrawNonWinner({from: alice});
  });

  /*
  it("#3 - Winner have the time, but no one close the auction - Non winner player leaves the game", async() => {
  });
  it("#4 - Winner dont have the time - Non winner player leaves the game", async() => {
  });
  it("#5 - Winner dont have the time - drops to leave auction alone", async() => {
  });
  */

});
