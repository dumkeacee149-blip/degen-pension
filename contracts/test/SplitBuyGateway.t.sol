// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketFactory} from "../src/MarketFactory.sol";
import {SplitBuyGateway} from "../src/SplitBuyGateway.sol";
import {MockAdapter} from "../src/mocks/MockAdapter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);

    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);

    function deal(address account, uint256 newBalance) external;

    function warp(uint256 newTimestamp) external;
}

contract SplitBuyGatewayTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant AUTHORITY_PRIVATE_KEY = 0xA11CE;
    uint256 private constant WRONG_PRIVATE_KEY = 0xB0B;
    uint256 private constant USER_INPUT = 10_000 ether;
    uint256 private constant EXPLICIT_FEE = 100 ether;
    uint256 private constant NET_INPUT = 9_900 ether;
    uint256 private constant PROJECT_INPUT = 9_801 ether;
    uint256 private constant STOCK_INPUT = 99 ether;
    uint256 private constant PROJECT_OUTPUT = 19_602 ether;
    uint256 private constant STOCK_OUTPUT = 297 ether;
    uint256 private constant ADAPTER_LIQUIDITY = 1_000_000 ether;
    uint16 private constant EXPLICIT_FEE_BPS = 100;

    address private constant RECIPIENT = address(0xBEEF);
    address private constant FEE_RECIPIENT = address(0xFEE);

    struct Fixture {
        MockERC20 input;
        MockERC20 official;
        MockERC20 stock;
        MockAdapter projectAdapter;
        MockAdapter stockAdapter;
        MarketFactory factory;
        SplitBuyGateway gateway;
        MarketFactory.AdoptMarket adoption;
        bytes authorization;
    }

    function testFactoryAtomicallyCreatesAuthorizedInitializedClone() external {
        Fixture memory f = _fixture();

        _assertTrue(address(f.gateway) != address(f.factory.implementation()), "clone is implementation");
        _assertTrue(f.factory.isMarket(address(f.gateway)), "market not registered");
        _assertTrue(f.factory.usedNonces(f.adoption.nonce), "authorization nonce not consumed");
        _assertEq(f.factory.projectAuthority(), _authority(), "wrong project authority");
        _assertTrue(f.gateway.initialized(), "market not initialized");
        _assertEq(f.gateway.PROJECT_BPS(), 9_900, "project ratio changed");
        _assertEq(f.gateway.STOCK_BPS(), 100, "stock ratio changed");
        _assertEq(f.gateway.BPS_DENOMINATOR(), 10_000, "denominator changed");
        _assertEq(f.gateway.MAX_EXPLICIT_FEE_BPS(), 500, "fee cap changed");
        _assertEq(f.gateway.inputToken(), address(f.input), "input not bound");
        _assertEq(f.gateway.officialToken(), address(f.official), "official token not bound");
        _assertEq(f.gateway.stockToken(), address(f.stock), "stock token not bound");
        _assertEq(f.gateway.projectAdapter(), address(f.projectAdapter), "project adapter not bound");
        _assertEq(f.gateway.stockAdapter(), address(f.stockAdapter), "stock adapter not bound");
        _assertEq(f.gateway.explicitFeeBps(), EXPLICIT_FEE_BPS, "explicit fee not bound");
        _assertEq(f.gateway.feeRecipient(), FEE_RECIPIENT, "fee recipient not bound");
    }

    function testGrossFeeNetSplitAndBothOutputsGoDirectlyToRecipient() external {
        Fixture memory f = _fixture();

        (uint256 projectOut, uint256 stockOut) = f.gateway.buy(USER_INPUT, PROJECT_OUTPUT, STOCK_OUTPUT, RECIPIENT);

        _assertEq(f.input.balanceOf(FEE_RECIPIENT), EXPLICIT_FEE, "gross fee was not paid first");
        _assertEq(EXPLICIT_FEE + NET_INPUT, USER_INPUT, "gross does not equal fee plus net");
        _assertEq(f.input.balanceOf(address(f.projectAdapter)), PROJECT_INPUT, "net project leg is not 99%");
        _assertEq(f.input.balanceOf(address(f.stockAdapter)), STOCK_INPUT, "net stock leg is not 1%");
        _assertEq(projectOut, PROJECT_OUTPUT, "wrong project output return");
        _assertEq(stockOut, STOCK_OUTPUT, "wrong stock output return");
        _assertEq(f.official.balanceOf(RECIPIENT), PROJECT_OUTPUT, "project output not sent to recipient");
        _assertEq(f.stock.balanceOf(RECIPIENT), STOCK_OUTPUT, "stock output not sent to recipient");
        _assertEq(f.input.balanceOf(address(f.gateway)), 0, "gateway retained input");
        _assertEq(f.official.balanceOf(address(f.gateway)), 0, "gateway retained project output");
        _assertEq(f.stock.balanceOf(address(f.gateway)), 0, "gateway retained stock output");
    }

    function testZeroExplicitFeeAllowsZeroRecipientAndAvoidsDoubleCharge() external {
        MockERC20 input = new MockERC20("Input", "IN");
        Fixture memory f = _fixtureWithInput(input, 0, address(0), 1);

        (uint256 projectOut, uint256 stockOut) = f.gateway.buy(USER_INPUT, 19_800 ether, 300 ether, RECIPIENT);

        _assertEq(f.gateway.explicitFeeBps(), 0, "explicit fee is not zero");
        _assertEq(f.gateway.feeRecipient(), address(0), "zero fee recipient changed");
        _assertEq(f.input.balanceOf(address(f.projectAdapter)), 9_900 ether, "project leg double charged");
        _assertEq(f.input.balanceOf(address(f.stockAdapter)), 100 ether, "stock leg double charged");
        _assertEq(projectOut, 19_800 ether, "wrong zero-fee project output");
        _assertEq(stockOut, 300 ether, "wrong zero-fee stock output");
    }

    function testSecondLegFailureRollsBackFeeAndEntireBuy() external {
        Fixture memory f = _fixture();
        f.stockAdapter.setShouldRevert(true);

        uint256 projectLiquidityBefore = f.official.balanceOf(address(f.projectAdapter));
        (bool success,) = address(f.gateway)
            .call(abi.encodeCall(SplitBuyGateway.buy, (USER_INPUT, PROJECT_OUTPUT, STOCK_OUTPUT, RECIPIENT)));

        _assertFalse(success, "buy unexpectedly succeeded");
        _assertEq(f.input.balanceOf(address(this)), USER_INPUT, "payer input did not roll back");
        _assertEq(f.input.balanceOf(FEE_RECIPIENT), 0, "explicit fee did not roll back");
        _assertEq(f.input.balanceOf(address(f.projectAdapter)), 0, "project input did not roll back");
        _assertEq(f.input.balanceOf(address(f.stockAdapter)), 0, "stock input did not roll back");
        _assertEq(f.official.balanceOf(RECIPIENT), 0, "project output did not roll back");
        _assertEq(f.stock.balanceOf(RECIPIENT), 0, "stock output did not roll back");
        _assertEq(
            f.official.balanceOf(address(f.projectAdapter)),
            projectLiquidityBefore,
            "adapter liquidity did not roll back"
        );
    }

    function testNativeBuyWrapsGrossThenUsesSameFeeAndSplit() external {
        (Fixture memory f, MockWETH weth) = _nativeFixture();
        VM.deal(address(this), USER_INPUT);

        uint256 nativeBefore = address(this).balance;
        uint256 wrappedSupplyBefore = weth.totalSupply();
        (uint256 projectOut, uint256 stockOut) =
            f.gateway.buyNative{value: USER_INPUT}(PROJECT_OUTPUT, STOCK_OUTPUT, RECIPIENT);

        _assertEq(address(this).balance, nativeBefore - USER_INPUT, "native gross not consumed");
        _assertEq(address(f.gateway).balance, 0, "gateway retained native currency");
        _assertEq(weth.totalSupply(), wrappedSupplyBefore + USER_INPUT, "msg.value was not fully wrapped");
        _assertEq(weth.balanceOf(FEE_RECIPIENT), EXPLICIT_FEE, "wrapped fee incorrect");
        _assertEq(weth.balanceOf(address(f.projectAdapter)), PROJECT_INPUT, "wrapped project leg incorrect");
        _assertEq(weth.balanceOf(address(f.stockAdapter)), STOCK_INPUT, "wrapped stock leg incorrect");
        _assertEq(projectOut, PROJECT_OUTPUT, "wrong native project output");
        _assertEq(stockOut, STOCK_OUTPUT, "wrong native stock output");
        _assertEq(f.official.balanceOf(RECIPIENT), PROJECT_OUTPUT, "native project output not direct");
        _assertEq(f.stock.balanceOf(RECIPIENT), STOCK_OUTPUT, "native stock output not direct");
    }

    function testNativeSecondLegFailureRollsBackWrapFeeAndBothLegs() external {
        (Fixture memory f, MockWETH weth) = _nativeFixture();
        f.stockAdapter.setShouldRevert(true);
        VM.deal(address(this), USER_INPUT);

        uint256 nativeBefore = address(this).balance;
        uint256 wrappedSupplyBefore = weth.totalSupply();
        (bool success,) = address(f.gateway).call{value: USER_INPUT}(
            abi.encodeCall(SplitBuyGateway.buyNative, (PROJECT_OUTPUT, STOCK_OUTPUT, RECIPIENT))
        );

        _assertFalse(success, "native buy unexpectedly succeeded");
        _assertEq(address(this).balance, nativeBefore, "native value did not roll back");
        _assertEq(weth.totalSupply(), wrappedSupplyBefore, "native wrap did not roll back");
        _assertEq(weth.balanceOf(FEE_RECIPIENT), 0, "wrapped fee did not roll back");
        _assertEq(weth.balanceOf(address(f.projectAdapter)), 0, "wrapped project leg did not roll back");
        _assertEq(weth.balanceOf(address(f.stockAdapter)), 0, "wrapped stock leg did not roll back");
        _assertEq(f.official.balanceOf(RECIPIENT), 0, "native project output did not roll back");
        _assertEq(f.stock.balanceOf(RECIPIENT), 0, "native stock output did not roll back");
    }

    function testWrongOutputTokenRevertsAtomically() external {
        Fixture memory f = _fixture();
        MockERC20 wrongToken = new MockERC20("Wrong Token", "WRONG");
        wrongToken.mint(address(f.stockAdapter), ADAPTER_LIQUIDITY);
        f.stockAdapter.setDeliveryToken(address(wrongToken));

        (bool success,) = address(f.gateway)
            .call(abi.encodeCall(SplitBuyGateway.buy, (USER_INPUT, PROJECT_OUTPUT, STOCK_OUTPUT, RECIPIENT)));

        _assertFalse(success, "wrong output token accepted");
        _assertEq(f.input.balanceOf(address(this)), USER_INPUT, "payer input did not roll back");
        _assertEq(f.input.balanceOf(FEE_RECIPIENT), 0, "fee did not roll back");
        _assertEq(f.official.balanceOf(RECIPIENT), 0, "project output did not roll back");
        _assertEq(f.stock.balanceOf(RECIPIENT), 0, "stock output unexpectedly received");
        _assertEq(wrongToken.balanceOf(RECIPIENT), 0, "wrong token transfer did not roll back");
    }

    function testIncorrectReportedOutputRevertsAtomically() external {
        Fixture memory f = _fixture();
        f.stockAdapter.setReportOffset(1);

        (bool success,) = address(f.gateway)
            .call(abi.encodeCall(SplitBuyGateway.buy, (USER_INPUT, PROJECT_OUTPUT, STOCK_OUTPUT, RECIPIENT)));

        _assertFalse(success, "incorrect report accepted");
        _assertEq(f.input.balanceOf(address(this)), USER_INPUT, "payer input did not roll back");
        _assertEq(f.input.balanceOf(FEE_RECIPIENT), 0, "fee did not roll back");
        _assertEq(f.official.balanceOf(RECIPIENT), 0, "project output did not roll back");
        _assertEq(f.stock.balanceOf(RECIPIENT), 0, "stock output did not roll back");
    }

    function testRepeatedInitializationAndImplementationInitializationRevert() external {
        Fixture memory f = _fixture();

        bytes memory initializer = abi.encodeCall(
            SplitBuyGateway.initialize,
            (
                address(f.official),
                address(f.stock),
                address(f.projectAdapter),
                address(f.stockAdapter),
                EXPLICIT_FEE_BPS,
                FEE_RECIPIENT
            )
        );

        (bool cloneSuccess,) = address(f.gateway).call(initializer);
        (bool implementationSuccess,) = address(f.factory.implementation()).call(initializer);

        _assertFalse(cloneSuccess, "clone initialized twice");
        _assertFalse(implementationSuccess, "implementation was initializable");
        _assertEq(f.gateway.officialToken(), address(f.official), "clone binding changed");
        _assertEq(f.gateway.stockToken(), address(f.stock), "clone binding changed");
        _assertEq(f.gateway.explicitFeeBps(), EXPLICIT_FEE_BPS, "fee binding changed");
        _assertEq(f.gateway.feeRecipient(), FEE_RECIPIENT, "recipient binding changed");
    }

    function testFactoryRejectsInvalidFeeConfiguration() external {
        Fixture memory f = _fixture();

        MarketFactory.AdoptMarket memory missingRecipient = f.adoption;
        missingRecipient.explicitFeeBps = 1;
        missingRecipient.feeRecipient = address(0);
        missingRecipient.nonce = 2;
        bytes memory missingRecipientSignature = _sign(f.factory, missingRecipient, AUTHORITY_PRIVATE_KEY);

        MarketFactory.AdoptMarket memory excessiveFee = f.adoption;
        excessiveFee.explicitFeeBps = 501;
        excessiveFee.nonce = 3;
        bytes memory excessiveFeeSignature = _sign(f.factory, excessiveFee, AUTHORITY_PRIVATE_KEY);

        (bool recipientSuccess,) = address(f.factory)
            .call(abi.encodeCall(MarketFactory.createMarket, (missingRecipient, missingRecipientSignature)));
        (bool capSuccess,) =
            address(f.factory).call(abi.encodeCall(MarketFactory.createMarket, (excessiveFee, excessiveFeeSignature)));

        _assertFalse(recipientSuccess, "nonzero fee accepted zero recipient");
        _assertFalse(capSuccess, "fee above cap accepted");
        _assertFalse(f.factory.usedNonces(2), "failed recipient nonce consumed");
        _assertFalse(f.factory.usedNonces(3), "failed fee cap nonce consumed");
    }

    function testFactoryRejectsAdapterWithWrongAdvertisedOutput() external {
        Fixture memory f = _fixture();
        MockERC20 wrong = new MockERC20("Wrong", "WRONG");
        MockAdapter wrongProjectAdapter = new MockAdapter(address(f.input), address(wrong), 1, 1);

        MarketFactory.AdoptMarket memory adoption = f.adoption;
        adoption.projectAdapter = address(wrongProjectAdapter);
        adoption.nonce = 2;
        bytes memory authorization = _sign(f.factory, adoption, AUTHORITY_PRIVATE_KEY);

        (bool success,) = address(f.factory).call(abi.encodeCall(MarketFactory.createMarket, (adoption, authorization)));

        _assertFalse(success, "factory accepted mismatched output adapter");
        _assertFalse(f.factory.usedNonces(2), "failed initialization consumed nonce");
    }

    function testFactoryRejectsWrongAuthoritySignature() external {
        Fixture memory f = _fixture();
        MarketFactory.AdoptMarket memory adoption = f.adoption;
        adoption.nonce = 2;
        bytes memory wrongAuthorization = _sign(f.factory, adoption, WRONG_PRIVATE_KEY);

        (bool success,) =
            address(f.factory).call(abi.encodeCall(MarketFactory.createMarket, (adoption, wrongAuthorization)));

        _assertFalse(success, "wrong authority signature accepted");
        _assertFalse(f.factory.usedNonces(2), "invalid signature consumed nonce");
    }

    function testFactoryRejectsExpiredAuthorization() external {
        Fixture memory f = _fixture();
        VM.warp(10_000);

        MarketFactory.AdoptMarket memory adoption = f.adoption;
        adoption.nonce = 2;
        adoption.deadline = 9_999;
        bytes memory authorization = _sign(f.factory, adoption, AUTHORITY_PRIVATE_KEY);

        (bool success,) = address(f.factory).call(abi.encodeCall(MarketFactory.createMarket, (adoption, authorization)));

        _assertFalse(success, "expired authorization accepted");
        _assertFalse(f.factory.usedNonces(2), "expired authorization consumed nonce");
    }

    function testFactoryRejectsAuthorizationReplay() external {
        Fixture memory f = _fixture();

        (bool success,) =
            address(f.factory).call(abi.encodeCall(MarketFactory.createMarket, (f.adoption, f.authorization)));

        _assertFalse(success, "authorization replay accepted");
        _assertTrue(f.factory.usedNonces(f.adoption.nonce), "used nonce unexpectedly cleared");
    }

    function testSignatureCannotBeReplayedAcrossFactories() external {
        Fixture memory f = _fixture();
        MarketFactory otherFactory = new MarketFactory(_authority());

        (bool success,) =
            address(otherFactory).call(abi.encodeCall(MarketFactory.createMarket, (f.adoption, f.authorization)));

        _assertFalse(success, "factory-bound signature accepted elsewhere");
        _assertFalse(otherFactory.usedNonces(f.adoption.nonce), "wrong factory consumed nonce");
    }

    function _fixture() private returns (Fixture memory f) {
        MockERC20 input = new MockERC20("Input", "IN");
        return _fixtureWithInput(input, EXPLICIT_FEE_BPS, FEE_RECIPIENT, 1);
    }

    function _nativeFixture() private returns (Fixture memory f, MockWETH weth) {
        weth = new MockWETH();
        f = _fixtureWithInput(weth, EXPLICIT_FEE_BPS, FEE_RECIPIENT, 1);
    }

    function _fixtureWithInput(MockERC20 input, uint16 feeBps, address feeRecipient, uint256 nonce)
        private
        returns (Fixture memory f)
    {
        f.input = input;
        f.official = new MockERC20("Project Token", "PROJECT");
        f.stock = new MockERC20("Stock Token", "STOCK");
        f.projectAdapter = new MockAdapter(address(f.input), address(f.official), 2, 1);
        f.stockAdapter = new MockAdapter(address(f.input), address(f.stock), 3, 1);
        f.factory = new MarketFactory(_authority());
        f.adoption = MarketFactory.AdoptMarket({
            officialToken: address(f.official),
            stockToken: address(f.stock),
            projectAdapter: address(f.projectAdapter),
            stockAdapter: address(f.stockAdapter),
            explicitFeeBps: feeBps,
            feeRecipient: feeRecipient,
            nonce: nonce,
            deadline: block.timestamp + 1 days
        });
        f.authorization = _sign(f.factory, f.adoption, AUTHORITY_PRIVATE_KEY);

        address market = f.factory.createMarket(f.adoption, f.authorization);
        f.gateway = SplitBuyGateway(market);

        f.input.mint(address(this), USER_INPUT);
        f.official.mint(address(f.projectAdapter), ADAPTER_LIQUIDITY);
        f.stock.mint(address(f.stockAdapter), ADAPTER_LIQUIDITY);
        f.input.approve(address(f.gateway), USER_INPUT);
    }

    function _sign(MarketFactory factory, MarketFactory.AdoptMarket memory adoption, uint256 privateKey)
        private
        returns (bytes memory signature)
    {
        bytes32 digest = factory.hashAdoptMarket(adoption);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _authority() private returns (address) {
        return VM.addr(AUTHORITY_PRIVATE_KEY);
    }

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function _assertEq(address actual, address expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function _assertTrue(bool value, string memory message) private pure {
        require(value, message);
    }

    function _assertFalse(bool value, string memory message) private pure {
        require(!value, message);
    }
}
