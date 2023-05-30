import {
	CoinMetadata,
	CoinStruct,
	ObjectId,
	PaginatedCoins,
	SuiAddress,
	TransactionArgument,
	TransactionBlock,
} from "@mysten/sui.js";
import { Coin } from "../coin";
import { AftermathApi } from "../../../general/providers/aftermathApi";
import { Balance, CoinType } from "../../../types";
import { Helpers } from "../../../general/utils/helpers";
import { Pools } from "../../pools/pools";
import { Casting } from "../../../general/utils";

export class CoinApi {
	/////////////////////////////////////////////////////////////////////
	//// Constructor
	/////////////////////////////////////////////////////////////////////

	constructor(private readonly Provider: AftermathApi) {
		this.Provider = Provider;
	}

	/////////////////////////////////////////////////////////////////////
	//// Inspections
	/////////////////////////////////////////////////////////////////////

	public fetchCoinMetadata = async (
		coin: CoinType
	): Promise<CoinMetadata> => {
		try {
			const coinMetadata = await this.Provider.provider.getCoinMetadata({
				coinType: Helpers.stripLeadingZeroesFromType(coin),
			});
			if (coinMetadata === null) throw new Error("coin metadata is null");

			return coinMetadata;
		} catch (error) {
			if (this.Provider.Pools().isLpCoin(coin)) {
				return this.createLpCoinMetadata({ lpCoinType: coin });
			}

			const coinClass = new Coin(coin);
			const symbol = coinClass.coinTypeSymbol;
			const packageName = coinClass.coinTypePackageName;
			return {
				symbol: symbol.toUpperCase(),
				id: null,
				description: `${symbol} (${packageName})`,
				name: symbol
					.split("_")
					.map((word) => Helpers.capitalizeOnlyFirstLetter(word))
					.join(" "),
				decimals: 9,
				iconUrl: null,
			};
		}
	};

	/////////////////////////////////////////////////////////////////////
	//// Transaction Builders
	/////////////////////////////////////////////////////////////////////

	public fetchCoinWithAmountTx = async (inputs: {
		tx: TransactionBlock;
		walletAddress: SuiAddress;
		coinType: CoinType;
		coinAmount: Balance;
	}): Promise<TransactionArgument> => {
		const { tx, walletAddress, coinType, coinAmount } = inputs;

		tx.setSender(walletAddress);

		const coinData = await this.fetchCoinsUntilAmountReachedOrEnd(inputs);
		return CoinApi.coinWithAmountTx({
			tx,
			coinData,
			coinAmount,
		});
	};

	public fetchCoinsWithAmountTx = async (inputs: {
		tx: TransactionBlock;
		walletAddress: SuiAddress;
		coinTypes: CoinType[];
		coinAmounts: Balance[];
	}): Promise<TransactionArgument[]> => {
		const { tx, walletAddress, coinTypes, coinAmounts } = inputs;

		tx.setSender(walletAddress);

		// TODO: handle cursoring until necessary coin amount is found
		const allCoinsData = await Promise.all(
			coinTypes.map(async (coinType, index) =>
				this.fetchCoinsUntilAmountReachedOrEnd({
					...inputs,
					coinAmount: coinAmounts[index],
					coinType,
				})
			)
		);

		let coinArgs: TransactionArgument[] = [];
		for (const [index, coinData] of allCoinsData.entries()) {
			const coinArg = CoinApi.coinWithAmountTx({
				tx,
				coinData,
				coinAmount: coinAmounts[index],
			});

			coinArgs = [...coinArgs, coinArg];
		}

		return coinArgs;
	};

	/////////////////////////////////////////////////////////////////////
	//// Helpers
	/////////////////////////////////////////////////////////////////////

	public static formatCoinTypesForMoveCall = (coins: CoinType[]) =>
		coins.map((coin) => Casting.u8VectorFromString(coin.slice(2))); // slice to remove 0x

	/////////////////////////////////////////////////////////////////////
	//// Private Methods
	/////////////////////////////////////////////////////////////////////

	/////////////////////////////////////////////////////////////////////
	//// Helpers
	/////////////////////////////////////////////////////////////////////

