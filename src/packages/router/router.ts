import {
	ApiRouterCompleteTradeRouteBody,
	ApiRouterTransactionForCompleteTradeRouteBody,
	Balance,
	CoinType,
	RouterCompleteTradeRoute,
	SerializedTransaction,
	SuiNetwork,
} from "../../types";
import { Caller } from "../../general/utils/caller";
import { SuiAddress, TransactionBlock } from "@mysten/sui.js";

export class Router extends Caller {
	/////////////////////////////////////////////////////////////////////
	//// Constructor
	/////////////////////////////////////////////////////////////////////

	constructor(public readonly network?: SuiNetwork) {
		super(network, "router");
	}

	/////////////////////////////////////////////////////////////////////
	//// Public Methods
	/////////////////////////////////////////////////////////////////////

	/////////////////////////////////////////////////////////////////////
	//// Inspections
	/////////////////////////////////////////////////////////////////////

	public async getSupportedCoins(): Promise<CoinType[]> {
		return this.fetchApi("supportedCoins");
	}

	public async getCompleteTradeRouteGivenAmountIn(
		inputs: ApiRouterCompleteTradeRouteBody,
		abortSignal?: AbortSignal
	): Promise<RouterCompleteTradeRoute> {
		return this.fetchApi<
			RouterCompleteTradeRoute,
			ApiRouterCompleteTradeRouteBody
		>("tradeRoute", inputs, abortSignal);
	}

	public async getCompleteTradeRouteGivenAmountOut(
		inputs: ApiRouterCompleteTradeRouteBody,
		abortSignal?: AbortSignal
	): Promise<RouterCompleteTradeRoute> {
		return this.fetchApi<
			RouterCompleteTradeRoute,
			ApiRouterCompleteTradeRouteBody
		>("tradeRoute", inputs, abortSignal);
	}

	/////////////////////////////////////////////////////////////////////
	//// Transactions
	/////////////////////////////////////////////////////////////////////

	public async getTransactionForCompleteTradeRoute(
		inputs: ApiRouterTransactionForCompleteTradeRouteBody
	): Promise<TransactionBlock> {
		return TransactionBlock.from(
			await this.fetchApi<
				SerializedTransaction,
				ApiRouterTransactionForCompleteTradeRouteBody
			>("transactions/trade", inputs)
		);
	}
}
