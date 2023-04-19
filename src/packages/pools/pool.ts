import { TransactionBlock } from "@mysten/sui.js";
import {
	ApiPoolDepositBody,
	ApiPoolTradeBody,
	ApiPoolWithdrawBody,
	Balance,
	CoinType,
	CoinsToBalance,
	PoolDataPoint,
	PoolVolumeDataTimeframeKey,
	PoolObject,
	PoolStats,
	SuiNetwork,
	SerializedTransaction,
	ApiEventsBody,
	EventsWithCursor,
	PoolDepositEvent,
	PoolWithdrawEvent,
	PoolTradeEvent,
} from "../../types";
import { CmmmCalculations } from "./utils/cmmmCalculations";
import { Caller } from "../../general/utils/caller";
import { Pools } from ".";
import { Casting, Helpers } from "../../general/utils";

export class Pool extends Caller {
	/////////////////////////////////////////////////////////////////////
	//// Private Constants
	/////////////////////////////////////////////////////////////////////

	private static readonly constants = {
		percentageBoundsMarginOfError: 0.00001,
	};

	/////////////////////////////////////////////////////////////////////
	//// Public Class Members
	/////////////////////////////////////////////////////////////////////

	public stats: PoolStats | undefined;

	/////////////////////////////////////////////////////////////////////
	//// Constructor
	/////////////////////////////////////////////////////////////////////

	constructor(
		public readonly pool: PoolObject,
		public readonly network?: SuiNetwork
	) {
		super(network, `pools/${pool.objectId}`);
		this.pool = pool;
	}

	/////////////////////////////////////////////////////////////////////
	//// Stats
	/////////////////////////////////////////////////////////////////////

	public async getStats(): Promise<PoolStats> {
		const stats = await this.fetchApi<PoolStats>("stats");
		this.stats = stats;
		return stats;
	}

	public setStats(stats: PoolStats) {
		this.stats = stats;
	}

	public async getVolume(inputs: {
		timeframe: PoolVolumeDataTimeframeKey;
	}): Promise<PoolDataPoint[]> {
		return this.fetchApi(`volume/${inputs.timeframe}`);
	}

	/////////////////////////////////////////////////////////////////////
	//// Transactions
	/////////////////////////////////////////////////////////////////////

	public async getDepositTransaction(
		inputs: ApiPoolDepositBody
	): Promise<TransactionBlock> {
		return TransactionBlock.from(
			await this.fetchApi<SerializedTransaction, ApiPoolDepositBody>(
				"transactions/deposit",
				inputs
			)
		);
	}

	public async getWithdrawTransaction(
		inputs: ApiPoolWithdrawBody
	): Promise<TransactionBlock> {
		return TransactionBlock.from(
			await this.fetchApi<SerializedTransaction, ApiPoolWithdrawBody>(
				"transactions/withdraw",
				inputs
			)
		);
	}

	public async getTradeTransaction(
		inputs: ApiPoolTradeBody
	): Promise<TransactionBlock> {
		return TransactionBlock.from(
			await this.fetchApi<SerializedTransaction, ApiPoolTradeBody>(
				"transactions/trade",
				inputs
			)
		);
	}

	/////////////////////////////////////////////////////////////////////
	//// Events
	/////////////////////////////////////////////////////////////////////

	public async getDepositEvents(
		inputs: ApiEventsBody
	): Promise<EventsWithCursor<PoolDepositEvent>> {
		const eventsWithCursor = await this.fetchApi<
			EventsWithCursor<PoolDepositEvent>,
			ApiEventsBody
		>("events/deposit", inputs);

		// PRODUCTION: temporary until "And" filter can be used for event filtering
		return {
			...eventsWithCursor,
			events: eventsWithCursor.events.filter(
				(event) => event.poolId === this.pool.objectId
			),
		};
	}

	public async getWithdrawEvents(
		inputs: ApiEventsBody
	): Promise<EventsWithCursor<PoolWithdrawEvent>> {
		const eventsWithCursor = await this.fetchApi<
			EventsWithCursor<PoolWithdrawEvent>,
			ApiEventsBody
		>("events/withdraw", inputs);

		// PRODUCTION: temporary until "And" filter can be used for event filtering
		return {
			...eventsWithCursor,
			events: eventsWithCursor.events.filter(
				(event) => event.poolId === this.pool.objectId
			),
		};
	}

	public async getTradeEvents(
		inputs: ApiEventsBody
	): Promise<EventsWithCursor<PoolTradeEvent>> {
		const eventsWithCursor = await this.fetchApi<
			EventsWithCursor<PoolTradeEvent>,
			ApiEventsBody
		>("events/trade", inputs);

		// PRODUCTION: temporary until "And" filter can be used for event filtering
		return {
			...eventsWithCursor,
			events: eventsWithCursor.events.filter(
				(event) => event.poolId === this.pool.objectId
			),
		};
	}

	/////////////////////////////////////////////////////////////////////
	//// Calculations
	/////////////////////////////////////////////////////////////////////

