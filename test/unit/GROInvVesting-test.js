const { toBN } = require('web3-utils');
const GROToken = artifacts.require('GROToken');
const GRODistributer = artifacts.require('GRODistributer');
const GROInvVesting = artifacts.require('GROInvVesting');
const GROCommunityVesting = artifacts.require('MockVesting');
const { constants } = require('../utils/constants');
const { expect } = require('../utils/common-utils');

contract('GROInvVesting', function (accounts) {

    const INIT_MAX_TOTAL_SUPPLY = toBN(10_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    const INIT_UNLOCKED_PERCENT = toBN(1000);
    const MAX_AMOUNT = toBN('19490577').mul(constants.DEFAULT_FACTOR);

    const [deployer, groDeployer, dao, user1, user2, user3, vester1, vester2, vester3, vester4, burner ] = accounts;
    let gro, groDist, groInvVest;

    beforeEach(async function () {
        gro = await GROToken.new('GRO', 'GRO', INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD);
        let b = await web3.eth.getBlock('latest');
        communityVester = await GROCommunityVesting.new();
        groVest = await GROInvVesting.new((await web3.eth.getBlock('latest')).timestamp, MAX_AMOUNT);
        vesters = [vester1, groVest.address, vester3, communityVester.address]
        groDist = await GRODistributer.new(gro.address, vesters, burner);
        await gro.setDistributer(groDist.address);
        await groVest.setDistributer(groDist.address);
    })

    describe('Ownership', function () {
        it('Should only be possible for the owner to set the distributer', async () => {
            await expect(groVest.setDistributer(dao, { from: dao })).to.eventually.be.rejectedWith('caller is not the owner');
            await expect(groVest.distributer()).to.eventually.be.not.equal(dao);
            await expect(groVest.setDistributer(dao, { from: deployer })).to.eventually.be.fulfilled;
            return expect(groVest.distributer()).to.eventually.be.equal(dao);
        })

        it('Should only be possible for owner to open up vesting position', async () => {
            await expect(groVest.vest(dao, 0, 1000, { from: dao })).to.eventually.be.rejectedWith('caller is not the owner');
            await expect(groVest.totalBalance(dao)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groVest.vest(dao, 0, 1000, { from: deployer })).to.eventually.be.fulfilled;
            return expect(groVest.totalBalance(dao)).to.eventually.be.a.bignumber.equal(toBN(1000));
        })
    })

    describe('cliff', function () {
        it('Should be possible to withdraw part of the vesting position after the cliff', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await groVest.vest(user1, 0, amount, { from: deployer });
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.equal(toBN(0))
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);

            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS.mul(toBN(2))).toNumber()]
                });
            await network.provider.send("evm_mine")
            // ~ 2/3 is vested
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.gt(toBN(0))
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.lt(amount)
            // Balance hasnt changed
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            const vested = await groVest.vestedBalance(user1)
            // vested and available are the same prior to claim
            assert.strictEqual(vested[0].toString(), vested[1].toString());
            await groVest.claim(vested[0], {from: user1});
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.gt(toBN(0))
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.lt(amount)
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            return expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(vested[0]);
        })

        it('Should not be possible to withdraw part of the vesting position before the cliff', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await groVest.vest(user1, 0, amount, { from: deployer });
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.equal(toBN(0))
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);

            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS.div(toBN(2))).toNumber()]
                });
            await network.provider.send("evm_mine")
            // before cliff nothing should be vested
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.equal(toBN(0))
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            const vested = await groVest.vestedBalance(user1)
            await expect(groVest.claim(1, {from: user1})).to.eventually.be.rejectedWith('claim: Not enough user assets available');
            await expect(groVest.claim(vested[0], {from: user1})).to.eventually.be.rejectedWith('claim: No amount specified');
            await expect(groVest.claim(10, {from: user1})).to.eventually.be.rejectedWith('claim: Not enough user assets available');
            await expect(groVest.investorPositions(user1)).to.eventually.have.property("withdrawn").that.is.a.bignumber.equal(toBN(0))
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            return expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
        })
    })

    describe('vest', function () {
        it('Should be possible to withdraw the whole vesting position after the vesting period has finished has finished', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await groVest.vest(user1, 0, amount, { from: deployer });
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.equal(toBN(0))
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);

            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS.mul(toBN(3))).toNumber()]
                });
            await network.provider.send("evm_mine")
            // all should be vested
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.equal(amount)
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            // vested and available are the same prior to claim
            const vested = await groVest.vestedBalance(user1)
            assert.strictEqual(vested[0].toString(), vested[1].toString());
            await groVest.claim(vested[0], {from: user1});
            await expect(groVest.investorPositions(user1)).to.eventually.have.property("withdrawn").that.is.a.bignumber.equal(amount)
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("available").that.is.a.bignumber.equal(toBN(0))
            // should not be able to withdraw more
            await expect(groVest.claim(1, {from: user1})).to.eventually.be.rejectedWith('claim: Not enough user assets available');
            return expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(amount);
        })

        it('Should not be possible to add to an existing position', async () => {
            await groVest.vest(user1, 0, 1000, { from: deployer });
            await expect(groVest.vest(user1, 0, 1000, { from: deployer })).to.eventually.be.rejectedWith('vest: position already exists');
        })

        it('Should not be possible to create an empty position', async () => {
            await expect(groVest.vest(user1, 0, 0, { from: deployer })).to.eventually.be.rejectedWith('vest: !amount');
        })

        it('Should not be possible to create an position for the zero address', async () => {
            await expect(groVest.vest(constants.ZERO_ADDRESS, 0, 0, { from: deployer })).to.eventually.be.rejectedWith('vest: !account');
        })

        it('Should not be possible to create more vest than the investor quota', async () => {
            await groVest.vest(user1, 0, MAX_AMOUNT, { from: deployer });
            await expect(groVest.vest(user2, 0, 1, { from: deployer })).to.eventually.be.rejectedWith('vest: not enough assets available');
        })

        it('Should not be possible to claim without a position', async () => {
            await expect(groVest.claim(1000, {from: user1})).to.eventually.be.rejectedWith('claim: Not enough user assets available')
        })
    })

    describe('other', function () {
        it('Should be possible to see globaly Available assets', async () => {
            await expect(groVest.globallyUnlocked()).to.eventually.have.property("unlocked").that.is.a.bignumber.closeTo(toBN(0), toBN(1E18));
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS.mul(toBN(2))).toNumber()]
                });
            await network.provider.send("evm_mine")
            await expect(groVest.globallyUnlocked()).to.eventually.have.property("unlocked").that.is.a.bignumber.gt(toBN(0));
            await expect(groVest.globallyUnlocked()).to.eventually.have.property("unlocked").that.is.a.bignumber.lt(MAX_AMOUNT);
            await expect(groVest.globallyUnlocked()).to.eventually.have.property("vesting").that.is.a.bignumber.equal(toBN(0));
            const globalAssets = await groVest.globallyUnlocked();
            // unlocked should equal available
            assert.strictEqual(globalAssets[0].toString(), globalAssets[2].toString());

            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await groVest.vest(user1, 0, amount, { from: deployer });
            await expect(groVest.globallyUnlocked()).to.eventually.have.property("vesting").that.is.a.bignumber.equal(amount);
            await expect(groVest.globallyUnlocked()).to.eventually.have.property("available").that.is.a.bignumber.closeTo(globalAssets[2], amount);
            b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS.mul(toBN(2))).toNumber()]
                });
            await network.provider.send("evm_mine")
            await expect(groVest.globallyUnlocked()).to.eventually.have.property("unlocked").that.is.a.bignumber.equal(MAX_AMOUNT);
            await expect(groVest.globallyUnlocked()).to.eventually.have.property("available").that.is.a.bignumber.closeTo(MAX_AMOUNT.sub(amount), toBN(1E18));
            const vested = await groVest.vestedBalance(user1)
            await groVest.claim(vested[0], {from: user1});
            await expect(groVest.globallyUnlocked()).to.eventually.have.property("unlocked").that.is.a.bignumber.equal(MAX_AMOUNT);
            return expect(groVest.globallyUnlocked()).to.eventually.have.property("available").that.is.a.bignumber.closeTo(MAX_AMOUNT.sub(amount), toBN(1E18));
        })

        it('Should be possible to set an earlier vesting start time', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            let b = await web3.eth.getBlock('latest');
            await groVest.vest(user1, toBN(b.timestamp).sub(toBN(1000)), amount, { from: deployer });
            return expect(groVest.investorPositions(user1)).to.eventually.have.property("startTime").that.is.a.bignumber.lt(toBN(b.timestamp));
        })

        it('should not be possible to set an start time earlier than 3 weeks prior to now', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            let b = await web3.eth.getBlock('latest');
            await groVest.vest(user1, toBN(b.timestamp).sub(toBN(10000000)), amount, { from: deployer });
            return expect(groVest.investorPositions(user1)).to.eventually.have.property("startTime").that.is.a.bignumber.equal(toBN(b.timestamp).add(toBN(1)));
        })

        it('User positions should reduce globally available', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS.mul(toBN(2))).toNumber()]
                });
            await network.provider.send("evm_mine")
            const available = (await groVest.globallyUnlocked()).available;
            await groVest.vest(user1, 0, amount, {from: deployer});
            return expect(groVest.globallyUnlocked()).to.eventually.have.property("available").that.is.a.bignumber.closeTo(toBN(available).sub(amount), toBN(1E18));
        })
    })
})
