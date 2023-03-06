import { EventId, ObjectId } from "@mysten/sui.js";
import {
	AnyObjectType,
	ApiEventsBody,
	Balance,
	CoinType,
	EventsWithCursor,
	PoolAmountDynamicField,
	PoolDepositEvent,
	PoolDynamicFields,
	PoolObject,
	PoolSwapEvent,
	PoolSwapFee,
	PoolWeight,
	PoolWithdrawEvent,
	SuiNetwork,
} from "../../types";
import { Pool } from "./pool";
import { Coin } from "../../packages/coin/coin";
import { Aftermath } from "../../general/providers/aftermath";
import { Helpers } from "../../general/utils/helpers";

export class Pools extends Aftermath {
	/////////////////////////////////////////////////////////////////////
	//// Constants
	/////////////////////////////////////////////////////////////////////

	public static readonly constants = {
		lpCoinDecimals: 9,
		coinWeightDecimals: 18,
		spotPriceDecimals: 18,
		swapFeeDecimals: 18,
		maxSwapFee: BigInt(1000000000000000000),
	};

	private static readonly eventNames = {
		swap: "SwapEvent",
		deposit: "DepositEvent",
		withdraw: "WithdrawEvent",
	};

	/////////////////////////////////////////////////////////////////////
	//// Constructor
	/////////////////////////////////////////////////////////////////////

	constructor(public readonly network?: SuiNetwork) {
		super(network, "pools");
	}

	/////////////////////////////////////////////////////////////////////
	//// Class Objects
	/////////////////////////////////////////////////////////////////////

	public async getPool(poolObjectId: ObjectId): Promise<Pool> {
		const [pool, poolDynamicFields] = await Promise.all([
			this.fetchApi<PoolObject>(`${poolObjectId}`),
			this.fetchApi<PoolDynamicFields>(`${poolObjectId}/dynamicFields`),
		]);
		return new Pool(pool, poolDynamicFields, this.network);
	}

	public async getPools(poolObjectIds: ObjectId[]): Promise<Pool[]> {
		const pools = await Promise.all(poolObjectIds.map(this.getPool));
		return pools;
	}

	public async getAllPools(): Promise<Pool[]> {
		const pools = await this.fetchApi<PoolObject[]>("");
		const poolDynamicFields = await Promise.all(
			pools.map((pool) =>
				this.fetchApi<PoolDynamicFields>(
					`${pool.objectId}/dynamicFields`
				)
			)
		);
		return pools.map(
			(pool, index) =>
				new Pool(pool, poolDynamicFields[index], this.network)
		);
	}

	/////////////////////////////////////////////////////////////////////
	//// Events
	/////////////////////////////////////////////////////////////////////

	public async getDepositEvents(
		cursor?: EventId,
		limit?: number
	): Promise<EventsWithCursor<PoolDepositEvent>> {
		return this.fetchApi<EventsWithCursor<PoolDepositEvent>, ApiEventsBody>(
			"events/deposit",
			{
				cursor,
				limit,
			}
		);
	}

	public async getWithdrawEvents(
		cursor?: EventId,
		limit?: number
	): Promise<EventsWithCursor<PoolWithdrawEvent>> {
		return this.fetchApi<
			EventsWithCursor<PoolWithdrawEvent>,
			ApiEventsBody
		>("events/withdraw", {
			cursor,
			limit,
		});
	}

	public async getTradeEvents(
		cursor?: EventId,
		limit?: number
	): Promise<EventsWithCursor<PoolSwapEvent>> {
		return this.fetchApi<EventsWithCursor<PoolSwapEvent>, ApiEventsBody>(
			"events/trade",
			{
				cursor,
				limit,
			}
		);
	}

	/////////////////////////////////////////////////////////////////////
	//// Helpers
	/////////////////////////////////////////////////////////////////////

	public static sortCoinsByWeights = (
		coins: CoinType[],
		weights: PoolWeight[]
	) => {
		if (coins.length !== weights.length)
			throw new Error("coins and weights arrays are different lengths");
		const sortedCoinsWithWeights = weights
			.map((weight, index) => {
				return {
					coin: coins[index],
					weight: weight,
				};
			})
			.sort((a, b) =>
				Pools.coinWeightWithDecimals(a.weight) <
				Pools.coinWeightWithDecimals(b.weight)
					? 1
					: Pools.coinWeightWithDecimals(a.weight) >
					  Pools.coinWeightWithDecimals(b.weight)
					? -1
					: 0
			);

		return {
			coins: sortedCoinsWithWeights.map((coin) => coin.coin),
			weights: sortedCoinsWithWeights.map((coin) => coin.weight),
		};
	};

	public static sortDynamicFieldsToMatchPoolCoinOrdering = (
		dynamicFields: PoolDynamicFields,
		pool: PoolObject
	) => {
		const poolCoins = pool.fields.coins;

		let amountFields: PoolAmountDynamicField[] = [];
		for (const poolCoin of poolCoins) {
			const amountField = dynamicFields.amountFields.find(
				(field) => field.coin === poolCoin
			);
			if (!amountField) throw Error("coin not found in dynamic field");

			amountFields.push({ ...amountField });
		}

		const sortedDynamicFields = {
			...dynamicFields,
			amountFields,
		} as PoolDynamicFields;
		return sortedDynamicFields;
	};

	public static findPoolForLpCoin = (lpCoin: CoinType, pools: PoolObject[]) =>
		pools.find((pool) => {
			return pool.fields.lpType.includes(
				new Coin(new Coin(lpCoin).innerCoinType).coinTypeSymbol
			);
		});

	/////////////////////////////////////////////////////////////////////
	//// Type Checking
	/////////////////////////////////////////////////////////////////////

	// remove this once all LP coins have coin metadata ?
	public static isLpCoin = (coin: CoinType) => {
		// const poolsPackageId = config.indices.packages.pools;
		// return coin.includes(poolsPackageId);
		return coin.includes("AF_LP_");
	};

	public static isLpKeyType = (type: AnyObjectType) => type.includes("LpKey");
	public static isBalanceKeyType = (type: AnyObjectType) =>
		type.includes("BalanceKey");
	public static isAmountKeyType = (type: AnyObjectType) =>
		type.includes("AmountKey");

	/////////////////////////////////////////////////////////////////////
	//// Conversions
	/////////////////////////////////////////////////////////////////////

	public static coinWeightWithDecimals = (weight: PoolWeight) =>
		Number(weight) / 10 ** Pools.constants.coinWeightDecimals;

	public static spotPriceWithDecimals = (spotPrice: Balance) =>
		Number(spotPrice) / 10 ** Pools.constants.spotPriceDecimals;

	public static swapFeeWithDecimals = (swapFee: PoolSwapFee) =>
		Number(swapFee) / 10 ** Pools.constants.swapFeeDecimals;

	public static normalizeLpCoinBalance = (balance: number) =>
		Coin.normalizeBalance(balance, Pools.constants.lpCoinDecimals);

	public static normalizeLpCoinType = (lpCoinType: CoinType) => {
		return `0x${lpCoinType.replaceAll("<", "<0x")}`;
	};

	/////////////////////////////////////////////////////////////////////
	//// Display
	/////////////////////////////////////////////////////////////////////

	public static displayLpCoinType = (lpCoinType: CoinType): string =>
		new Coin(Coin.coinTypeFromKeyType(lpCoinType)).coinTypeSymbol
			.toLowerCase()
			.replace("af_lp_", "")
			.split("_")
			.map((word) => Helpers.capitalizeOnlyFirstLetter(word))
			.join(" ") + " LP";
}