	private fetchCoinsUntilAmountReachedOrEnd = async (inputs: {
		walletAddress: SuiAddress;
		coinType: CoinType;
		coinAmount: Balance;
	}) => {
		let allCoinData: CoinStruct[] = [];
		let cursor: string | undefined = undefined;
		do {
			const paginatedCoins: PaginatedCoins =
				await this.Provider.provider.getCoins({
					...inputs,
					owner: inputs.walletAddress,
					cursor,
				});

			const coinData = paginatedCoins.data.filter(
				(data) =>
					!data.lockedUntilEpoch && BigInt(data.balance) > BigInt(0)
			);
			allCoinData = [...allCoinData, ...coinData];

			const totalAmount = Helpers.sumBigInt(
				allCoinData.map((data) => BigInt(data.balance))
			);
			if (totalAmount >= inputs.coinAmount) return allCoinData;

			if (
				paginatedCoins.data.length === 0 ||
				!paginatedCoins.hasNextPage ||
				!paginatedCoins.nextCursor
			)
				return allCoinData;

			cursor = paginatedCoins.nextCursor;
		} while (true);
	};

	// NOTE: this is temporary until LP coin metadata issue is solved on Sui
	private createLpCoinMetadata = async (inputs: {
		lpCoinType: CoinType;
	}): Promise<CoinMetadata> => {
		try {
			const PoolsApi = this.Provider.Pools();

			// TODO: find the best way to do all of this using cached server data
			const poolObjectId = await PoolsApi.fetchPoolObjectIdForLpCoinType(
				inputs
			);
			const pool = await PoolsApi.fetchPool({ objectId: poolObjectId });

			const maxCoinSymbolLength = 5;
			const notPrettyCoinSymbol =
				pool.name.length > maxCoinSymbolLength
					? pool.name.toUpperCase().slice(0, maxCoinSymbolLength)
					: pool.name.toUpperCase();
			const coinSymbol =
				notPrettyCoinSymbol.slice(-1) === "_"
					? notPrettyCoinSymbol.slice(0, -1)
					: notPrettyCoinSymbol;

			const coinName = pool.name
				.split(" ")
				.map((word) => Helpers.capitalizeOnlyFirstLetter(word))
				.join(" ");

			const coinDescription =
				await PoolsApi.createLpCoinMetadataDescription({
					poolName: pool.name,
					coinTypes: Object.keys(pool.coins),
				});

			return {
				symbol: `AF_LP_${coinSymbol}`,
				id: null,
				description: coinDescription,
				name: `Af Lp ${coinName}`,
				decimals: Pools.constants.decimals.lpCoinDecimals,
				iconUrl: null,
			};
		} catch (e) {
			return {
				symbol: "AF_LP",
				id: null,
				description: "Aftermath Finance LP",
				name: "Af Lp",
				decimals: Pools.constants.decimals.lpCoinDecimals,
				iconUrl: null,
			};
		}
	};

	/////////////////////////////////////////////////////////////////////
	//// Private Static Methods
	/////////////////////////////////////////////////////////////////////

	private static coinWithAmountTx = (inputs: {
		tx: TransactionBlock;
		coinData: CoinStruct[];
		coinAmount: Balance;
	}): TransactionArgument => {
		const { tx, coinData, coinAmount } = inputs;

		const isSuiCoin = Coin.isSuiCoin(coinData[0].coinType);

		const totalCoinBalance = Helpers.sumBigInt(
			coinData.map((data) => BigInt(data.balance))
		);
		if (totalCoinBalance < coinAmount)
			throw new Error("wallet does not have coins of sufficient balance");

		if (isSuiCoin) {
			tx.setGasPayment(
				coinData.map((obj) => {
					return {
						...obj,
						objectId: obj.coinObjectId,
					};
				})
			);

			return tx.splitCoins(tx.gas, [tx.pure(coinAmount)]);
		}

		const coinObjectIds = coinData.map((data) => data.coinObjectId);
		const mergedCoinObjectId: ObjectId = coinObjectIds[0];

		if (coinObjectIds.length > 1) {
			tx.add({
				kind: "MergeCoins",
				destination: tx.object(mergedCoinObjectId),
				sources: [
					...coinObjectIds
						.slice(1)
						.map((coinId) => tx.object(coinId)),
				],
			});
		}

		return tx.add({
			kind: "SplitCoins",
			coin: tx.object(mergedCoinObjectId),
			amounts: [tx.pure(coinAmount)],
		});
	};
}
