import { SignableTransaction } from "@mysten/sui.js";
import { Aftermath } from "../../general/providers/aftermath";
import { CoinType, ApiFaucetRequestBody, SuiNetwork } from "../../types";

export class Faucet extends Aftermath {
	/////////////////////////////////////////////////////////////////////
	//// Constants
	/////////////////////////////////////////////////////////////////////

	public static readonly constants = {
		defaultRequestAmountUsd: 10,
	};

	private static readonly eventNames = {
		mintedCoin: "MintedCoin",
	};

	/////////////////////////////////////////////////////////////////////
	//// Constructor
	/////////////////////////////////////////////////////////////////////

	constructor(public readonly network?: SuiNetwork) {
		super(network, "faucet");
	}

	/////////////////////////////////////////////////////////////////////
	//// Inspections
	/////////////////////////////////////////////////////////////////////

	public async getIsPackageOnChain(): Promise<boolean> {
		return this.fetchApi("status");
	}

	public async getSupportedCoins(): Promise<CoinType[]> {
		return this.fetchApi("supportedCoins");
	}

	/////////////////////////////////////////////////////////////////////
	//// Events
	/////////////////////////////////////////////////////////////////////

	// TODO: add mint coin event getter

	/////////////////////////////////////////////////////////////////////
	//// Transactions
	/////////////////////////////////////////////////////////////////////

	public async getRequestCoinTransaction(
		coin: CoinType
	): Promise<SignableTransaction> {
		return this.fetchApi<SignableTransaction, ApiFaucetRequestBody>(
			"transactions/request",
			{
				coin,
			}
		);
	}
}
