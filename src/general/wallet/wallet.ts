import { SuiAddress, TransactionDigest } from "@mysten/sui.js";
import { SuiNetwork } from "../types/suiTypes";
import {
	ApiTransactionsBody,
	Balance,
	TransactionsWithCursor,
} from "../types/generalTypes";
import { CoinType, CoinsToBalance } from "../../packages/coin/coinTypes";
import { Caller } from "../utils/caller";

export class Wallet extends Caller {
	constructor(
		public readonly address: SuiAddress,
		public readonly network?: SuiNetwork
	) {
		super(network, `wallet/${address}`);
	}

	/////////////////////////////////////////////////////////////////////
	//// Balances
	/////////////////////////////////////////////////////////////////////

	public async getBalance(coin: CoinType): Promise<Balance> {
		return this.fetchApi(`balances/${coin}`);
	}

	// TODO: change return type to Record<Coin, Balance> ?
	public async getBalances(coins: CoinType[]): Promise<Balance[]> {
		const balances = await Promise.all(coins.map(this.getBalance));
		return balances;
	}

	public async getAllBalances(): Promise<CoinsToBalance> {
		return this.fetchApi("balances");
	}

	/////////////////////////////////////////////////////////////////////
	//// Transactions
	/////////////////////////////////////////////////////////////////////

	public async getPastAftermathTransactions(
		cursor?: TransactionDigest,
		limit?: number
	): Promise<TransactionsWithCursor> {
		return this.fetchApi<TransactionsWithCursor, ApiTransactionsBody>(
			"transactions",
			{
				cursor,
				limit,
			}
		);
	}
}
