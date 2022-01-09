const { toBN } = require('web3-utils');
const GROToken = artifacts.require('GROToken');
const GRODistributer = artifacts.require('GRODistributer');
const MockVesting = artifacts.require('MockVesting');
const MockBurner = artifacts.require('MockBurner');
const { constants } = require('../utils/constants');
const { expect } = require('../utils/common-utils');

contract('GRODistributer', function (accounts) {
    const [deployer, groDeployer, dao, vester1, vester2, vester3, vester4 ] = accounts;

    const INIT_MAX_TOTAL_SUPPLY = toBN(100_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    const COMMUNITY_QUOTA = toBN(45_000_000).mul(constants.DEFAULT_FACTOR);
    const INVESTOR_QUOTA = toBN(19_490_577).mul(constants.DEFAULT_FACTOR);
    const TEAM_QUOTA = toBN(22_509_423).mul(constants.DEFAULT_FACTOR);
    const DAO_QUOTA = toBN(8_000_000).mul(constants.DEFAULT_FACTOR);

    let gro, groDist, burner, mockVester;

    beforeEach(async function () {
        gro = await GROToken.new('GRO', 'GRO', INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD, { from: groDeployer });
        vesters = [vester1, vester2, vester3, vester4]
        mockVester = await MockVesting.new();
        burner = await MockBurner.new()
        // console.log('nonce: ', nonce);
        // console.log('groDistAddress: ', groDistAddress);
        groDist = await GRODistributer.new(gro.address, vesters, burner.address);
        await gro.setDistributer(groDist.address, { from: groDeployer });
        await burner.setDependencies(groDist.address, mockVester.address, gro.address);
        // console.log('groDist.address: ', groDist.address);
    })

    describe('Quota', function () {
        it('investor', async () => {
            return expect(groDist.INVESTOR_QUOTA()).to.eventually.be.a.bignumber.equal(INVESTOR_QUOTA);
        })

        it('team', async () => {
            return expect(groDist.TEAM_QUOTA()).to.eventually.be.a.bignumber.equal(TEAM_QUOTA);
        })

        it('COMMUNITY', async () => {
            return expect(groDist.COMMUNITY_QUOTA()).to.eventually.be.a.bignumber.equal(COMMUNITY_QUOTA);
        })

        it('DAO', async () => {
            return expect(groDist.DAO_QUOTA()).to.eventually.be.a.bignumber.equal(DAO_QUOTA);
        })
    })

    describe('mint', function () {
        it('Should only be possible for the vesters to mint', async () => {
            await expect(groDist.mint(deployer, 0)).to.eventually.be.rejectedWith('mint: msg.sender != vester');
            const amount = toBN(100);
            await expect(groDist.mintDao(deployer, amount, false, {from: vester1})).to.eventually.be.fulfilled;
            await expect(groDist.mintingPools(vester1)).to.eventually.be.a.bignumber.equal(DAO_QUOTA.sub(amount))
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(amount)

            await expect(groDist.mintDao(deployer, amount, true, {from: vester1})).to.eventually.be.fulfilled;
            await expect(groDist.mintingPools(vester4)).to.eventually.be.a.bignumber.equal(COMMUNITY_QUOTA.sub(amount))
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(amount.mul(toBN(2)))

            await expect(groDist.mint(deployer, amount, {from: vester2})).to.eventually.be.fulfilled;
            await expect(groDist.mintingPools(vester2)).to.eventually.be.a.bignumber.equal(INVESTOR_QUOTA.sub(amount))
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(amount.mul(toBN(3)))

            await expect(groDist.mint(deployer, amount, {from: vester3})).to.eventually.be.fulfilled;
            await expect(groDist.mintingPools(vester3)).to.eventually.be.a.bignumber.equal(TEAM_QUOTA.sub(amount))
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(amount.mul(toBN(4)))

            await expect(groDist.mint(deployer, amount, {from: vester4})).to.eventually.be.fulfilled;
            await expect(groDist.mintingPools(vester4)).to.eventually.be.a.bignumber.equal(COMMUNITY_QUOTA.sub(amount.mul(toBN(2))))
            return expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(amount.mul(toBN(5)))
        })

        it('revert dao vester should not be able to mint through the normal mint function', async () => {
            await groDist.mint(deployer, constants.DEFAULT_FACTOR, {from: vester2});
            return expect(groDist.mint(deployer, 1000, {from: vester1})).to.eventually.be.rejectedWith('mint: msg.sender != vester');
        })

        it('Should be possible for any of the vesters to mint', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await groDist.mint(deployer, amount, {from: vester4});
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(amount);
            const expectedAmount = COMMUNITY_QUOTA.sub(amount);
            return expect(groDist.mintingPools(vester4)).to.eventually.be.a.bignumber.equal(expectedAmount);
        })

        it('Should not be possible to exceed the quota for a given pool', async () => {
            const amount = TEAM_QUOTA;
            await groDist.mint(deployer, amount, {from: vester3});
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(amount);
            const expectedAmount = TEAM_QUOTA.sub(amount);
            await expect(groDist.mintingPools(vester3)).to.eventually.be.a.bignumber.equal(expectedAmount);
            return expect(groDist.mint(deployer, 1, {from: vester3})).to.eventually.be.rejected;
        })

        it('Should only be possibe for the DAO_VESTER to mint via the mintDao function', async () => {
            await expect(groDist.mintDao(deployer, COMMUNITY_QUOTA, true, {from: vester4})).to.eventually.be.rejectedWith('mintDao: msg.sender != DAO_VESTER');
            return expect(groDist.mintDao(deployer, COMMUNITY_QUOTA, false, {from: vester2})).to.eventually.be.rejectedWith('mintDao: msg.sender != DAO_VESTER');
        })

        it('Be possible for the dao vester to mint from community and dao qouta', async () => {
            await groDist.mintDao(deployer, COMMUNITY_QUOTA, true, {from: vester1});
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(COMMUNITY_QUOTA);
            await expect(groDist.mintingPools(vester4)).to.eventually.be.a.bignumber.equal(toBN(0));
            await groDist.mintDao(deployer, DAO_QUOTA, false, {from: vester1});
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(COMMUNITY_QUOTA.add(DAO_QUOTA));
            return expect(groDist.mintingPools(vester1)).to.eventually.be.a.bignumber.equal(toBN(0));
        })

        it('Should not be possible for the DAO_VESTER to exceed the quota for its own or the community quota', async () => {
            await groDist.mintDao(deployer, COMMUNITY_QUOTA, true, {from: vester1});
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(COMMUNITY_QUOTA);
            await expect(groDist.mintingPools(vester4)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groDist.mintDao(deployer, 1, true, {from: vester1})).to.eventually.be.rejected;
            await groDist.mintDao(deployer, DAO_QUOTA, false, {from: vester1});
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(COMMUNITY_QUOTA.add(DAO_QUOTA));
            await expect(groDist.mintingPools(vester1)).to.eventually.be.a.bignumber.equal(toBN(0));
            return expect(groDist.mintDao(deployer, 1, false, {from: vester1})).to.eventually.be.rejected;
        })

    })

    describe('burn', function () {
        it('Should only be possible for burner to call burn', async () => {
            return expect(groDist.burn(1000)).to.eventually.be.rejectedWith('burn: msg.sender != BURNER');
        })

        it('Should not be possible to burn more token than held by burner', async () => {
            await groDist.mint(groDeployer, toBN(1000).mul(constants.DEFAULT_FACTOR), {from: vester2});
            await expect(groDist.burn(groDeployer, toBN(10000).mul(constants.DEFAULT_FACTOR)), {from: burner}).to.eventually.be.rejected;
        })

        it('Should increase community quota when bruning', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await groDist.mint(groDeployer, amount, {from: vester4});
            const expectedAmount = COMMUNITY_QUOTA.sub(amount);
            await expect(groDist.mintingPools(vester4)).to.eventually.be.a.bignumber.equal(expectedAmount);
            await gro.approve(burner.address, amount, {from: groDeployer});
            await burner.burn(amount.div(toBN(4)), { from: groDeployer});
            await expect(gro.balanceOf(groDeployer)).to.eventually.be.a.bignumber.equal(amount.mul(toBN(3)).div(toBN(4)));
            const expectedAmountPostBurn = COMMUNITY_QUOTA.sub(amount.mul(toBN(3)).div(toBN(4)));
            return expect(groDist.mintingPools(vester4)).to.eventually.be.a.bignumber.equal(expectedAmountPostBurn);
        })
    })
})
