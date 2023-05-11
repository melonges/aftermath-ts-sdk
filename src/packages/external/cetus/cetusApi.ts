import { AftermathApi } from "../../../general/providers";
import { CoinType } from "../../coin/coinTypes";
import { CetusApiHelpers } from "./cetusApiHelpers";
import { SuiAddress } from "@mysten/sui.js";
import { CetusPoolObject } from "./cetusTypes";
import { Balance, SerializedTransaction } from "../../../types";
import { RouterApiInterface } from "../../router/utils/synchronous/interfaces/routerApiInterface";
import { Helpers } from "../../../general/utils";

export class CetusApi implements RouterApiInterface<CetusPoolObject> {
	/////////////////////////////////////////////////////////////////////
	//// Class Members
	/////////////////////////////////////////////////////////////////////

	public readonly Helpers;

	/////////////////////////////////////////////////////////////////////
	//// Constructor
	/////////////////////////////////////////////////////////////////////

	constructor(private readonly Provider: AftermathApi) {
		this.Provider = Provider;
		this.Helpers = new CetusApiHelpers(Provider);
	}

	/////////////////////////////////////////////////////////////////////
	//// Public Methods
	/////////////////////////////////////////////////////////////////////

	/////////////////////////////////////////////////////////////////////
	//// Objects
	/////////////////////////////////////////////////////////////////////

	public fetchPoolForCoinTypes = async (inputs: {
		coinType1: CoinType;
		coinType2: CoinType;
	}): Promise<CetusPoolObject> => {
		return this.Helpers.fetchPoolForCoinTypes(inputs);
	};

	public fetchAllPools = async () => {
		const pools = await this.Helpers.fetchAllPools();
		return pools;
	};

	public fetchSupportedCoins = async () => {
		const pools = await this.Helpers.fetchAllPools();

		const allCoins = pools.reduce(
			(acc, pool) => [...acc, pool.coinTypeA, pool.coinTypeB],
			[] as CoinType[]
		);
		return Helpers.uniqueArray(allCoins);
	};

	/////////////////////////////////////////////////////////////////////
	//// Inspections
	/////////////////////////////////////////////////////////////////////

	public fetchTradeAmountOut = async (inputs: {
		walletAddress: SuiAddress;
		pool: CetusPoolObject;
		coinInType: CoinType;
		coinOutType: CoinType;
		coinInAmount: Balance;
	}): Promise<Balance> => {
		const tradeResult = await this.Helpers.fetchCalcTradeResult(inputs);
		return tradeResult.amountOut;
	};

	/////////////////////////////////////////////////////////////////////
	//// Transactions
	/////////////////////////////////////////////////////////////////////

	public fetchTradeTx = (inputs: {
		walletAddress: SuiAddress;
		pool: CetusPoolObject;
		coinInType: CoinType;
		coinOutType: CoinType;
		coinInAmount: Balance;
	}): Promise<SerializedTransaction> => {
		return this.Provider.Transactions().fetchSetGasBudgetAndSerializeTransaction(
			this.Helpers.fetchBuildTradeTx(inputs)
		);
	};
}
