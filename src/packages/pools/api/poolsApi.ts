import { EventId, ObjectId, SuiAddress } from "@mysten/sui.js";
import { AftermathApi } from "../../../general/providers/aftermathApi";
import { PoolsApiHelpers } from "./poolsApiHelpers";
import { CoinType, CoinsToBalance, CoinsToPrice } from "../../coin/coinTypes";
import {
	Balance,
	PoolVolumeDataTimeframeKey,
	PoolDepositEvent,
	PoolStats,
	PoolTradeEvent,
	PoolWithdrawEvent,
	SerializedTransaction,
	Slippage,
} from "../../../types";
import { Coin } from "../../coin/coin";
import {
	PoolCreateEventOnChain,
	PoolDepositEventOnChain,
	PoolTradeEventOnChain,
	PoolWithdrawEventOnChain,
} from "./poolsApiCastingTypes";
import { Pools } from "../pools";
import { Casting } from "../../../general/utils/casting";
import { Pool } from "..";
import { EventsApiHelpers } from "../../../general/api/eventsApiHelpers";
import { Aftermath } from "../../../general/providers";

export class PoolsApi {
	/////////////////////////////////////////////////////////////////////
	//// Class Members
	/////////////////////////////////////////////////////////////////////

	public readonly Helpers;

	/////////////////////////////////////////////////////////////////////
	//// Constructor
	/////////////////////////////////////////////////////////////////////

	constructor(private readonly Provider: AftermathApi) {
		this.Provider = Provider;
		this.Helpers = new PoolsApiHelpers(Provider);
	}

	/////////////////////////////////////////////////////////////////////
	//// Public Methods
	/////////////////////////////////////////////////////////////////////

	/////////////////////////////////////////////////////////////////////
	//// Events
	/////////////////////////////////////////////////////////////////////

	public fetchTradeEvents = async (
		cursor?: EventId,
		limit?: number,
		poolObjectId?: ObjectId
	) =>
		await this.Provider.Events().fetchCastEventsWithCursor<
			PoolTradeEventOnChain,
			PoolTradeEvent
		>(
			poolObjectId
				? {
						All: [
							{ MoveEventType: this.Helpers.eventTypes.trade },
							{
								MoveEventField: {
									path: "pool_id",
									value: poolObjectId,
								},
							},
						],
				  }
				: { MoveEventType: this.Helpers.eventTypes.trade },
			Casting.pools.poolTradeEventFromOnChain,
			cursor,
			limit
		);

	public fetchDepositEvents = async (
		cursor?: EventId,
		limit?: number,
		poolObjectId?: ObjectId
	) =>
		await this.Provider.Events().fetchCastEventsWithCursor<
			PoolDepositEventOnChain,
			PoolDepositEvent
		>(
			poolObjectId
				? {
						All: [
							{ MoveEventType: this.Helpers.eventTypes.deposit },
							{
								MoveEventField: {
									path: "pool_id",
									value: poolObjectId,
								},
							},
						],
				  }
				: { MoveEventType: this.Helpers.eventTypes.deposit },
			Casting.pools.poolDepositEventFromOnChain,
			cursor,
			limit
		);

	public fetchWithdrawEvents = async (
		cursor?: EventId,
		limit?: number,
		poolObjectId?: ObjectId
	) =>
		await this.Provider.Events().fetchCastEventsWithCursor<
			PoolWithdrawEventOnChain,
			PoolWithdrawEvent
		>(
			poolObjectId
				? {
						All: [
							{ MoveEventType: this.Helpers.eventTypes.withdraw },
							{
								MoveEventField: {
									path: "pool_id",
									value: poolObjectId,
								},
							},
						],
				  }
				: { MoveEventType: this.Helpers.eventTypes.withdraw },
			Casting.pools.poolWithdrawEventFromOnChain,
			cursor,
			limit
		);

	/////////////////////////////////////////////////////////////////////
	//// Objects
	/////////////////////////////////////////////////////////////////////

	public fetchPool = async (objectId: ObjectId) => {
		return this.Provider.Objects().fetchCastObject(
			objectId,
			Casting.pools.poolObjectFromSuiObject
		);
	};

	public fetchPools = async (objectIds: ObjectId[]) => {
		return this.Provider.Objects().fetchCastObjectBatch(
			objectIds,
			Casting.pools.poolObjectFromSuiObject
		);
	};

	public fetchAllPools = async () => {
		const paginatedEvents = await this.Provider.provider.queryEvents({
			query: {
				MoveEventType: EventsApiHelpers.createEventType(
					this.Helpers.addresses.packages.cmmm,
					"events",
					"CreatedPoolEvent"
				),
			},
			cursor: null,
			limit: null,
			order: "ascending",
		});

		const poolObjectIds = paginatedEvents.data.map(
			(event) => (event as PoolCreateEventOnChain).parsedJson.pool_id
		);

		return this.fetchPools(poolObjectIds);
	};

	/////////////////////////////////////////////////////////////////////
	//// Transactions
	/////////////////////////////////////////////////////////////////////

	public fetchDepositTransaction = async (
		walletAddress: SuiAddress,
		poolObjectId: ObjectId,
		poolLpType: CoinType,
		depositCoinsToBalance: CoinsToBalance,
		slippage: Slippage
	): Promise<SerializedTransaction> => {
		const { coins, balances } = Coin.coinsAndBalancesOverZero(
			depositCoinsToBalance
		);
		const transaction = await this.Helpers.fetchBuildDepositTransaction(
			walletAddress,
			poolObjectId,
			poolLpType,
			coins,
			balances,
			slippage
		);
		return transaction.serialize();
	};