	public getTradeAmountOut = (inputs: {
		coinInType: CoinType;
		coinInAmount: Balance;
		coinOutType: CoinType;
		// PRODUCTION: pass referral here for router
		referral?: boolean;
	}): {
		coinOutAmount: Balance;
		error?: string;
	} => {
		const pool = Helpers.deepCopy(this.pool);
		const coinInPoolBalance = pool.coins[inputs.coinInType].balance;
		const coinOutPoolBalance = pool.coins[inputs.coinOutType].balance;

		const coinInAmountWithFees = Pools.getAmountWithProtocolFees({
			amount: inputs.coinInAmount,
		});

		if (
			Number(coinInAmountWithFees) / Number(coinInPoolBalance) >=
			Pools.constants.bounds.maxSwapPercentageOfPoolBalance -
				Pool.constants.percentageBoundsMarginOfError
		)
			return {
				coinOutAmount: BigInt(0),
				error: "coinInAmountWithFees / coinInPoolBalance >= maxSwapPercentageOfPoolBalance",
			};

		try {
			const coinOutAmount = CmmmCalculations.calcOutGivenIn(
				pool,
				inputs.coinInType,
				inputs.coinOutType,
				coinInAmountWithFees
			);

			if (coinOutAmount <= 0)
				return {
					coinOutAmount: BigInt(0),
					error: "coinOutAmount <= 0",
				};

			if (
				Number(coinOutAmount) / Number(coinOutPoolBalance) >=
				Pools.constants.bounds.maxSwapPercentageOfPoolBalance -
					Pool.constants.percentageBoundsMarginOfError
			)
				return {
					coinOutAmount: BigInt(0),
					error: "coinOutAmount / coinOutPoolBalance >= maxSwapPercentageOfPoolBalance",
				};

			return { coinOutAmount };
		} catch (e) {
			return {
				coinOutAmount: BigInt(0),
				error: "calculation failed",
			};
		}
	};

	public getTradeAmountIn = (inputs: {
		coinInType: CoinType;
		coinOutAmount: Balance;
		coinOutType: CoinType;
		// PRODUCTION: pass referral here for router
		referral?: boolean;
	}): {
		coinInAmount: Balance;
		error?: string;
	} => {
		const pool = Helpers.deepCopy(this.pool);
		const coinInPoolBalance = pool.coins[inputs.coinInType].balance;
		const coinOutPoolBalance = pool.coins[inputs.coinOutType].balance;

		if (
			Number(inputs.coinOutAmount) / Number(coinOutPoolBalance) >=
			Pools.constants.bounds.maxSwapPercentageOfPoolBalance -
				Pool.constants.percentageBoundsMarginOfError
		)
			return {
				coinInAmount: BigInt("0xFFFFFFFFFFFFFFFF"),
				error: "coinOutAmount / coinOutPoolBalance >= maxSwapPercentageOfPoolBalance",
			};

		try {
			const coinInAmount = CmmmCalculations.calcInGivenOut(
				pool,
				inputs.coinInType,
				inputs.coinOutType,
				inputs.coinOutAmount
			);

			if (coinInAmount <= 0)
				return {
					coinInAmount: BigInt("0xFFFFFFFFFFFFFFFF"),
					error: "coinInAmount <= 0",
				};

			if (
				Number(coinInAmount) / Number(coinInPoolBalance) >=
				Pools.constants.bounds.maxSwapPercentageOfPoolBalance -
					Pool.constants.percentageBoundsMarginOfError
			)
				return {
					coinInAmount: BigInt("0xFFFFFFFFFFFFFFFF"),
					error: "coinInAmount / coinInPoolBalance >= maxSwapPercentageOfPoolBalance",
				};

			const coinInAmountWithoutFees = Pools.getAmountWithoutProtocolFees({
				amount: coinInAmount,
			});

			return { coinInAmount: coinInAmountWithoutFees };
		} catch (e) {
			return {
				coinInAmount: BigInt("0xFFFFFFFFFFFFFFFF"),
				error: "calculation failed",
			};
		}
	};

	public getSpotPrice = (inputs: {
		coinInType: CoinType;
		coinOutType: CoinType;
		withFees?: boolean;
	}) => {
		return CmmmCalculations.calcSpotPriceWithFees(
			Helpers.deepCopy(this.pool),
			inputs.coinInType,
			inputs.coinOutType,
			!inputs.withFees
		);
	};

	public getDepositLpAmountOut = (inputs: {
		amountsIn: CoinsToBalance;
		// PRODUCTION: account for referral in calculation
		referral?: boolean;
	}): {
		lpAmountOut: Balance;
		lpRatio: number;
		error?: string;
	} => {
		try {
			let calcedLpRatio = CmmmCalculations.calcDepositFixedAmounts(
				this.pool,
				inputs.amountsIn
			);

			let error = undefined;
			let lpAmountOut: Balance;
			let lpRatio: number;

			if (calcedLpRatio >= Casting.fixedOneBigInt) {
				error = "lpRatio >= 1";
				lpRatio = 1;
				lpAmountOut = BigInt(0);
			} else {
				lpRatio = Casting.bigIntToFixedNumber(calcedLpRatio);
				lpAmountOut = BigInt(
					Math.floor(Number(this.pool.lpCoinSupply) * (1 - lpRatio))
				);
			}

			return {
				lpAmountOut,
				lpRatio,
				error,
			};
		} catch (e) {
			return {
				lpRatio: 1,
				lpAmountOut: BigInt(0),
				error: "calculation failed",
			};
		}
	};

	public getWithdrawAmountsOut = (inputs: {
		lpRatio: number;
		amountsOutDirection: CoinsToBalance;
		// PRODUCTION: account for referral in calculation
		referral?: boolean;
	}): {
		amountsOut: CoinsToBalance;
		error?: string;
	} => {
		try {
			const calcedAmountsOut = CmmmCalculations.calcWithdrawFlpAmountsOut(
				this.pool,
				inputs.amountsOutDirection,
				inputs.lpRatio
			);

			let amountsOut = { ...calcedAmountsOut };
			let error = undefined;

			for (const coin in Object.keys(calcedAmountsOut)) {
				if (calcedAmountsOut[coin] <= BigInt(0)) {
					if (error === undefined) error = "";

					error += `amountsOut[${coin}] <= 0 `;
					amountsOut = {};
				}
			}
			if (error !== undefined) error = error.trim();

			return {
				amountsOut,
				error,
			};
		} catch (e) {
			return {
				amountsOut: {},
				error: "calculation failed",
			};
		}
	};
}
