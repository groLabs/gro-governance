const { toBN, toWei, toHex } = require('web3-utils');
const VoteAggregator = artifacts.require('VoteAggregatorV1');
const Staker = artifacts.require('LPTokenStakerV1');
const GROVesting = artifacts.require('GROVestingV1');
const GROEmpVesting = artifacts.require('GROEmpVesting');
const GROInvVesting = artifacts.require('GROInvVesting');
const IERC20 = artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20');
const IUniswapV2Router01 = artifacts.require('IUniswapV2Router01');
const IBalancerV2 = artifacts.require('IBalancerV2');
const { constants } = require('../utils/constants');
const { expect } = require('../utils/common-utils');

contract('Smoke Aggregator tests', function (accounts) {

    const GRO_WEIGHT = constants.PERCENT_FACTOR;
    const LOCKED_WEIGHT = constants.PERCENT_FACTOR.mul(toBN(2));
    const UNLOCKED_WEIGHT = constants.PERCENT_FACTOR.mul(toBN(3)).div(toBN(2));
    const GVT_WEIGHT = constants.PERCENT_FACTOR.mul(toBN(7)).div(toBN(10));
    const USDC_WEIGHT = constants.PERCENT_FACTOR.div(toBN(2));
    const ETH_WEIGHT = constants.PERCENT_FACTOR.div(toBN(2));

    const GRO_TOKEN_ADDRESS = '0x3Ec8798B81485A254928B70CDA1cf0A2BB0B74D7';
    const GRO_MAIN_VESTING_ADDRESS = '0xA28693bf01Dc261887b238646Bb9636cB3a3730B';
    const GRO_EMP_VESTING_ADDRESS = '0xCa71e66866eB9ae67bd5F3Ab50B06Abd188F33C7';
    const GRO_INV_VESTING_ADDRESS = '0x90D58911e49e6Db40Db44B476E1Ca268e1e2AD7b';
    const GRO_STAKER_ADDRESS = '0x001C249c09090D79Dc350A286247479F08c7aaD7';

    const OWNER1 = '0x359f4fe841f246a095a82cb26f5819e10a91fe0d';
    const OWNER2 = '0xba5edf9dad66d9d81341eef8131160c439dba91b';

    const impersonateAccounts = [OWNER1, OWNER2];

    const GVT_ADDRESS = '0x3ADb04E127b9C0a5D36094125669d4603AC52a0c';
    const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

    const GRO_SLOT = '0x0';
    const GVT_SLOT = '0x0';
    const USDC_SLOT = '0x9';
    const WETH_SLOT = '0x3';

    const TokenMappingSlots = {};

    const [deployer, user, user2] = accounts;
    let aggregator, gro, gvt, usdc, weth, unirouter, uniGVTGROPool, uniGROUSDCPool,
        mainV, empV, invV, balV2, balGROWETHPool;

    async function setBalance(tokenAddr, to, amount) {
        let slot = ethers.utils.hexStripZeros(
            ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(['address', 'uint256'], [to, TokenMappingSlots[tokenAddr]])));
        await hre.ethers.provider.send('hardhat_setStorageAt', [tokenAddr, slot, amount]);
    }

    async function impersonate() {
        for (let i = 0; i < impersonateAccounts.length; i++) {
            let account = impersonateAccounts[i];
            await hre.network.provider.request(
                {
                    method: "hardhat_impersonateAccount",
                    params: [account]
                });
            await network.provider.send("hardhat_setBalance", [
                account,
                toHex(toWei('2', 'ether')),
            ]);
            console.log(`hardhat_impersonateAccount: ` + account);
        }
    }

    let sId;

    beforeEach(async function () {
        aggregator = await VoteAggregator.new(
            GRO_TOKEN_ADDRESS,
            GRO_MAIN_VESTING_ADDRESS, GRO_EMP_VESTING_ADDRESS, GRO_INV_VESTING_ADDRESS,
            GRO_STAKER_ADDRESS);

        await aggregator.setGroWeight(GRO_WEIGHT);
        await aggregator.setVestingWeight(GRO_MAIN_VESTING_ADDRESS, LOCKED_WEIGHT, UNLOCKED_WEIGHT);
        await aggregator.setVestingWeight(GRO_EMP_VESTING_ADDRESS, LOCKED_WEIGHT, UNLOCKED_WEIGHT);
        await aggregator.setVestingWeight(GRO_INV_VESTING_ADDRESS, LOCKED_WEIGHT, UNLOCKED_WEIGHT);

        await aggregator.addUniV2Pool('0x2ac5bC9ddA37601EDb1A5E29699dEB0A5b67E9bB',
            [GVT_WEIGHT, GRO_WEIGHT],
            1);
        await aggregator.addUniV2Pool('0x21C5918CcB42d20A2368bdCA8feDA0399EbfD2f6',
            [GRO_WEIGHT, USDC_WEIGHT],
            2);
        await aggregator.addBalV2Pool('0x702605f43471183158938c1a3e5f5a359d7b31ba',
            [GRO_WEIGHT, ETH_WEIGHT],
            5);

        gro = await IERC20.at(GRO_TOKEN_ADDRESS);
        gvt = await IERC20.at(GVT_ADDRESS);
        usdc = await IERC20.at(USDC_ADDRESS);
        weth = await IERC20.at(WETH_ADDRESS);

        unirouter = await IUniswapV2Router01.at('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');
        uniGVTGROPool = await IERC20.at('0x2ac5bC9ddA37601EDb1A5E29699dEB0A5b67E9bB');
        uniGROUSDCPool = await IERC20.at('0x21C5918CcB42d20A2368bdCA8feDA0399EbfD2f6');

        balV2 = await IBalancerV2.at('0xBA12222222228d8Ba445958a75a0704d566BF2C8');
        balGROWETHPool = await IERC20.at('0x702605f43471183158938c1a3e5f5a359d7b31ba');

        staker = await Staker.at('0x001C249c09090D79Dc350A286247479F08c7aaD7');

        await impersonate();

        mainV = await GROVesting.at('0xA28693bf01Dc261887b238646Bb9636cB3a3730B');
        await mainV.setVester(deployer, true, { from: OWNER1 });
        empV = await GROEmpVesting.at('0xCa71e66866eB9ae67bd5F3Ab50B06Abd188F33C7');
        invV = await GROInvVesting.at('0x90D58911e49e6Db40Db44B476E1Ca268e1e2AD7b');

        await gro.approve(unirouter.address, ethers.constants.MaxUint256, { from: user });
        await gvt.approve(unirouter.address, ethers.constants.MaxUint256, { from: user });
        await usdc.approve(unirouter.address, ethers.constants.MaxUint256, { from: user });

        await gro.approve(balV2.address, ethers.constants.MaxUint256, { from: user });
        await weth.approve(balV2.address, ethers.constants.MaxUint256, { from: user });

        await gro.approve(staker.address, ethers.constants.MaxUint256, { from: user });
        await uniGVTGROPool.approve(staker.address, ethers.constants.MaxUint256, { from: user });
        await uniGROUSDCPool.approve(staker.address, ethers.constants.MaxUint256, { from: user });
        await balGROWETHPool.approve(staker.address, ethers.constants.MaxUint256, { from: user });

        TokenMappingSlots[GRO_TOKEN_ADDRESS] = GRO_SLOT;
        TokenMappingSlots[GVT_ADDRESS] = GVT_SLOT;
        TokenMappingSlots[USDC_ADDRESS] = USDC_SLOT;
        TokenMappingSlots[WETH_ADDRESS] = WETH_SLOT;

        sId = await hre.network.provider.request(
            {
                method: "evm_snapshot",
                params: []
            });
    })

    afterEach(async function () {
        if (sId) {
            await hre.network.provider.request(
                {
                    method: "evm_revert",
                    params: [sId]
                });
            console.log('revert to ' + sId);
        }
    })

    describe('ok', function () {
        it.skip('test some existing accounts', async () => {
            const users = [
                '0x7ce06dfb89aadec277f34fc575b3d735c593354e',
                '0xad192a9eaee1e342cabb1cd32f01de3b77d8598f',
                '0xbdfa4f4492dd7b7cf211209c4791af8d52bf5c50',
                '0x6e26d91c264ab73a0062ccb5fb00becfab3acc6b',
                '0xec0297f0a72286c92e826e3b55bd61ad31986dfe',
                '0xbcb91e689114b9cc865ad7871845c95241df4105',
                '0x9b7a6e6b894e243e994cfaa32ea07d8a60740981',
                '0x38f2944e482a050942e5fb1652af4690017cd141',
                '0x0528fe93a729efefc8d2612972622c63b4778372',
                '0x1702118d79aff622f9bfcf8d936d76c0be424aad',
                '0x9dcc35ae915926f7f5e8c624254d91f755d55b71',
                '0xefccdd6a77f9d939988eede50afa2bab650c9dde',
                '0x0417926c1504f17892cff3b0d0feeda89c711fce',
                '0xa31f8afd785EC32df8Df77Ab83978E49Cc0349Ac',
            ];
            for (let user of users) {
                const value = await aggregator.balanceOf(user);
                console.log(`${user} vote amount: ${value}`);
            }
        })

        it.only('test one account', async () => {
            const groAmount = toBN(100000).mul(constants.DEFAULT_FACTOR);

            let amount = web3.utils.padLeft(ethers.utils.parseUnits('100000', 18).toHexString(), 64);
            await setBalance(GRO_TOKEN_ADDRESS, user, amount);
            console.log('gro balance: ' + await gro.balanceOf(user));
            amount = web3.utils.padLeft(ethers.utils.parseUnits('100000', 18).toHexString(), 64);
            await setBalance(GVT_ADDRESS, user, amount);
            console.log('gvt balance: ' + await gvt.balanceOf(user));
            amount = web3.utils.padLeft(ethers.utils.parseUnits('1000000', 6).toHexString(), 64);
            await setBalance(USDC_ADDRESS, user, amount);
            console.log('usdc balance: ' + await usdc.balanceOf(user));
            amount = web3.utils.padLeft(ethers.utils.parseUnits('100000', 18).toHexString(), 64);
            await setBalance(WETH_ADDRESS, user, amount);
            console.log('weth balance: ' + await weth.balanceOf(user));

            let b = await web3.eth.getBlock('latest');
            let deadline = toBN(b.timestamp).mul(toBN(2));

            const gvtgroRes = await unirouter.addLiquidity.call(
                GVT_ADDRESS, GRO_TOKEN_ADDRESS,
                toBN(10000).mul(constants.DEFAULT_FACTOR), toBN(10000).mul(constants.DEFAULT_FACTOR),
                0, 0, user, deadline, { from: user });
            console.log('gvtgroRes.amountA: ' + gvtgroRes.amountA);
            console.log('gvtgroRes.amountB: ' + gvtgroRes.amountB);
            console.log('gvtgroRes.liquidity: ' + gvtgroRes.liquidity);
            await unirouter.addLiquidity(
                GVT_ADDRESS, GRO_TOKEN_ADDRESS,
                toBN(10000).mul(constants.DEFAULT_FACTOR), toBN(10000).mul(constants.DEFAULT_FACTOR),
                0, 0, user, deadline, { from: user });
            console.log('gro balance: ' + await gro.balanceOf(user));
            console.log('uinGVTGROPool balance: ' + await uniGVTGROPool.balanceOf(user));
            await expect(uniGVTGROPool.balanceOf(user)).to.eventually.be.a.bignumber.equal(gvtgroRes.liquidity);

            const grousdcRes = await unirouter.addLiquidity.call(
                GRO_TOKEN_ADDRESS, USDC_ADDRESS,
                toBN(10000).mul(constants.DEFAULT_FACTOR), toBN(500000).mul(toBN(1000000)),
                0, 0, user, deadline, { from: user });
            console.log('grousdcRes.amountA: ' + grousdcRes.amountA);
            console.log('grousdcRes.amountB: ' + grousdcRes.amountB);
            console.log('grousdcRes.liquidity: ' + grousdcRes.liquidity);
            await unirouter.addLiquidity(
                GRO_TOKEN_ADDRESS, USDC_ADDRESS,
                toBN(10000).mul(constants.DEFAULT_FACTOR), toBN(500000).mul(toBN(1000000)),
                0, 0, user, deadline, { from: user });
            console.log('gro balance: ' + await gro.balanceOf(user));
            console.log('uniGROUSDCPool balance: ' + await uniGROUSDCPool.balanceOf(user));
            await expect(uniGROUSDCPool.balanceOf(user)).to.eventually.be.a.bignumber.equal(grousdcRes.liquidity);

            const balV2UD = web3.eth.abi.encodeParameters(['uint256', 'uint256[]', 'uint256'],
                ['1', ['0', '0x' + toBN(1000).mul(constants.DEFAULT_FACTOR).toString('hex')], '0']);
            const req = {
                assets: [GRO_TOKEN_ADDRESS, WETH_ADDRESS],
                maxAmountsIn: [
                    '0',
                    '0x' + toBN(1000).mul(constants.DEFAULT_FACTOR).toString('hex')
                ],
                userData: balV2UD,
                fromInternalBalance: false
            };

            let groAmount1 = await gro.balanceOf(user);
            let wethAmount1 = await weth.balanceOf(user);
            await balV2.joinPool(
                '0x702605f43471183158938c1a3e5f5a359d7b31ba00020000000000000000009f',
                user, user, req, { from: user });

            let groAmount2 = await gro.balanceOf(user);
            let wethAmount2 = await weth.balanceOf(user);
            console.log('gro diff: ' + groAmount1.sub(groAmount2))
            console.log('weth diff: ' + wethAmount1.sub(wethAmount2))
            console.log('groweth lp balance: ' + await balGROWETHPool.balanceOf(user))
            console.log('groweth ts: ' + await balGROWETHPool.totalSupply())

            const growethAmount = await balGROWETHPool.balanceOf(user);
            const growethTS = await balGROWETHPool.totalSupply();
            let res = await balV2.getPoolTokens('0x702605f43471183158938c1a3e5f5a359d7b31ba00020000000000000000009f');
            console.log('groweth gro amount: ' + growethAmount.mul(res.balances[0]).div(growethTS));
            console.log('groweth weth amount: ' + growethAmount.mul(res.balances[1]).div(growethTS));

            console.log('gro balance: ' + await gro.balanceOf(user));
            amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            console.log('amount: ' + amount);
            await staker.deposit(0, amount, { from: user });
            await staker.deposit(1, gvtgroRes.liquidity.div(toBN(2)), { from: user });
            await staker.deposit(2, grousdcRes.liquidity.div(toBN(3)), { from: user });
            await staker.deposit(5, growethAmount.div(toBN(4)), { from: user });

            const mvAmount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await mainV.vest(user, mvAmount);
            const evAmount = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await empV.vest(user, 0, evAmount, { from: OWNER2 });

            const ivAmount2 = toBN(30000).mul(constants.DEFAULT_FACTOR);
            await invV.vest(user2, 0, ivAmount2, { from: OWNER2 });
            await empV.vest(user2, 0, evAmount, { from: OWNER2 });

            b = await web3.eth.getBlock('latest');
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS.mul(toBN(11)).div(toBN(10))).toNumber()]
                });
            await mainV.setVester(deployer, true, { from: OWNER1 });

            let value = gvtgroRes.amountA.mul(GVT_WEIGHT)
                .add(grousdcRes.amountB.mul(toBN(1e12)).mul(USDC_WEIGHT))
                .add(growethAmount.mul(res.balances[0]).mul(GRO_WEIGHT).div(growethTS))
                .add(growethAmount.mul(res.balances[1]).mul(ETH_WEIGHT).div(growethTS));
            let locked = await mainV.vestingBalance(user);
            value = value.add(locked.mul(LOCKED_WEIGHT)).add(mvAmount.sub(locked).mul(UNLOCKED_WEIGHT));
            let vRes = await empV.vestedBalance(user);
            value = value.add(vRes.vested.mul(UNLOCKED_WEIGHT)).add(evAmount.sub(vRes.vested).mul(LOCKED_WEIGHT));
            value = value.div(constants.PERCENT_FACTOR).add(groAmount);
            await expect(aggregator.balanceOf(user)).to.eventually.be.a.bignumber.closeTo(value, constants.DEFAULT_FACTOR);

            vRes = await invV.vestedBalance(user2);
            value = vRes.vested.mul(UNLOCKED_WEIGHT).add(ivAmount2.sub(vRes.vested).mul(LOCKED_WEIGHT));
            vRes = await empV.vestedBalance(user2);
            value = value.add(vRes.vested.mul(UNLOCKED_WEIGHT).add(evAmount.sub(vRes.vested).mul(LOCKED_WEIGHT)));
            value = value.div(constants.PERCENT_FACTOR);
            await expect(aggregator.balanceOf(user2)).to.eventually.be.a.bignumber.closeTo(value, toBN(0));

            return;
        })
    })
})
