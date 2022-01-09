const {toBN} = require("web3-utils");
const GROToken = artifacts.require("GROToken");
const GRODistributer = artifacts.require("GRODistributer");
const GROVesting = artifacts.require("GROVesting");
const GROBurner = artifacts.require("GROBurner");
const {constants} = require("../utils/constants");
const {expect} = require("../utils/common-utils");

contract("GROBurner", function (accounts) {
    const INIT_MAX_TOTAL_SUPPLY = toBN(10_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    const INIT_UNLOCKED_PERCENT = toBN(1000);

    const [deployer, groDeployer, dao, user1, user2, user3, timeLock] = accounts;
    let gro, groDist, groVest, groBurner;

    beforeEach(async function () {
        gro = await GROToken.new("GRO", "GRO", INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD, {from: groDeployer});
        groVest = await GROVesting.new(constants.ZERO_ADDRESS, timeLock);
        vesters = [dao, deployer, groDeployer, groVest.address];
        groBurner = await GROBurner.new(groVest.address, gro.address);
        groDist = await GRODistributer.new(gro.address, vesters, groBurner.address);
        await groVest.setDistributer(groDist.address);
        await groBurner.setDistributer(groDist.address);
        await gro.setDistributer(groDist.address, {from: groDeployer});

        groVest.setVester(deployer, true);
        groVest.setVester(groBurner.address, true);

        await groVest.setStatus(false, {from: timeLock});

        const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
        await groDist.mintDao(user1, amount, false, {from: dao});
    });

    describe("Ownership", function () {
        it("Should only be possible for owner to set vester", async () => {
            await expect(groBurner.setVester(constants.ZERO_ADDRESS, {from: dao})).to.eventually.be.rejectedWith(
                "caller is not the owner"
            );
            await expect(groBurner.vester()).to.eventually.not.be.equal(dao);
            await expect(groBurner.setVester(dao, {from: deployer})).to.eventually.be.fulfilled;
            await expect(groBurner.vester()).to.eventually.be.equal(dao);
        });

        it("Should only be possible for owner to set distributer", async () => {
            await expect(groBurner.setDistributer(constants.ZERO_ADDRESS, {from: dao})).to.eventually.be.rejectedWith(
                "caller is not the owner"
            );
            await expect(groBurner.distributer()).to.eventually.not.be.equal(dao);
            await expect(groBurner.setDistributer(dao, {from: deployer})).to.eventually.be.fulfilled;
            await expect(groBurner.distributer()).to.eventually.be.equal(dao);
        });
    });

    describe("burner", function () {
        beforeEach(async function () {
            gro.approve(groBurner.address, constants.MAX_UINT256, {from: user1});
        });

        it("Should be possible to revest tokens", async () => {
            const vestingAmount = await groVest.totalBalance(user1);
            const balance = await gro.balanceOf(user1);
            await groBurner.reVest(balance.div(toBN(2)), {from: user1});
            await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.closeTo(balance.div(toBN(2)), toBN(1e18));
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(balance.div(toBN(2)));
            await groBurner.reVest(await gro.balanceOf(user1), {from: user1});
            await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(balance);
        });

        it("Should not be possible to revest more tokens than the user has", async () => {
            const balance = await gro.balanceOf(user1);
            return expect(groBurner.reVest(balance.mul(toBN(2))), {from: user1}).to.eventually.be.rejected;
        });
    });
});
