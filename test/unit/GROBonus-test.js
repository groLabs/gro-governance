const {toBN} = require("web3-utils");
const GROVesting = artifacts.require("GROVesting");
const GROHodler = artifacts.require("GROHodler");
const GROToken = artifacts.require("GROToken");
const GRODistributer = artifacts.require("GRODistributer");
const {constants} = require("../utils/constants");
const {expect} = require("../utils/common-utils");

contract("GROBonus", function (accounts) {
    const INIT_MAX_TOTAL_SUPPLY = toBN(10_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    const INIT_UNLOCKED_PERCENT = toBN(1000);

    const [deployer, groDeployer, dao, user1, user2, user3, burner, timeLock] = accounts;
    let gro, groDist, groVest, groHodler;

    beforeEach(async function () {
        gro = await GROToken.new("GRO", "GRO", INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD, {from: groDeployer});
        groVest = await GROVesting.new(constants.ZERO_ADDRESS, timeLock);
        vesters = [dao, deployer, groDeployer, groVest.address];
        groDist = await GRODistributer.new(gro.address, vesters, burner);
        await gro.setDistributer(groDist.address, {from: groDeployer});
        await groVest.setDistributer(groDist.address);
        await gro.setDistributer(groDist.address, {from: groDeployer});

        groHodler = await GROHodler.new(groVest.address, constants.ZERO_ADDRESS);
        groVest.setVester(groHodler.address, true);
        groVest.setVester(deployer, true);
        groVest.setHodlerClaims(groHodler.address);
        await groHodler.setMaintainer(deployer, {from: deployer});

        await groHodler.setStatus(false, {from: deployer});
        await groVest.setStatus(false, {from: timeLock});

        const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
        await groDist.mintDao(user1, amount, false, {from: dao});
    });

    describe("Authorization", function () {
        it("Should only be possible for owner to set vester", async () => {
            await expect(groHodler.setMaintainer(dao, {from: dao})).to.eventually.be.rejectedWith(
                "caller is not the owner"
            );
            await expect(groHodler.maintainer()).to.eventually.not.be.equal(dao);
            await expect(groHodler.setMaintainer(dao, {from: deployer})).to.eventually.be.fulfilled;
            return expect(groHodler.maintainer()).to.eventually.be.equal(dao);
        });

        it("Should only be possible for maintainer to set the correctionVariable", async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await groVest.vest(true, user1, amount);
            await expect(groHodler.setCorrectionVariable(1000, {from: dao})).to.eventually.be.rejected;
            await expect(groHodler.correctionAmount()).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groHodler.setCorrectionVariable(1000, {from: deployer})).to.eventually.be.fulfilled;
            return expect(groHodler.correctionAmount()).to.eventually.be.a.bignumber.equal(toBN(1000));
        });

        it("Should only be possible for maintainer to set the claimDelay", async () => {
            await expect(groHodler.setClaimDelay(1000, {from: dao})).to.eventually.be.rejected;
            await expect(groHodler.claimDelay()).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groHodler.setClaimDelay(1000, {from: deployer})).to.eventually.be.fulfilled;
            return expect(groHodler.claimDelay()).to.eventually.be.a.bignumber.equal(toBN(1000));
        });

        it("Should only be possible for vester to add to bonus contract", async () => {
            await expect(groHodler.add(1000, {from: dao})).to.eventually.be.rejected;
        });

        it("Should only be possible for authorized to start or stop bonus contract", async () => {
            await expect(groHodler.canClaim({from: user1})).to.eventually.be.true;
            await expect(groHodler.setStatus(false, {from: dao})).to.eventually.be.rejected;
            await expect(groHodler.setStatus(true, {from: dao})).to.eventually.be.rejected;
            await expect(groHodler.setStatus(true, {from: deployer})).to.eventually.be.fulfilled;
            await expect(groHodler.canClaim({from: user1})).to.eventually.be.false;
            await expect(groHodler.setStatus(false, {from: deployer})).to.eventually.be.fulfilled;
            return expect(groHodler.canClaim({from: user1})).to.eventually.be.true;
        });
    });

    describe("Bonus", function () {
        beforeEach(async function () {
            const maxPeriod = await groVest.maxLockPeriod();
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await groVest.vest(true, user1, amount);
            await groVest.vest(true, user2, amount);
            await groVest.vest(true, user3, amount);
            const b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(maxPeriod.div(toBN(2)))
                        .toNumber(),
                ],
            });
            await network.provider.send("evm_mine");
        });

        it("Should add to the bonus contract when exiting", async () => {
            const userUnvested = await groVest.vestingBalance(user3);
            await expect(groHodler.totalBonus()).to.eventually.be.a.bignumber.equal(toBN(0));
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user3});
            return expect(groHodler.totalBonus()).to.eventually.be.a.bignumber.closeTo(userUnvested, toBN(1e18));
        });

        it("Should be able to correct the estimateGroove", async () => {
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user3});
            const userBonus = await groHodler.getPendingBonus({from: user1});
            await groHodler.setCorrectionVariable(1000, {from: deployer});
            return expect(groHodler.getPendingBonus({from: user1})).to.eventually.be.a.bignumber.gt(userBonus);
        });

        it("Should not be possible to over correct", async () => {
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user3});
            const userBonus = await groHodler.getPendingBonus({from: user1});
            return expect(
                groHodler.setCorrectionVariable(constants.MAX_UINT256, {from: deployer})
            ).to.eventually.be.rejectedWith("setCorrectionVariable: correctionAmount to large");
        });

        it("Should be possible for last user to claim all", async () => {
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user3});
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user2});
            const userBonus = await groHodler.getPendingBonus({from: user1});
            return expect(groHodler.totalBonus()).to.eventually.be.a.bignumber.equal(userBonus);
        });

        it("Should be possible to migrate to a new bonus contract", async () => {
            await groHodler.setCorrectionVariable(1000, {from: deployer});
            const newGroHodler = await GROHodler.new(groVest.address, groHodler.address);
            const oldBonus = await groHodler.totalBonus();
            const oldCorrection = await groHodler.correctionAmount();
            await expect(newGroHodler.correctionAmount()).to.eventually.be.a.bignumber.equal(oldCorrection);
            return expect(newGroHodler.totalBonus()).to.eventually.be.a.bignumber.equal(oldBonus);
        });

        it("Should be possible to make claim when there is available gro in the bonus contract", async () => {
            const userVestingBalance = await groVest.totalBalance(user1);
            // no gro, should be rejected
            await groHodler.claim(true, {from: user1});
            return expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(userVestingBalance);
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user3});
            // there is gro, should be fulfilled
            await expect(groHodler.claim(true, {from: user1})).to.eventually.be.fulfilled;
            return expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.gt(userVestingBalance);
        });

        it("Should be possible to claim instant vesting", async () => {
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user3});
            const pct = await groVest.instantUnlockPercent();
            const bGro = await gro.balanceOf(user1);
            let tx = await groHodler.claim(false, {from: user1});
            let bonus = tx.logs[1].args["amount"];
            const aGro = await gro.balanceOf(user1);
            expect(aGro.sub(bGro)).to.be.a.bignumber.closeTo(bonus.mul(pct).div(constants.PERCENT_FACTOR), toBN(0));
        });

        it("Should not add any tokens to vesting position when claiming if user has no position", async () => {
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user2});
            await expect(groHodler.getPendingBonus({from: deployer})).to.eventually.be.a.bignumber.equal(toBN(0));
            await groHodler.claim(true, {from: deployer});
            return expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
        });

        it("Should not be possible to claim anything if the contract is paused", async () => {
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user2});
            await groHodler.setStatus(true, {from: deployer});
            const userVestingBalance = await groVest.totalBalance(user1);
            await groHodler.claim(true, {from: user1});
            return expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(userVestingBalance);
        });

        it("Should not add any tokens to vesting position when claiming if user has no vesting tokens", async () => {
            const maxPeriod = await groVest.maxLockPeriod();
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user2});
            const b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(maxPeriod.div(toBN(2)))
                        .toNumber(),
                ],
            });
            await network.provider.send("evm_mine");
            await expect(groVest.vestingBalance(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groHodler.getPendingBonus({from: user1})).to.eventually.be.a.bignumber.equal(toBN(0));
            const userVestingBalance = await groVest.totalBalance(user1);
            await groHodler.claim(true, {from: user1});
            return expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(userVestingBalance);
        });

        it("Should not be possible to make multiple claims within the cooldown period", async () => {
            await expect(groHodler.setClaimDelay(1000, {from: deployer})).to.eventually.be.fulfilled;
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user2});
            await expect(groHodler.getPendingBonus({from: user1})).to.eventually.be.a.bignumber.gt(toBN(0));
            const userVestingBalanceStart = await groVest.totalBalance(user1);
            // first claim should add
            await groHodler.claim(true, {from: user1});
            await expect(groHodler.canClaim({from: user1})).to.eventually.be.false;
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.gt(userVestingBalanceStart);
            const userVestingBalancePostClaim = await groVest.totalBalance(user1);
            // second claim should not do anything
            await groHodler.claim(true, {from: user1});
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(userVestingBalancePostClaim);
            const b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(toBN(1001)).toNumber()],
            });
            await network.provider.send("evm_mine");
            // third claim post waiting time should add
            await expect(groHodler.canClaim({from: user1})).to.eventually.be.true;
            await expect(groHodler.claim(true, {from: user1})).to.eventually.be.fulfilled;
            return expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.gt(userVestingBalancePostClaim);
        });
    });
});
