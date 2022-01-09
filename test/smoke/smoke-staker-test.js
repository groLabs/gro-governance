const {toBN} = require("web3-utils");
const GROToken = artifacts.require("GROToken");
const GRODistributer = artifacts.require("GRODistributer");
const GROVesting = artifacts.require("GROVesting");
const MockBonus = artifacts.require("MockBonus");
const LPTokenStaker = artifacts.require("LPTokenStaker");
const GROHodler = artifacts.require("GROHodler");
const MockToken = artifacts.require("MockTokenWithOwner");
const MockMigrator = artifacts.require("MockMigrator");
const LPTokenStakerV1 = artifacts.require("LPTokenStakerV1");
const GROVestingV1 = artifacts.require("GROVestingV1");
const GROHodlerV1 = artifacts.require("GROHodlerV1");
const {constants} = require("../utils/constants");
const {expect} = require("../utils/common-utils");

contract("Smoke Staker tests", function (accounts) {
    const INIT_MAX_TOTAL_SUPPLY = toBN(10_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    const INIT_UNLOCKED_PERCENT = toBN(1000);

    const [deployer, groDeployer, dao, user1, user2, vester1, vester2, vester3, burner, timeLock] = accounts;
    let gro, groDist, groVest, staker, lpt1, lpt2, groHodler;

    describe("ok", function () {
        beforeEach(async function () {
            gro = await GROToken.new("GRO", "GRO", INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD, {from: groDeployer});
            groVest = await GROVesting.new(constants.ZERO_ADDRESS, timeLock);
            groHodler = await GROHodler.new(groVest.address, constants.ZERO_ADDRESS);
            staker = await LPTokenStaker.new(timeLock);
            vesters = [vester1, vester2, vester3, groVest.address];
            await staker.setVesting(groVest.address);
            groDist = await GRODistributer.new(gro.address, vesters, burner);
            await gro.setDistributer(groDist.address, {from: groDeployer});
            await groVest.setDistributer(groDist.address);
            await groVest.setHodlerClaims(groHodler.address);
            await groVest.setVester(staker.address, true);
            await gro.setDistributer(groDist.address, {from: groDeployer});

            await staker.setMaxGroPerBlock(toBN(10000).mul(constants.DEFAULT_FACTOR));

            lpt1 = await MockToken.new("LPT1", "LPT1");
            lpt2 = await MockToken.new("LPT2", "LPT2");

            await lpt1.mint(user1, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(user1, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});

            await lpt1.mint(user2, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(user2, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            groBonus = await MockBonus.new();

            groVest.setHodlerClaims(groBonus.address);

            await groVest.setStatus(false, {from: timeLock});
            await staker.setStatus(false, {from: timeLock});
        });

        it("claim & exit", async () => {
            const ap1 = toBN(1);
            const ap2 = toBN(2);
            const gpb = toBN(3).mul(constants.DEFAULT_FACTOR);
            const gpb1 = gpb.mul(ap1).div(ap1.add(ap2));
            const gpb2 = gpb.mul(ap2).div(ap1.add(ap2));

            await staker.setManager(deployer);
            await staker.add(ap1, lpt1.address);
            await staker.add(ap2, lpt2.address);
            await staker.setGroPerBlock(gpb);

            const amount11 = toBN(1000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount11, {from: user1});
            let b1 = toBN(await web3.eth.getBlockNumber());

            const amount12 = toBN(2000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(1, amount12, {from: user1});
            let b2 = toBN(await web3.eth.getBlockNumber());

            await staker.setManager(deployer);
            await staker.setManager(deployer);
            await staker.setManager(deployer);

            await staker.multiClaim(true, [0, 1], {from: user1});
            let b21 = toBN(await web3.eth.getBlockNumber());
            let tb1 = await groVest.totalBalance(user1);
            expect(tb1).be.a.bignumber.equal(b21.sub(b1).mul(gpb1).add(b21.sub(b2).mul(gpb2)));
            b1 = b21;
            b2 = b21;

            await staker.setManager(deployer);
            await staker.setManager(deployer);

            await staker.multiClaim(true, [0, 1], {from: user1});
            b21 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(
                tb1.add(b21.sub(b1).mul(gpb1).add(b21.sub(b2).mul(gpb2)))
            );
            tb1 = await groVest.totalBalance(user1);
            b1 = b21;
            b2 = b21;

            await staker.setManager(deployer);

            await staker.claim(true, 0, {from: user1});
            const b3 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(tb1.add(b3.sub(b1).mul(gpb1)));
            tb1 = await groVest.totalBalance(user1);

            const amount21 = toBN(250).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount21, {from: user2});
            let b4 = toBN(await web3.eth.getBlockNumber());

            let gpb11 = gpb1.mul(amount11).div(amount11.add(amount21));
            let gpb12 = gpb1.mul(amount21).div(amount11.add(amount21));

            await staker.claim(true, 0, {from: user1});
            const b5 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(
                tb1.add(b4.sub(b3).mul(gpb1).add(b5.sub(b4).mul(gpb11)))
            );
            tb1 = await groVest.totalBalance(user1);

            await staker.withdraw(1, amount12, {from: user1});
            const b6 = toBN(await web3.eth.getBlockNumber());
            await expect(lpt2.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));

            const amount22 = toBN(500).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(1, amount22, {from: user2});
            let b7 = toBN(await web3.eth.getBlockNumber());

            await staker.setManager(deployer);
            await staker.setManager(deployer);

            await staker.multiClaim(true, [0, 1], {from: user2});
            let b71 = toBN(await web3.eth.getBlockNumber());
            let tb2 = await groVest.totalBalance(user2);
            expect(tb2).be.a.bignumber.equal(b71.sub(b4).mul(gpb12).add(b71.sub(b7).mul(gpb2)));
            b4 = b71;
            b7 = b71;

            await staker.setManager(deployer);
            await staker.setManager(deployer);
            await staker.setManager(deployer);

            await staker.multiClaim(true, [0, 1], {from: user2});
            b71 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user2)).to.eventually.be.a.bignumber.equal(
                tb2.add(b71.sub(b4).mul(gpb12).add(b71.sub(b7).mul(gpb2)))
            );
            tb2 = await groVest.totalBalance(user2);
            b4 = b71;
            b7 = b71;

            await staker.setManager(deployer);

            await staker.claim(true, 0, {from: user1});
            const b8 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(
                tb1.add(b8.sub(b5).mul(gpb11))
            );
            tb1 = await groVest.totalBalance(user1);

            await staker.withdrawAndClaim(true, 0, amount21, {from: user2});
            const b9 = toBN(await web3.eth.getBlockNumber());
            expect(groVest.totalBalance(user2)).to.eventually.be.a.bignumber.equal(tb2.add(b9.sub(b4).mul(gpb12)));
            tb2 = await groVest.totalBalance(user2);
            await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(amount11);

            await staker.claim(true, 1, {from: user1});
            const b10 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(tb1.add(b6.sub(b2).mul(gpb2)));
            tb1 = await groVest.totalBalance(user1);

            await staker.claim(true, 1, {from: user2});
            const b11 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user2)).to.eventually.be.a.bignumber.equal(
                tb2.add(b11.sub(b7).mul(gpb2))
            );
            tb2 = await groVest.totalBalance(user2);

            await staker.withdrawAndClaim(true, 0, amount11, {from: user1});
            const b12 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(
                tb1.add(b9.sub(b8).mul(gpb11)).add(b12.sub(b9).mul(gpb1))
            );
            tb1 = await groVest.totalBalance(user1);
            await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));

            await staker.withdraw(1, amount22, {from: user2});
            const b13 = toBN(await web3.eth.getBlockNumber());
            await expect(lpt2.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));

            await staker.claim(true, 1, {from: user2});
            const b14 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user2)).to.eventually.be.a.bignumber.equal(
                tb2.add(b13.sub(b11).mul(gpb2))
            );
            tb2 = await groVest.totalBalance(user2);

            const initUnlockedPercent = await groVest.initUnlockedPercent();
            const maxPeriod = await groVest.maxLockPeriod();
            let ui = await groVest.accountInfos(user1);
            let b = await web3.eth.getBlock("latest");
            let addedPeriod = maxPeriod.div(toBN(4));
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(ui.startTime).add(addedPeriod).toNumber()],
            });
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user1});
            let amount = toBN(ui.total);
            let initUnlocked = amount.mul(initUnlockedPercent).div(constants.PERCENT_FACTOR);
            let unlocked = amount.sub(initUnlocked).mul(addedPeriod).div(maxPeriod).add(initUnlocked);
            await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(unlocked);

            ui = await groVest.accountInfos(user2);
            b = await web3.eth.getBlock("latest");
            addedPeriod = maxPeriod.div(toBN(2));
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(ui.startTime).add(addedPeriod).toNumber()],
            });
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user2});
            amount = toBN(ui.total);
            initUnlocked = amount.mul(initUnlockedPercent).div(constants.PERCENT_FACTOR);
            unlocked = amount.sub(initUnlocked).mul(addedPeriod).div(maxPeriod).add(initUnlocked);
            await expect(gro.balanceOf(user2)).to.eventually.be.a.bignumber.equal(unlocked);

            return;
        });

        async function redeployStaker() {
            // disable old staker

            await staker.setStatus(true, {from: timeLock});

            const newStaker = await LPTokenStaker.new(timeLock);
            await groVest.setVester(newStaker.address, true);
            await lpt1.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await lpt2.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await lpt1.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await lpt2.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await newStaker.setOldStaker(staker.address);
            await staker.setNewStaker(newStaker.address);
            await staker.migrate([0, 1], {from: timeLock});

            await newStaker.setVesting(await staker.vesting());
            await newStaker.setManager(await staker.manager());
            await newStaker.setMaxGroPerBlock(await staker.maxGroPerBlock());
            await newStaker.setGroPerBlock(await staker.groPerBlock());

            await newStaker.setStatus(false, {from: timeLock});

            return newStaker;
        }

        it("migrate", async () => {
            // user1 -> staker p0 10000
            // user1 -> staker p1 20000
            // user2 -> staker p0 30000
            // staker >> newStaker
            // user2 ->> staker newStaker
            // user2 --> newStaker [p0, p1]
            // user2 -> newStaker p1 20000
            // user1 -> newStaker p0 20000
            // user1 -> newStaker p1 10000
            // user1 --> newStaker [p0, p1]
            // user1 ->> staker newStaker
            // user1 <-- newStaker p0 30000
            // user2 --> newStaker [p0, p1]
            // user2 <-- newStaker p1 20000
            // user1 --> newStaker [p0, p1]
            // user2 <-- newStaker p0 30000
            // user1 <-- newStaker p1 30000

            const ap1 = toBN(1);
            const ap2 = toBN(2);
            const gpb = toBN(3).mul(constants.DEFAULT_FACTOR);
            const gpb1 = gpb.mul(ap1).div(ap1.add(ap2));
            const gpb2 = gpb.mul(ap2).div(ap1.add(ap2));

            await staker.setManager(deployer);
            await staker.add(ap1, lpt1.address);
            await staker.add(ap2, lpt2.address);
            await staker.setGroPerBlock(gpb);

            let amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount, {from: user1});
            const b1 = toBN(await web3.eth.getBlockNumber());
            let amount11 = amount;

            amount = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(1, amount, {from: user1});
            const b2 = toBN(await web3.eth.getBlockNumber());
            let amount12 = amount;

            amount = toBN(30000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount, {from: user2});
            const b3 = toBN(await web3.eth.getBlockNumber());
            let amount21 = amount;
            let c11 = b3.sub(b1).mul(gpb1);
            let gpb11 = gpb1.mul(amount11).div(amount11.add(amount21));
            let gpb12 = gpb1.mul(amount21).div(amount11.add(amount21));

            const newStaker = await redeployStaker();

            await newStaker.migrateUser(user2, [0, 1]);
            await expect(newStaker.migrateUser(user2, [0, 1])).to.eventually.be.rejectedWith(
                "migrateUser: pid already done"
            );

            await newStaker.multiClaim(true, [0, 1], {from: user2});
            const b4 = toBN(await web3.eth.getBlockNumber());
            let tb2 = await groVest.totalBalance(user2);
            expect(tb2).to.be.a.bignumber.equal(b4.sub(b3).mul(gpb12));

            amount = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await newStaker.deposit(1, amount, {from: user2});
            const b5 = toBN(await web3.eth.getBlockNumber());
            let amount22 = amount;
            let c21 = b5.sub(b2).mul(gpb2);
            let gpb21 = gpb2.mul(amount12).div(amount12.add(amount22));
            let gpb22 = gpb2.mul(amount22).div(amount12.add(amount22));

            amount = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await newStaker.deposit(0, amount, {from: user1});
            const b6 = toBN(await web3.eth.getBlockNumber());
            let amount11t = amount;
            c11 = c11.add(b6.sub(b3).mul(gpb11));
            let c12 = b6.sub(b4).mul(gpb12);
            gpb11 = gpb1.mul(amount11).div(amount11.add(amount21).add(amount11t));
            gpb12 = gpb1.mul(amount21).div(amount11.add(amount21).add(amount11t));
            let gpb11t = gpb1.mul(amount11t).div(amount11.add(amount21).add(amount11t));

            amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await newStaker.deposit(1, amount, {from: user1});
            const b7 = toBN(await web3.eth.getBlockNumber());
            let amount12t = amount;
            c21 = c21.add(b7.sub(b5).mul(gpb21));
            let c22 = b7.sub(b5).mul(gpb22);
            gpb21 = gpb2.mul(amount12).div(amount12.add(amount22).add(amount12t));
            gpb22 = gpb2.mul(amount22).div(amount12.add(amount22).add(amount12t));
            let gpb21t = gpb2.mul(amount12t).div(amount12.add(amount22).add(amount12t));

            await newStaker.multiClaim(true, [0, 1], {from: user1});
            const b8 = toBN(await web3.eth.getBlockNumber());
            let tb1 = await groVest.totalBalance(user1);
            expect(tb1).to.be.a.bignumber.closeTo(
                b8.sub(b6).mul(gpb11t).add(b8.sub(b7).mul(gpb21t)),
                toBN(10).pow(toBN(10))
            );

            await newStaker.migrateUser(user1, [0, 1]);
            await expect(newStaker.migrateUser(user1, [0, 1])).to.eventually.be.rejectedWith(
                "migrateUser: pid already done"
            );

            const b9 = toBN(await web3.eth.getBlockNumber());

            const c0 = await newStaker.claimable(0, user1);
            const c1 = await newStaker.claimable(1, user1);

            c11 = c11.add(b9.sub(b6).mul(gpb11));
            expect(c0).to.be.a.bignumber.closeTo(c11.add(b9.sub(b8).mul(gpb11t)), toBN(10).pow(toBN(11)));
            c21 = c21.add(b9.sub(b7).mul(gpb21));
            expect(c1).to.be.a.bignumber.closeTo(c21.add(b9.sub(b8).mul(gpb21t)), toBN(0));
            c11 = c0;
            c21 = c1;
            amount11 = amount11.add(amount11t);
            amount12 = amount12.add(amount12t);
            gpb11 = gpb1.mul(amount11).div(amount11.add(amount21));
            gpb21 = gpb2.mul(amount12).div(amount12.add(amount22));

            let balanceBefore = await lpt1.balanceOf(user1);
            await newStaker.withdrawAndClaim(true, 0, amount11, {from: user1});
            const b10 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.closeTo(
                tb1.add(c11.add(b10.sub(b9).mul(gpb11))),
                toBN(10).pow(toBN(11))
            );
            tb1 = await groVest.totalBalance(user1);
            let balanceAfter = await lpt1.balanceOf(user1);
            expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount11);
            c12 = c12.add(b10.sub(b6).mul(gpb12));

            await newStaker.multiClaim(true, [0, 1], {from: user2});
            const b11 = toBN(await web3.eth.getBlockNumber());
            c12 = c12.add(b11.sub(b10).mul(gpb1));
            c22 = c22.add(b11.sub(b7).mul(gpb22));
            await expect(groVest.totalBalance(user2)).to.eventually.be.a.bignumber.closeTo(
                tb2.add(c12).add(c22),
                toBN(10).pow(toBN(11))
            );
            tb2 = await groVest.totalBalance(user2);

            balanceBefore = await lpt2.balanceOf(user2);
            await newStaker.withdrawAndClaim(true, 1, amount22, {from: user2});
            const b12 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user2)).to.eventually.be.a.bignumber.closeTo(
                tb2.add(b12.sub(b11).mul(gpb22)),
                toBN(10).pow(toBN(0))
            );
            tb2 = await groVest.totalBalance(user2);
            balanceAfter = await lpt2.balanceOf(user2);
            expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount22);
            c21 = c21.add(b12.sub(b9).mul(gpb21));

            await newStaker.multiClaim(true, [0, 1], {from: user1});
            const b13 = toBN(await web3.eth.getBlockNumber());
            c21 = c21.add(b13.sub(b12).mul(gpb2));
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.closeTo(
                tb1.add(c21),
                toBN(10).pow(toBN(11))
            );
            tb1 = await groVest.totalBalance(user1);

            balanceBefore = await lpt1.balanceOf(user2);
            await newStaker.withdrawAndClaim(true, 0, amount22, {from: user2});
            const b14 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user2)).to.eventually.be.a.bignumber.closeTo(
                tb2.add(b14.sub(b11).mul(gpb1)),
                toBN(10).pow(toBN(11))
            );
            tb2 = await groVest.totalBalance(user2);
            balanceAfter = await lpt1.balanceOf(user2);
            expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount22);

            balanceBefore = await lpt2.balanceOf(user1);
            await newStaker.withdrawAndClaim(true, 1, amount21, {from: user1});
            const b15 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.closeTo(
                tb1.add(b15.sub(b13).mul(gpb2)),
                toBN(10).pow(toBN(10))
            );
            tb1 = await groVest.totalBalance(user1);
            balanceAfter = await lpt2.balanceOf(user1);
            expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount21);

            return;
        });
    });

    describe("migrate from V1", function () {
        beforeEach(async function () {
            gro = await GROToken.new("GRO", "GRO", INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD, {from: groDeployer});
            groVest = await GROVestingV1.new(INIT_UNLOCKED_PERCENT);
            groHodler = await GROHodlerV1.new(groVest.address, constants.ZERO_ADDRESS);
            staker = await LPTokenStakerV1.new();
            vesters = [vester1, vester2, vester3, groVest.address];
            await staker.setVesting(groVest.address);
            groDist = await GRODistributer.new(gro.address, vesters, burner);
            await gro.setDistributer(groDist.address, {from: groDeployer});
            await groVest.setDistributer(groDist.address);
            await groVest.setHodlerClaims(groHodler.address);
            await groVest.setVester(staker.address, true);
            await gro.setDistributer(groDist.address, {from: groDeployer});

            await staker.setMaxGroPerBlock(toBN(10000).mul(constants.DEFAULT_FACTOR));

            lpt1 = await MockToken.new("LPT1", "LPT1");
            lpt2 = await MockToken.new("LPT2", "LPT2");

            await lpt1.mint(user1, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(user1, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});

            await lpt1.mint(user2, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(user2, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            groBonus = await MockBonus.new();

            groVest.setHodlerClaims(groBonus.address);
        });

        async function redeployVesting() {
            let oldGroPerBlock = await staker.groPerBlock();
            let oldPoolAllocations = [];
            oldPoolAllocations[0] = (await staker.poolInfo(0)).allocPoint;
            oldPoolAllocations[1] = (await staker.poolInfo(1)).allocPoint;

            // disable old staker

            await staker.set(0, 0);
            await staker.set(1, 0);

            await expect(staker.deposit(0, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.deposit(1, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.withdraw(0, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.withdraw(1, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.claim(0)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.claim(1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.withdrawAndClaim(0, 1)).to.eventually.be.rejectedWith(
                "updatePool: totalAllocPoint == 0"
            );
            await expect(staker.withdrawAndClaim(1, 1)).to.eventually.be.rejectedWith(
                "updatePool: totalAllocPoint == 0"
            );

            // disable old hodler

            await groHodler.setStatus(true);
            await expect(groHodler.canClaim()).to.eventually.be.equal(false);

            // disable old vesting

            await groVest.setDistributer(constants.ZERO_ADDRESS);
            await groVest.setHodlerClaims(constants.ZERO_ADDRESS);
            await expect(groVest.exit({from: user1})).to.eventually.be.rejected;
            await expect(groVest.exit({from: user2})).to.eventually.be.rejected;

            const newStaker = await LPTokenStaker.new(timeLock);
            await lpt1.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await lpt2.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await lpt1.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await lpt2.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await newStaker.setOldStaker(staker.address);
            await newStaker.migrateFromV1();
            await expect(newStaker.migrateFromV1()).to.eventually.be.rejectedWith("migrateFromV1: already done");
            await newStaker.setGroPerBlock(oldGroPerBlock);
            await newStaker.set(0, oldPoolAllocations[0]);
            await newStaker.set(1, oldPoolAllocations[1]);

            const mockLPT1 = await MockToken.new("MockLPT1", "MockLPT1");
            const mockLPT2 = await MockToken.new("MockLPT2", "MockLPT2");
            const migrator = await MockMigrator.new(
                staker.address,
                newStaker.address,
                [lpt1.address, lpt2.address],
                [mockLPT1.address, mockLPT2.address]
            );
            await staker.setMigrator(migrator.address);
            await mockLPT1.mint(migrator.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await mockLPT2.mint(migrator.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));

            await staker.migrate(0);
            await staker.migrate(1);

            const newGroVest = await GROVesting.new(groVest.address, timeLock);
            const newGroH = await GROHodler.new(newGroVest.address, groHodler.address);

            let vesters = [vester1, vester2, vester3, newGroVest.address];
            const newGroDist = await GRODistributer.new(gro.address, vesters, burner);
            await gro.setDistributer(newGroDist.address, {from: groDeployer});
            await newGroVest.setDistributer(newGroDist.address);
            await newStaker.setVesting(newGroVest.address);
            await newGroVest.setVester(newGroH.address, true);
            await newGroVest.setVester(newStaker.address, true);
            await newGroVest.setHodlerClaims(newGroH.address);

            await newGroH.setStatus(false);
            await newGroVest.setStatus(false, {from: timeLock});
            await newStaker.setStatus(false, {from: timeLock});

            return [newGroVest, newStaker, newGroH];
        }

        it("migrate", async () => {
            // user1 -> staker p0 10000
            // user1 -> staker p1 20000
            // user2 -> staker p0 30000
            // staker >> newStaker
            // user2 ->> staker newStaker
            // user2 --> newStaker [p0, p1]
            // user2 -> newStaker p1 20000
            // user1 -> newStaker p0 20000
            // user1 -> newStaker p1 10000
            // user1 --> newStaker [p0, p1]
            // user1 ->> staker newStaker
            // user1 <-- newStaker p0 30000
            // user2 --> newStaker [p0, p1]
            // user2 <-- newStaker p1 20000
            // user1 --> newStaker [p0, p1]
            // user2 <-- newStaker p0 30000
            // user1 <-- newStaker p1 30000

            const ap1 = toBN(1);
            const ap2 = toBN(2);
            const gpb = toBN(3).mul(constants.DEFAULT_FACTOR);
            const gpb1 = gpb.mul(ap1).div(ap1.add(ap2));
            const gpb2 = gpb.mul(ap2).div(ap1.add(ap2));

            await staker.setManager(deployer);
            await staker.add(ap1, lpt1.address);
            await staker.add(ap2, lpt2.address);
            await staker.setGroPerBlock(gpb);

            let amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount, {from: user1});
            const b1 = toBN(await web3.eth.getBlockNumber());
            let amount11 = amount;

            amount = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(1, amount, {from: user1});
            const b2 = toBN(await web3.eth.getBlockNumber());
            let amount12 = amount;

            amount = toBN(30000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount, {from: user2});
            const b3 = toBN(await web3.eth.getBlockNumber());
            let amount21 = amount;
            let c11 = b3.sub(b1).mul(gpb1);
            let gpb11 = gpb1.mul(amount11).div(amount11.add(amount21));
            let gpb12 = gpb1.mul(amount21).div(amount11.add(amount21));

            const [newGroV, newStaker, newGroH] = await redeployVesting();

            await newStaker.migrateUser(user2, [0, 1]);
            await expect(newStaker.migrateUser(user2, [0, 1])).to.eventually.be.rejectedWith(
                "migrateUser: pid already done"
            );

            await newStaker.multiClaim(true, [0, 1], {from: user2});
            const b4 = toBN(await web3.eth.getBlockNumber());
            let tb2 = await newGroV.totalBalance(user2);
            expect(tb2).to.be.a.bignumber.equal(b4.sub(b3).mul(gpb12));

            amount = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await newStaker.deposit(1, amount, {from: user2});
            const b5 = toBN(await web3.eth.getBlockNumber());
            let amount22 = amount;
            let c21 = b5.sub(b2).mul(gpb2);
            let gpb21 = gpb2.mul(amount12).div(amount12.add(amount22));
            let gpb22 = gpb2.mul(amount22).div(amount12.add(amount22));

            amount = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await newStaker.deposit(0, amount, {from: user1});
            const b6 = toBN(await web3.eth.getBlockNumber());
            let amount11t = amount;
            c11 = c11.add(b6.sub(b3).mul(gpb11));
            let c12 = b6.sub(b4).mul(gpb12);
            gpb11 = gpb1.mul(amount11).div(amount11.add(amount21).add(amount11t));
            gpb12 = gpb1.mul(amount21).div(amount11.add(amount21).add(amount11t));
            let gpb11t = gpb1.mul(amount11t).div(amount11.add(amount21).add(amount11t));

            amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await newStaker.deposit(1, amount, {from: user1});
            const b7 = toBN(await web3.eth.getBlockNumber());
            let amount12t = amount;
            c21 = c21.add(b7.sub(b5).mul(gpb21));
            let c22 = b7.sub(b5).mul(gpb22);
            gpb21 = gpb2.mul(amount12).div(amount12.add(amount22).add(amount12t));
            gpb22 = gpb2.mul(amount22).div(amount12.add(amount22).add(amount12t));
            let gpb21t = gpb2.mul(amount12t).div(amount12.add(amount22).add(amount12t));

            await newStaker.multiClaim(true, [0, 1], {from: user1});
            const b8 = toBN(await web3.eth.getBlockNumber());
            let tb1 = await newGroV.totalBalance(user1);
            expect(tb1).to.be.a.bignumber.closeTo(
                b8.sub(b6).mul(gpb11t).add(b8.sub(b7).mul(gpb21t)),
                toBN(10).pow(toBN(10))
            );

            await newStaker.migrateUser(user1, [0, 1]);
            await expect(newStaker.migrateUser(user1, [0, 1])).to.eventually.be.rejectedWith(
                "migrateUser: pid already done"
            );

            const b9 = toBN(await web3.eth.getBlockNumber());

            const c0 = await newStaker.claimable(0, user1);
            const c1 = await newStaker.claimable(1, user1);

            c11 = c11.add(b9.sub(b6).mul(gpb11));
            expect(c0).to.be.a.bignumber.closeTo(c11.add(b9.sub(b8).mul(gpb11t)), toBN(10).pow(toBN(11)));
            c21 = c21.add(b9.sub(b7).mul(gpb21));
            expect(c1).to.be.a.bignumber.closeTo(c21.add(b9.sub(b8).mul(gpb21t)), toBN(0));
            c11 = c0;
            c21 = c1;
            amount11 = amount11.add(amount11t);
            amount12 = amount12.add(amount12t);
            gpb11 = gpb1.mul(amount11).div(amount11.add(amount21));
            gpb21 = gpb2.mul(amount12).div(amount12.add(amount22));

            let balanceBefore = await lpt1.balanceOf(user1);
            await newStaker.withdrawAndClaim(true, 0, amount11, {from: user1});
            const b10 = toBN(await web3.eth.getBlockNumber());
            await expect(newGroV.totalBalance(user1)).to.eventually.be.a.bignumber.closeTo(
                tb1.add(c11.add(b10.sub(b9).mul(gpb11))),
                toBN(10).pow(toBN(11))
            );
            tb1 = await newGroV.totalBalance(user1);
            let balanceAfter = await lpt1.balanceOf(user1);
            expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount11);
            c12 = c12.add(b10.sub(b6).mul(gpb12));

            await newStaker.multiClaim(true, [0, 1], {from: user2});
            const b11 = toBN(await web3.eth.getBlockNumber());
            c12 = c12.add(b11.sub(b10).mul(gpb1));
            c22 = c22.add(b11.sub(b7).mul(gpb22));
            await expect(newGroV.totalBalance(user2)).to.eventually.be.a.bignumber.closeTo(
                tb2.add(c12).add(c22),
                toBN(10).pow(toBN(11))
            );
            tb2 = await newGroV.totalBalance(user2);

            balanceBefore = await lpt2.balanceOf(user2);
            await newStaker.withdrawAndClaim(true, 1, amount22, {from: user2});
            const b12 = toBN(await web3.eth.getBlockNumber());
            await expect(newGroV.totalBalance(user2)).to.eventually.be.a.bignumber.closeTo(
                tb2.add(b12.sub(b11).mul(gpb22)),
                toBN(10).pow(toBN(0))
            );
            tb2 = await newGroV.totalBalance(user2);
            balanceAfter = await lpt2.balanceOf(user2);
            expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount22);
            c21 = c21.add(b12.sub(b9).mul(gpb21));

            await newStaker.multiClaim(true, [0, 1], {from: user1});
            const b13 = toBN(await web3.eth.getBlockNumber());
            c21 = c21.add(b13.sub(b12).mul(gpb2));
            await expect(newGroV.totalBalance(user1)).to.eventually.be.a.bignumber.closeTo(
                tb1.add(c21),
                toBN(10).pow(toBN(11))
            );
            tb1 = await newGroV.totalBalance(user1);

            balanceBefore = await lpt1.balanceOf(user2);
            await newStaker.withdrawAndClaim(true, 0, amount22, {from: user2});
            const b14 = toBN(await web3.eth.getBlockNumber());
            await expect(newGroV.totalBalance(user2)).to.eventually.be.a.bignumber.closeTo(
                tb2.add(b14.sub(b11).mul(gpb1)),
                toBN(10).pow(toBN(11))
            );
            tb2 = await newGroV.totalBalance(user2);
            balanceAfter = await lpt1.balanceOf(user2);
            expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount22);

            balanceBefore = await lpt2.balanceOf(user1);
            await newStaker.withdrawAndClaim(true, 1, amount21, {from: user1});
            const b15 = toBN(await web3.eth.getBlockNumber());
            await expect(newGroV.totalBalance(user1)).to.eventually.be.a.bignumber.closeTo(
                tb1.add(b15.sub(b13).mul(gpb2)),
                toBN(10).pow(toBN(10))
            );
            tb1 = await newGroV.totalBalance(user1);
            balanceAfter = await lpt2.balanceOf(user1);
            expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount21);

            return;
        });
    });
});
