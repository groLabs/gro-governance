const { toBN } = require('web3-utils');
const GROToken = artifacts.require('GROToken');
const GRODistributer = artifacts.require('GRODistributer');
const GROVesting = artifacts.require('GROVesting');
const AirDrop = artifacts.require('AirDrop');
const { constants } = require('../utils/constants');
const { expect } = require('../utils/common-utils');

contract('AirDrop', function (accounts) {

    const [deployer, dao] = accounts;
    const root = '0x0123456789abcde0000000000000000000000000000000000000000000000000';
    let airDrop;

    beforeEach(async function () {
        airDrop = await AirDrop.new();
    })

    describe('Ownership', function () {
        it('setVesting revert !Ownership', async () => {
            return expect(airDrop.setVesting(constants.ZERO_ADDRESS, { from: dao })).to.eventually.be.rejectedWith('caller is not the owner');
        })
    })

    describe('newDrop', function () {
        it('revert !Ownership', async () => {
            return expect(airDrop.newDrop(constants.ZERO_BYTES32, 0, true, { from: dao })).to.eventually.be.rejectedWith('caller is not the owner');
        })

        it('ok', async () => {
            const amount = toBN(1_000_000).mul(constants.DEFAULT_FACTOR);
            await airDrop.newDrop(root, amount, true);
            const d = await airDrop.drops(0);
            expect(d.root).equal(root);
            expect(d.total).be.a.bignumber.equal(amount);
            expect(d.remaining).be.a.bignumber.equal(amount);

            await expect(airDrop.tranches()).to.eventually.be.a.bignumber.equal(toBN(1));

            return;
        })
    })

    describe('expireDrop', function () {
        it('revert !Ownership', async () => {
            return expect(airDrop.expireDrop(0, { from: dao })).to.eventually.be.rejectedWith('caller is not the owner');
        })

        it('revert !trancheId', async () => {
            return expect(airDrop.expireDrop(0)).to.eventually.be.rejectedWith('expireDrop: !trancheId');
        })

        it('ok', async () => {
            const amount = toBN(1_000_000).mul(constants.DEFAULT_FACTOR);
            await airDrop.newDrop(root, amount, true);
            await airDrop.expireDrop(0);

            const d = await airDrop.drops(0);
            expect(d.root).equal(constants.ZERO_BYTES32);

            return;
        })
    })

    describe('verifyDrop', function () {
        it('revert !trancheId', async () => {
            return expect(airDrop.verifyDrop(0, 0, [constants.ZERO_BYTES32])).to.eventually.be.rejectedWith('verifyDrop: !trancheId');
        })

        it('revert Drop expired', async () => {
            const amount = toBN(1_000_000).mul(constants.DEFAULT_FACTOR);
            await airDrop.newDrop(root, amount, true);
            await airDrop.expireDrop(0);

            return expect(airDrop.verifyDrop(0, 0, [constants.ZERO_BYTES32])).to.eventually.be.rejectedWith('verifyDrop: Drop expired');
        })

        it('revert Not enough remaining', async () => {
            const amount = toBN(1_000_000).mul(constants.DEFAULT_FACTOR);
            await airDrop.newDrop(root, amount, true);

            return expect(airDrop.verifyDrop(0, amount.add(toBN(1)), [constants.ZERO_BYTES32])).to.eventually.be.rejectedWith('verifyDrop: Not enough remaining');
        })

        it('false', async () => {
            const amount = toBN(1_000_000).mul(constants.DEFAULT_FACTOR);
            await airDrop.newDrop(root, amount, true);

            const result = await airDrop.verifyDrop(0, toBN(1000), [constants.ZERO_BYTES32]);
            expect(result).equal(false);

            return;
        })
    })

    describe('claim', function () {
        it('revert !trancheId', async () => {
            return expect(airDrop.claim(true, 0, 0, [constants.ZERO_BYTES32])).to.eventually.be.rejectedWith('claim: !trancheId');
        })

        it('revert Drop expired', async () => {
            const amount = toBN(1_000_000).mul(constants.DEFAULT_FACTOR);
            await airDrop.newDrop(root, amount, true);
            await airDrop.expireDrop(0);

            return expect(airDrop.claim(true, 0, 0, [constants.ZERO_BYTES32])).to.eventually.be.rejectedWith('claim: Drop expired');
        })

        it('revert Not enough remaining', async () => {
            const amount = toBN(1_000_000).mul(constants.DEFAULT_FACTOR);
            await airDrop.newDrop(root, amount, true);

            return expect(airDrop.claim(true, 0, amount.add(toBN(1)), [constants.ZERO_BYTES32])).to.eventually.be.rejectedWith('claim: Not enough remaining');
        })

        it('revert Invalid proof', async () => {
            const amount = toBN(1_000_000).mul(constants.DEFAULT_FACTOR);
            await airDrop.newDrop(root, amount, true);

            return expect(airDrop.claim(true, 0, toBN(1000), [constants.ZERO_BYTES32])).to.eventually.be.rejectedWith('claim: Invalid proof');
        })
    })
})