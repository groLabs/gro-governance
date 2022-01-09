const { toBN } = require('web3-utils');
const GROToken = artifacts.require('GROToken');
const GRODistributer = artifacts.require('GRODistributer');
const GRODaoVesting = artifacts.require('GRODaoVesting');
const GROCommunityVesting = artifacts.require('MockVesting');
const { constants } = require('../utils/constants');
const { expect } = require('../utils/common-utils');

contract('GRODaoVesting', function (accounts) {

    const INIT_MAX_TOTAL_SUPPLY = toBN(10_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    const INIT_UNLOCKED_PERCENT = toBN(1000);
    const MAX_AMOUNT = toBN('8000000').mul(constants.DEFAULT_FACTOR);
    const MAX_AMOUNT_COMMUNITY = toBN('40000000').mul(constants.DEFAULT_FACTOR);
    const COOLDOWN = toBN('604800');

    const [deployer, groDeployer, dao, user1, user2, user3, timelock, vester1, vester2, vester3, vester4, burner ] = accounts;
    let gro, groDist, groVest, communityVester;

    beforeEach(async function () {
        gro = await GROToken.new('GRO', 'GRO', INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD);
        let b = await web3.eth.getBlock('latest');
        communityVester = await GROCommunityVesting.new();
        groVest = await GRODaoVesting.new(b.timestamp, MAX_AMOUNT, MAX_AMOUNT_COMMUNITY, dao, timelock);
        vesters = [groVest.address, vester2, vester3, communityVester.address]
        groDist = await GRODistributer.new(gro.address, vesters, burner);
        await gro.setDistributer(groDist.address);
        await groVest.setDistributer(groDist.address, {from: dao});
        await groVest.setCommunityVester(communityVester.address, {from: dao});
    })

    describe('Ownership', function () {
        it('Should only be possible for the owner to set the distributer', async () => {
            await expect(groVest.setDistributer(dao, { from: deployer })).to.eventually.be.rejectedWith('caller is not the owner');
            await expect(groVest.distributer()).to.eventually.be.not.equal(dao);
            await expect(groVest.setDistributer(dao, { from: dao })).to.eventually.be.fulfilled;
            return expect(groVest.distributer()).to.eventually.be.equal(dao);
        })

        it('Should only be possible for the owner to set the community vesting contract', async () => {
            await expect(groVest.communityVester()).to.eventually.be.equal(communityVester.address);
            await expect(groVest.setCommunityVester(dao, {from: deployer})).to.eventually.be.rejectedWith('caller is not the owner');
            await expect(groVest.setCommunityVester(dao, {from: dao})).to.eventually.be.fulfilled;
            return expect(groVest.communityVester()).to.eventually.be.equal(dao);
        })

        it('Should only be possible for owner to open up vesting position after the cooldown period', async () => {
            await expect(groVest.baseVest(dao, 1000, { from: deployer })).to.eventually.be.rejectedWith('caller is not the owner');
            await expect(groVest.totalBalance(dao)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groVest.baseVest(dao, 1000, { from: dao })).to.eventually.be.rejectedWith('vest: cannot create a vesting position yet');
            return expect(groVest.totalBalance(dao)).to.eventually.be.a.bignumber.equal(toBN(0));
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await network.provider.send("evm_mine")
            await expect(groVest.baseVest(dao, 1000, { from: deployer })).to.eventually.be.rejectedWith('caller is not the owner');
            await expect(groVest.totalBalance(dao)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groVest.baseVest(dao, 1000, { from: dao })).to.eventually.be.fulfilled;
            return expect(groVest.totalBalance(dao)).to.eventually.be.a.bignumber.equal(toBN(1000));
        })

        it('Should only be possible for owner to stop and halt vesting positions', async () => {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await network.provider.send("evm_mine")
            await expect(groVest.baseVest(user1, 1000, { from: dao })).to.eventually.be.fulfilled;
            await expect(groVest.baseVest(user2, 1000, { from: dao })).to.eventually.be.fulfilled;
            await expect(groVest.haltPosition(user1, { from: deployer })).to.eventually.be.rejectedWith('caller is not the owner');
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(toBN(1000));
            await expect(groVest.haltPosition(user1, { from: dao })).to.eventually.be.fulfilled;
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groVest.removePosition(user2, { from: deployer })).to.eventually.be.rejectedWith('caller is not the owner');
            await expect(groVest.totalBalance(user2)).to.eventually.be.a.bignumber.equal(toBN(1000));
            await expect(groVest.removePosition(user2, { from: dao })).to.eventually.be.fulfilled;
            return expect(groVest.totalBalance(user2)).to.eventually.be.a.bignumber.equal(toBN(0));
        })
    })

    describe('Custom vesting and Timelock', function () {
        it('Should not be possible to create a vesting position before the cooldown has ended', async () => {
            let b = await web3.eth.getBlock('latest');
            await expect(groVest.customVest(user2, 1000,  b.timestamp, b.timestamp, false, { from: dao })).to.eventually.be.rejectedWith('customVest: cannot create a vesting position yet')
        })

        it('Should only be possible to create a custom vesting position from behind a timelock', async () => {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await expect(groVest.customVest(user2, 1000,  b.timestamp, b.timestamp, false, { from: dao })).to.eventually.be.rejectedWith('customVest: Can only create custom vest from timelock')
            await expect(groVest.customVest(user2, 1000,  b.timestamp, b.timestamp, false, { from: timelock})).to.eventually.be.fulfilled;
        })

        it('Should not be possible to create a custom vesting position for 0x or with 0 amount vesting', async () => {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await expect(groVest.customVest(constants.ZERO_ADDRESS, 1000,  b.timestamp, b.timestamp, false, { from: timelock})).to.eventually.be.rejectedWith('customVest: !account')
            await expect(groVest.customVest(user2, 0,  b.timestamp, b.timestamp, false, { from: timelock})).to.eventually.be.rejectedWith('customVest: !amount')
        })

        it('Should not be possible to create a custom vesting position with a cliff that extends past the endDate', async () => {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await expect(groVest.customVest(user2, 1000,  toBN(b.timestamp).sub(toBN(1)), b.timestamp, false, { from: timelock})).to.eventually.be.rejectedWith('customVest: _endDate < _cliff')
        })

        it('Should not be possible to add to a custom vesting position', async () => {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await expect(groVest.customVest(user2, 1000,  b.timestamp, b.timestamp, false, { from: timelock})).to.eventually.be.fulfilled;
            await expect(groVest.customVest(user2, 1000,  b.timestamp, b.timestamp, false, { from: timelock})).to.eventually.be.rejectedWith('customVest: position already exists')
            return expect(groVest.baseVest(user2, 1000, { from: dao})).to.eventually.be.rejectedWith('vest: position already exists')
        })

        it('Should not be possible to custom vest more assets than is globally available', async () => {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await expect(groVest.customVest(user1, MAX_AMOUNT,  b.timestamp, b.timestamp, false, { from: timelock})).to.eventually.be.fulfilled;
            await expect(groVest.customVest(user2, 1,  b.timestamp, b.timestamp, false, { from: timelock})).to.eventually.be.rejectedWith('customVest: not enough assets available')
        })
    })

    describe('Custom vesting and community quota', function () {
        const amount = toBN(1000).mul(constants.DEFAULT_FACTOR);
        it('Should be possible to create a custom position using the community quota', async () => {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await expect(groVest.vestingAssets()).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groVest.vestingCommunity()).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groVest.customVest(user2, amount,  b.timestamp, b.timestamp, true, { from: timelock})).to.eventually.be.fulfilled;
            await expect(groVest.vestingAssets()).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groVest.daoPositions(user2)).to.eventually.have.property("community").that.equal(true);
            return expect(groVest.vestingCommunity()).to.eventually.be.a.bignumber.equal(amount);
        })

        it('Should not be possible to custom vest with the community quota with more assets than is globally available', async () => {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await expect(groVest.customVest(user1, MAX_AMOUNT_COMMUNITY,  b.timestamp, b.timestamp, true, { from: timelock})).to.eventually.be.fulfilled;
            return expect(groVest.customVest(user2, 1,  b.timestamp, b.timestamp, true, { from: timelock})).to.eventually.be.rejectedWith('customVest: not enough assets available')
        })

        it('Should take current community vesting positions into consideration when atempting to create a dao vesting position using the community quota', async () => {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await communityVester.vest(user1, 1);
            return expect(groVest.customVest(user2, MAX_AMOUNT_COMMUNITY,  b.timestamp, b.timestamp, true, { from: timelock})).to.eventually.be.rejectedWith('customVest: not enough assets available')
        })
    })

    describe('cliff', function () {
        beforeEach(async function () {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await network.provider.send("evm_mine")
        })

        it('Should be possible to withdraw part of the vesting position after the cliff', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await groVest.baseVest(user1, amount, { from: dao});
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
            await expect(groVest.vestingAssets()).to.eventually.be.a.bignumber.equal(amount);
            return expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(vested[0]);
        })

        it('Should not be possible to withdraw part of the vesting position before the cliff', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await groVest.baseVest(user1, amount, { from: dao });
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
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("withdrawn").that.is.a.bignumber.equal(toBN(0))
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            await expect(groVest.vestingAssets()).to.eventually.be.a.bignumber.equal(amount);
            return expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
        })
    })

    describe('vest', function () {
        beforeEach(async function () {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await network.provider.send("evm_mine")
        })

        it('Should be possible to withdraw the whole vesting position after the vesting period has finished', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await groVest.baseVest(user1, amount, { from: dao });
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
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("withdrawn").that.is.a.bignumber.equal(amount)
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("available").that.is.a.bignumber.equal(toBN(0))
            await expect(groVest.vestingAssets()).to.eventually.be.a.bignumber.equal(amount);
            // should not be able to withdraw more
            await expect(groVest.claim(1, {from: user1})).to.eventually.be.rejectedWith('claim: Not enough user assets available');
            return expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(amount);
        })

        it('Should not be possible to add to an existing position', async () => {
            let b = await web3.eth.getBlock('latest');
            await groVest.baseVest(user1, 1000, { from: dao });
            await expect(groVest.baseVest(user1, 1000, { from: dao })).to.eventually.be.rejectedWith('vest: position already exists');
            return expect(groVest.customVest(user1, 1000,  b.timestamp, b.timestamp, false, { from: timelock})).to.eventually.be.rejectedWith('customVest: position already exists')
        })

        it('Should not be possible to create an empty position', async () => {
            await expect(groVest.baseVest(user1, 0, { from: dao })).to.eventually.be.rejectedWith('vest: !amount');
        })

        it('Should not be possible to create an position for the zero address', async () => {
            await expect(groVest.baseVest(constants.ZERO_ADDRESS, 0, { from: dao })).to.eventually.be.rejectedWith('vest: !account');
        })

        it('Should not be possible to create more vest than the dao quota', async () => {
            await groVest.baseVest(user1, MAX_AMOUNT, { from: dao });
            await expect(groVest.baseVest(user2, 1, { from: dao })).to.eventually.be.rejectedWith('vest: not enough assets available');
        })

        it('Should not be possible to claim without a position', async () => {
            return expect(groVest.claim(1000, {from: user1})).to.eventually.be.rejectedWith('claim: Not enough user assets available');
        })

        it('Should be possible to create custom vesting positions with 0 vesting time', async () => {
            const amount = toBN(1000).mul(constants.DEFAULT_FACTOR);
            await expect(groVest.customVest(user2, amount,  0, 0, false, { from: timelock})).to.eventually.be.fulfilled;
            await expect(groVest.customVest(user1, amount,  0, 0, true, { from: timelock})).to.eventually.be.fulfilled;

            let b = await web3.eth.getBlock('latest');
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("endTime").that.is.a.bignumber.closeTo(toBN(b.timestamp), toBN(1));
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("cliff").that.is.a.bignumber.closeTo(toBN(b.timestamp), toBN(1));
            await expect(groVest.daoPositions(user2)).to.eventually.have.property("endTime").that.is.a.bignumber.closeTo(toBN(b.timestamp), toBN(1));
            await expect(groVest.daoPositions(user2)).to.eventually.have.property("cliff").that.is.a.bignumber.closeTo(toBN(b.timestamp), toBN(1));
            await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(toBN(0))
            await expect(gro.balanceOf(user2)).to.eventually.be.a.bignumber.equal(toBN(0))
            await expect(groVest.claim(amount, {from: user1})).to.eventually.be.fulfilled;
            await expect(groVest.claim(amount, {from:user2})).to.eventually.be.fulfilled;
            await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(amount)
            await expect(gro.balanceOf(user2)).to.eventually.be.a.bignumber.equal(amount)
        })

        it('Should be possible to create custom vesting positions with 0 vesting time but with a cliff', async () => {
            const amount = toBN(1000).mul(constants.DEFAULT_FACTOR);
            await expect(groVest.customVest(user2, amount,  100, 100, false, { from: timelock})).to.eventually.be.fulfilled;
            await expect(groVest.customVest(user1, amount,  100, 100, true, { from: timelock})).to.eventually.be.fulfilled;

            let b = await web3.eth.getBlock('latest');
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("endTime").that.is.a.bignumber.closeTo(toBN(b.timestamp).add(toBN(100)), toBN(1));
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("cliff").that.is.a.bignumber.closeTo(toBN(b.timestamp).add(toBN(100)), toBN(1));
            await expect(groVest.daoPositions(user2)).to.eventually.have.property("endTime").that.is.a.bignumber.closeTo(toBN(b.timestamp).add(toBN(100)), toBN(1));
            await expect(groVest.daoPositions(user2)).to.eventually.have.property("cliff").that.is.a.bignumber.closeTo(toBN(b.timestamp).add(toBN(100)), toBN(1));
            await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(toBN(0))
            await expect(gro.balanceOf(user2)).to.eventually.be.a.bignumber.equal(toBN(0))
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.equal(toBN(0))
            await expect(groVest.vestedBalance(user2)).to.eventually.have.property("vested").that.is.a.bignumber.equal(toBN(0))
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("total").that.is.a.bignumber.equal(amount);
            await expect(groVest.daoPositions(user2)).to.eventually.have.property("total").that.is.a.bignumber.equal(amount);
            await expect(groVest.claim(amount, {from: user1})).to.eventually.rejectedWith("claim: Not enough user assets available");
            await expect(groVest.claim(amount, {from:user2})).to.eventually.rejectedWith("claim: Not enough user assets available");
            b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(100)).toNumber()]
                });
            await network.provider.send("evm_mine")
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.equal(amount);
            await expect(groVest.vestedBalance(user2)).to.eventually.have.property("vested").that.is.a.bignumber.equal(amount);
            await expect(groVest.claim(amount, {from: user1})).to.eventually.be.fulfilled;
            await expect(groVest.claim(amount, {from:user2})).to.eventually.be.fulfilled;
            await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(amount)
            await expect(gro.balanceOf(user2)).to.eventually.be.a.bignumber.equal(amount)
        })
    })

    describe('halt and stop vest', function () {
        beforeEach(async function () {
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await network.provider.send("evm_mine")
        })

        it('Should be possible to halt a vesting position', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await expect(groVest.baseVest(user1, amount, { from: dao })).to.eventually.be.fulfilled;
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS.mul(toBN(2))).toNumber()]
                });
            await network.provider.send("evm_mine")
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.gt(toBN(0))
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.lt(amount)
            const vested = await groVest.vestedBalance(user1)
            const userTotal = await groVest.totalBalance(user1);
            const expectRemoval = userTotal.sub(vested[0]);
            const totalVesting = await groVest.vestingAssets();
            await expect(groVest.haltPosition(user1, { from: dao })).to.eventually.be.fulfilled;
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("endTime").that.is.a.bignumber.closeTo(toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS.mul(toBN(2))), toBN(2));
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.closeTo(vested[0], toBN(1E18));
            return expect(groVest.vestingAssets()).to.eventually.be.a.bignumber.closeTo(totalVesting.sub(expectRemoval), toBN(1E18));
        })

        it('Should be possible to halt a custome vesting position', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await expect(groVest.customVest(user1, amount, 1000, 500, true, { from: timelock })).to.eventually.be.fulfilled;
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(750)).toNumber()]
                });
            await network.provider.send("evm_mine")
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.gt(toBN(0))
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.lt(amount)
            const vested = await groVest.vestedBalance(user1)
            const userTotal = await groVest.totalBalance(user1);
            const expectRemoval = userTotal.sub(vested[0]);
            const totalVesting = await groVest.vestingCommunity();
            b = await web3.eth.getBlock('latest');
            await expect(groVest.haltPosition(user1, { from: dao })).to.eventually.be.fulfilled;
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("endTime").that.is.a.bignumber.closeTo(toBN(b.timestamp), toBN(2));
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.closeTo(vested[0], toBN(1E19));
            return expect(groVest.vestingCommunity()).to.eventually.be.a.bignumber.closeTo(totalVesting.sub(expectRemoval), toBN(1E19));
        })

        it('Should be possible to remove a vesting position', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await expect(groVest.baseVest(user1, amount, { from: dao })).to.eventually.be.fulfilled;
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS.mul(toBN(2))).toNumber()]
                });
            await network.provider.send("evm_mine")
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.gt(toBN(0))
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.lt(amount)
            const vested = await groVest.vestedBalance(user1)
            await groVest.claim(vested[1], {from: user1})
            const withdrawn = toBN((await groVest.daoPositions(user1)).withdrawn)
            const userTotal = await groVest.totalBalance(user1);
            const expectRemoval = userTotal.sub(withdrawn);
            const totalVesting = await groVest.vestingAssets();
            await expect(groVest.removePosition(user1, { from: dao })).to.eventually.be.fulfilled;
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("endTime").that.is.a.bignumber.equal(toBN(0));
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
            return expect(groVest.vestingAssets()).to.eventually.be.a.bignumber.equal(totalVesting.sub(expectRemoval));
        })

        it('Should be possible to remove a custom vesting position', async () => {
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await expect(groVest.customVest(user1, amount, 1000, 500, true, { from: timelock })).to.eventually.be.fulfilled;
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(750)).toNumber()]
                });
            await network.provider.send("evm_mine")
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.gt(toBN(0))
            await expect(groVest.vestedBalance(user1)).to.eventually.have.property("vested").that.is.a.bignumber.lt(amount)
            const vested = await groVest.vestedBalance(user1)
            await groVest.claim(vested[1], {from: user1})
            const withdrawn = toBN((await groVest.daoPositions(user1)).withdrawn)
            const userTotal = await groVest.totalBalance(user1);
            const expectRemoval = userTotal.sub(withdrawn);
            const totalVesting = await groVest.vestingCommunity();
            await expect(groVest.removePosition(user1, { from: dao })).to.eventually.be.fulfilled;
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("endTime").that.is.a.bignumber.equal(toBN(0));
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
            return expect(groVest.vestingCommunity()).to.eventually.be.a.bignumber.equal(totalVesting.sub(expectRemoval));
        })

        it('Should not be possible to halt or remove a users position before it exists', async () => {
            await expect(groVest.daoPositions(user1)).to.eventually.have.property("startTime").that.is.a.bignumber.equal(toBN(0))
            await expect(groVest.haltPosition(user1, { from: dao })).to.eventually.be.rejectedWith('haltPosition: no position for user');
            return expect(groVest.removePosition(user1, { from: dao })).to.eventually.be.rejectedWith('removePosition: no position for user');

        })

        it('Should be possible to withdraw up to the currently vested amount (minus previous withdrawals) from a stopped position', async () => {
            await groVest.baseVest(user1, 1000, { from: dao });
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS.mul(toBN(2))).toNumber()]
                });
            await network.provider.send("evm_mine")
            const vested = await groVest.vestedBalance(user1)
            await groVest.haltPosition(user1, { from: dao })
            await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(vested[0]);
            await expect(groVest.claim(vested[0].add(toBN(1)), {from: user1})).to.eventually.be.rejectedWith('claim: Not enough user assets available');
            await expect(groVest.claim(vested[0], {from: user1})).to.eventually.be.fulfilled;
            await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(vested[0]);
            await expect(groVest.claim(toBN(1), {from: user1})).to.eventually.be.rejectedWith('claim: Not enough user assets available');
            return expect(groVest.vestedBalance(user1)).to.eventually.have.property("available").that.is.a.bignumber.equal(toBN(0))
        })

        it('Should be possbile to remove a vesting positiong', async () => {
        })

        it('Should return the correct amount to the global position when halting or stopping a vesting positiong', async () => {
        })
    })

    describe('Other', function () {
        it('Should correctly add to DAO and Community quotas/withdrawals', async () => {
            const amount = toBN(1000).mul(constants.DEFAULT_FACTOR);
            let b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(COOLDOWN).toNumber()]
                });
            await network.provider.send("evm_mine")
            await expect(groVest.vestingAssets()).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(groVest.vestingCommunity()).to.eventually.be.a.bignumber.equal(toBN(0));

            await communityVester.vest(user1, amount);
            await communityVester.vest(user2, amount);

            await expect(groVest.customVest(user1, amount,  1000, 0, true, { from: timelock})).to.eventually.be.fulfilled;
            await expect(groVest.customVest(user2, amount,  1000, 0, false, { from: timelock})).to.eventually.be.fulfilled;
            await expect(groVest.baseVest(user3, amount, { from: dao})).to.eventually.be.fulfilled;

            await expect(groVest.vestingAssets()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(2)));
            await expect(groVest.vestingCommunity()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(3)));

            b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(500)).toNumber()]
                });
            await network.provider.send("evm_mine")

            const vestedUser1 = await groVest.vestedBalance(user1)
            const vestedUser2 = await groVest.vestedBalance(user2)
            await groVest.claim(vestedUser1[0], {from: user1});
            await groVest.claim(vestedUser2[0], {from: user2});
            await expect(groVest.vestingAssets()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(2)));
            await expect(groVest.vestingCommunity()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(3)));

            const user1Total = await groVest.totalBalance(user1);
            const expectRemovalCommunity = user1Total.sub(vestedUser1[0]);
            const totalVestingCommunity = await groVest.vestingCommunity();
            await expect(groVest.haltPosition(user1, { from: dao })).to.eventually.be.fulfilled;
            await expect(groVest.vestingCommunity()).to.eventually.be.a.bignumber.closeTo(totalVestingCommunity.sub(expectRemovalCommunity), toBN(5E18));

            const user2Total = await groVest.totalBalance(user2);
            const expectRemoval = user2Total.sub(vestedUser2[0]);
            const totalVesting = await groVest.vestingAssets();
            await expect(groVest.haltPosition(user2, { from: dao })).to.eventually.be.fulfilled;
            return expect(groVest.vestingAssets()).to.eventually.be.a.bignumber.closeTo(totalVesting.sub(expectRemoval), toBN(5E18));
        })

        it('Should be possible to see globally Available assets for dao QUOTA', async () => {
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
            await groVest.baseVest(user1, amount, { from: dao });
            await expect(groVest.globallyUnlocked()).to.eventually.have.property("vesting").that.is.a.bignumber.equal(amount);
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
            return expect(groVest.globallyUnlocked()).to.eventually.have.property("unlocked").that.is.a.bignumber.equal(MAX_AMOUNT);
        })
    })
})