	public fetchWithdrawTransaction = async (
		walletAddress: SuiAddress,
		poolObjectId: ObjectId,
		poolLpType: CoinType,
		withdrawCoinsToBalance: CoinsToBalance,
		slippage: Slippage
	): Promise<SerializedTransaction> => {
		const { coins, balances } = Coin.coinsAndBalancesOverZero(
			withdrawCoinsToBalance
		);
		const transaction = await this.Helpers.fetchBuildWithdrawTransaction(
			walletAddress,
			poolObjectId,
			poolLpType,
			coins,
			balances,
			slippage
		);
		return transaction.serialize();
	};

	public fetchTradeTransaction = async (
		walletAddress: SuiAddress,
		poolObjectId: ObjectId,
		poolLpType: CoinType,
		fromCoin: CoinType,
		fromCoinBalance: Balance,
		toCoinType: CoinType,
		slippage: Slippage
	): Promise<SerializedTransaction> => {
		const transaction = await this.Helpers.fetchBuildTradeTransaction(
			walletAddress,
			poolObjectId,
			poolLpType,
			fromCoin,
			fromCoinBalance,
			toCoinType,
			slippage
		);
		return transaction.serialize();
	};

	/////////////////////////////////////////////////////////////////////
	//// Inspections
	/////////////////////////////////////////////////////////////////////

	public fetchPoolObjectIdForLpCoinTypeDevInspectTransaction = async (
		lpCoinType: CoinType
	): Promise<ObjectId> => {
		const tx =
			this.Helpers.poolObjectIdForLpCoinTypeDevInspectTransaction(
				lpCoinType
			);
		const bytes =
			await this.Provider.Inspections().fetchBytesFromTransaction(tx);
		return Casting.stringFromBytes(bytes);
	};

	/////////////////////////////////////////////////////////////////////
	//// Stats
	/////////////////////////////////////////////////////////////////////

	// TODO: use promise.all to execute some of this fetching in parallel
	public fetchPoolStats = async (
		pool: Pool,
		coinsToPrice: CoinsToPrice
	): Promise<PoolStats> => {
		const poolObjectId = pool.pool.objectId;
		const poolCoins = pool.pool.coins;
		const poolCoinTypes = Object.keys(poolCoins);

		const prices = Object.entries(coinsToPrice).map(([_, price]) => price);

		const coinsToDecimals =
			await this.Provider.Coin().Helpers.fetchCoinsToDecimals(
				poolCoinTypes
			);

		const tradeEventsWithinTime =
			await this.Provider.Events().fetchEventsWithinTime(
				this.fetchTradeEvents,
				"hour",
				24
			);
		const volume = this.Helpers.fetchCalcPoolVolume(
			poolObjectId,
			poolCoinTypes,
			tradeEventsWithinTime,
			prices,
			coinsToDecimals
		);

		const tvl = await this.Helpers.fetchCalcPoolTvl(
			pool.pool.coins,
			coinsToPrice,
			coinsToDecimals
		);
		const supplyPerLps = this.Helpers.calcPoolSupplyPerLps(
			poolCoins,
			pool.pool.lpCoinSupply
		);
		const lpPrice = this.Helpers.calcPoolLpPrice(
			pool.pool.lpCoinSupply,
			tvl
		);

		return {
			volume,
			tvl,
			supplyPerLps,
			lpPrice,
			// TODO: perform actual calculations for these values
			fees: 523.32,
			aprRange: [13.22, 16.73],
		};
	};

	/////////////////////////////////////////////////////////////////////
	//// Prices
	/////////////////////////////////////////////////////////////////////

	// TODO: make this faster this is slow as shit when LP balances are involved...
	// (so much fetching!)
	// TODO: rename this function and/or move it ?
	public fetchLpCoinsToPrice = async (
		provider: Aftermath,
		lpCoinTypes: CoinType[]
	) => {
		const lpCoins = lpCoinTypes.filter(Pools.isLpCoin);
		const lpCoinPoolObjectIds = await Promise.all(
			lpCoins.map((lpCoinType) =>
				provider.Pools().getPoolObjectIdForLpCoinType({ lpCoinType })
			)
		);
		const lpCoinPools = await provider
			.Pools()
			.getPools(lpCoinPoolObjectIds);

		const poolStats = await Promise.all(
			lpCoinPools.map((lpPool) => lpPool.getStats())
		);

		let lpCoinsToPrice: CoinsToPrice = {};

		for (const [index, lpCoin] of lpCoins.entries()) {
			const stats = poolStats[index];
			lpCoinsToPrice = {
				...lpCoinsToPrice,
				[lpCoin]: stats.lpPrice,
			};
		}

		return lpCoinsToPrice;
	};

	/////////////////////////////////////////////////////////////////////
	//// Graph Data
	/////////////////////////////////////////////////////////////////////

	public fetchPoolVolumeData = async (
		poolObjectId: ObjectId,
		timeframe: PoolVolumeDataTimeframeKey
	) => {
		const timeframeValue = this.Helpers.poolVolumeDataTimeframes[timeframe];

		const [pool, tradeEvents] = await Promise.all([
			this.fetchPool(poolObjectId),
			(
				await this.Provider.Events().fetchEventsWithinTime(
					this.fetchTradeEvents,
					timeframeValue.timeUnit,
					timeframeValue.time
				)
			).filter((trade) => trade.poolId === poolObjectId),
		]);

		return await this.Helpers.fetchCalcPoolVolumeData(
			pool,
			tradeEvents,
			timeframeValue.timeUnit,
			timeframeValue.time,
			timeframeValue.time
		);
	};
}
