import { AftermathApi } from "../../../general/providers";
import { CoinType } from "../../coin/coinTypes";
import { Casting, Helpers } from "../../../general/utils";
import {
	DeepBookPoolObject,
	DeepBookPriceRange,
	PartialDeepBookPoolObject,
} from "./deepBookTypes";
import { RouterApiInterface } from "../../router/utils/synchronous/interfaces/routerApiInterface";
import {
	ObjectId,
	SuiAddress,
	TransactionArgument,
	TransactionBlock,
	bcs,
} from "@mysten/sui.js";
import { EventsApiHelpers } from "../../../general/api/eventsApiHelpers";
import { EventOnChain } from "../../../general/types/castingTypes";
import { Sui } from "../../sui";
import {
	AnyObjectType,
	Balance,
	BigIntAsString,
	Byte,
	DeepBookAddresses,
} from "../../../types";
import { Coin } from "../../coin";
import { RouterPoolTradeTxInputs } from "../../router";
import { BCS } from "@mysten/bcs";

export class DeepBookApi implements RouterApiInterface<DeepBookPoolObject> {
	// =========================================================================
	//  Constants
	// =========================================================================

	private static readonly constants = {
		moduleNames: {
			clobV2: "clob_v2",
			custodianV2: "custodian_v2",
			wrapper: "router",
		},
		poolCreationFeeInSui: BigInt("100000000000"), // 100 SUI
		floatDecimals: 9,
	};

	// =========================================================================
	//  Class Members
	// =========================================================================

	public readonly addresses: DeepBookAddresses;

	public readonly objectTypes: {
		accountCap: AnyObjectType;
	};

	// =========================================================================
	//  Constructor
	// =========================================================================

	constructor(private readonly Provider: AftermathApi) {
		const deepBookAddresses = this.Provider.addresses.router?.deepBook;

		if (!deepBookAddresses)
			throw new Error(
				"not all required addresses have been set in provider"
			);

		this.addresses = deepBookAddresses;
		this.objectTypes = {
			accountCap: `${deepBookAddresses.packages.clob}::${DeepBookApi.constants.moduleNames.custodianV2}::AccountCap`,
		};
	}

	// =========================================================================
	//  Public Methods
	// =========================================================================

	// =========================================================================
	//  Objects
	// =========================================================================

	public fetchAllPools = async (): Promise<DeepBookPoolObject[]> => {
		const partialPools = await this.fetchAllPartialPools();

		const pools = await Promise.all(
			partialPools.map((pool) =>
				this.fetchCreateCompletePoolObjectFromPartial({ pool })
			)
		);

		return pools;
	};

	public fetchAllPartialPools = async (): Promise<
		PartialDeepBookPoolObject[]
	> => {
		const partialPools = await this.Provider.Events().fetchAllEvents({
			fetchEventsFunc: (eventsInputs) =>
				this.Provider.Events().fetchCastEventsWithCursor<
					EventOnChain<{
						pool_id: ObjectId;
						base_asset: {
							name: string;
						};
						quote_asset: {
							name: string;
						};
						taker_fee_rate: BigIntAsString;
					}>,
					PartialDeepBookPoolObject
				>({
					...eventsInputs,
					query: {
						MoveEventType: EventsApiHelpers.createEventType(
							this.addresses.packages.clob,
							DeepBookApi.constants.moduleNames.clobV2,
							"PoolCreated"
						),
					},
					eventFromEventOnChain: (eventOnChain) => {
						return {
							objectId: eventOnChain.parsedJson.pool_id,
							baseCoinType:
								"0x" + eventOnChain.parsedJson.base_asset.name,
							quoteCoinType:
								"0x" + eventOnChain.parsedJson.quote_asset.name,
							takerFeeRate: Coin.balanceWithDecimals(
								BigInt(eventOnChain.parsedJson.taker_fee_rate),
								DeepBookApi.constants.floatDecimals
							),
						};
					},
				}),
		});

		return partialPools;
	};

	public fetchCreateCompletePoolObjectFromPartial = async (inputs: {
		pool: PartialDeepBookPoolObject;
	}): Promise<DeepBookPoolObject> => {
		const { pool } = inputs;

		const [bids, asks] = await Promise.all([
			this.fetchBookState({
				pool,
				coinInType: pool.baseCoinType,
				coinOutType: pool.quoteCoinType,
			}),
			this.fetchBookState({
				pool,
				coinInType: pool.quoteCoinType,
				coinOutType: pool.baseCoinType,
			}),
		]);

		return {
			...pool,
			bids,
			asks,
		};
	};

	public fetchOwnedAccountCapObjectId = async (inputs: {
		walletAddress: SuiAddress;
	}): Promise<ObjectId> => {
		// TODO: handle multiple accounts ?
		const accountCaps =
			await this.Provider.Objects().fetchObjectsOfTypeOwnedByAddress({
				...inputs,
				objectType: this.objectTypes.accountCap,
			});
		if (accountCaps.length <= 0)
			throw new Error("unable to find account cap owned by address");

		const accountCapId = accountCaps[0].data?.objectId;
		if (!accountCapId)
			throw new Error("unable to find account cap owned by address");

		return accountCapId;
	};

	// =========================================================================
	//  Async Router Pool Api Interface Methods
	// =========================================================================

	public fetchPoolsForTrade = async (inputs: {
		coinInType: CoinType;
		coinOutType: CoinType;
	}): Promise<{
		partialMatchPools: DeepBookPoolObject[];
		exactMatchPools: DeepBookPoolObject[];
	}> => {
		const possiblePools = await this.fetchPoolsForCoinType({
			coinType: inputs.coinOutType,
		});

		const [exactMatchPools, partialMatchPools] = Helpers.bifilter(
			possiblePools,
			(pool) =>
				DeepBookApi.isPoolForCoinTypes({
					pool,
					coinType1: inputs.coinInType,
					coinType2: inputs.coinOutType,
				})
		);

		return {
			exactMatchPools,
			partialMatchPools,
		};
	};

	public fetchTradeAmountOut = async (inputs: {
		pool: DeepBookPoolObject;
		coinInType: CoinType;
		coinOutType: CoinType;
		coinInAmount: Balance;
	}): Promise<Balance> => {
		return this.fetchCalcTradeAmountOut(inputs);
	};

	public otherCoinInPool = (inputs: {
		coinType: CoinType;
		pool: DeepBookPoolObject;
	}) => {
		return DeepBookApi.isBaseCoinType(inputs)
			? inputs.pool.quoteCoinType
			: inputs.pool.baseCoinType;
	};

	// =========================================================================
	//  Inspections
	// =========================================================================

	public fetchSupportedCoins = async (): Promise<CoinType[]> => {
		const pools = await this.fetchAllPartialPools();
		const allCoins = pools.reduce(
			(acc, pool) => [...acc, pool.baseCoinType, pool.quoteCoinType],
			[] as CoinType[]
		);
		return Helpers.uniqueArray(allCoins);
	};

	public fetchCalcTradeAmountOut = async (inputs: {
		pool: DeepBookPoolObject;
		coinInType: CoinType;
		coinOutType: CoinType;
		coinInAmount: Balance;
	}): Promise<Balance> => {
		const tx = new TransactionBlock();
		tx.setSender(Helpers.rpc.constants.devInspectSigner);

		const coinInStructName = new Coin(inputs.coinInType).coinTypeSymbol;
		const coinOutStructName = new Coin(inputs.coinOutType).coinTypeSymbol;
		this.registerTradeBcsStructs({
			coinStructNames: [coinInStructName, coinOutStructName],
		});

		/*

		struct RouterFeeMetadata has copy, drop {
			recipient: address,
			fee: u64,
		}

		struct SwapMetadata has copy, drop {
			type: vector<u8>,
			amount: u64,
		}
		
		struct RouterSwapCap<phantom CS> {
			coin_in: Coin<CS>,
			min_amount_out: u64,
			first_swap: SwapMetadata,
			previous_swap: SwapMetadata,
			final_swap: SwapMetadata,
			router_fee_metadata: RouterFeeMetadata,
			referrer: Option<address>,
		}

		*/

		const coinInBytes = bcs
			.ser(`Coin<${coinInStructName}>`, {
				id: {
					id: {
						bytes: "0x0000000000000000000000000000000000000000000000000000000000000123",
					},
				},
				balance: {
					value: inputs.coinInAmount,
				},
			})
			.toBytes();

		const routerSwapCapBytes = bcs
			.ser(`RouterSwapCap<${coinInStructName}>`, {
				coin_in: {
					id: {
						id: {
							bytes: "0x0000000000000000000000000000000000000000000000000000000000000321",
						},
					},
					balance: {
						value: inputs.coinInAmount,
					},
				},
				min_amount_out: 0,
				first_swap: {
					type: Casting.u8VectorFromString(
						inputs.coinInType.replace("0x", "")
					),
					amount: inputs.coinInAmount,
				},
				previous_swap: {
					type: Casting.u8VectorFromString(
						inputs.coinInType.replace("0x", "")
					),
					amount: inputs.coinInAmount,
				},
				final_swap: {
					type: Casting.u8VectorFromString(
						inputs.coinOutType.replace("0x", "")
					),
					amount: 0,
				},
				router_fee_metadata: {
					recipient:
						"0x0000000000000000000000000000000000000000000000000000000000000000",
					fee: 0,
				},
				referrer: {
					None: true,
				},
			})
			.toBytes();

		const commandInputs = {
			tx,
			...inputs,
			poolObjectId: inputs.pool.objectId,
			routerSwapCapCoinType: inputs.coinInType,
			coinInBytes,
			routerSwapCapBytes,
		};

		if (
			DeepBookApi.isBaseCoinType({
				...inputs,
				coinType: inputs.coinInType,
			})
		) {
			await this.tradeBaseToQuoteDevInspectTx(commandInputs);
		} else {
			await this.tradeQuoteToBaseDevInspectTx(commandInputs);
		}

		const resultBytes =
			await this.Provider.Inspections().fetchFirstBytesFromTxOutput(tx);

		const data = bcs.de(
			`Coin<${coinOutStructName}>`,
			new Uint8Array(resultBytes)
		);

		return BigInt(data.balance.value);
	};

	// =========================================================================
	//  Transaction Commands
	// =========================================================================

	public tradeBaseToQuoteTx = (
		inputs: RouterPoolTradeTxInputs & {
			poolObjectId: ObjectId;
		}
	) /* (Coin) */ => {
		const { tx, coinInId } = inputs;

		return tx.moveCall({
			target: Helpers.transactions.createTxTarget(
				this.addresses.packages.wrapper,
				DeepBookApi.constants.moduleNames.wrapper,
				"swap_exact_base_for_quote"
			),
			typeArguments: [
				inputs.routerSwapCapCoinType,
				inputs.coinInType,
				inputs.coinOutType,
			],
			arguments: [
				tx.object(this.addresses.objects.wrapperApp),
				inputs.routerSwapCap,

				tx.object(inputs.poolObjectId),
				typeof coinInId === "string" ? tx.object(coinInId) : coinInId,
				tx.object(Sui.constants.addresses.suiClockId),
			],
		});
	};

	public tradeQuoteToBaseTx = (
		inputs: RouterPoolTradeTxInputs & {
			poolObjectId: ObjectId;
		}
	) /* (Coin) */ => {
		const { tx, coinInId } = inputs;

		return tx.moveCall({
			target: Helpers.transactions.createTxTarget(
				this.addresses.packages.wrapper,
				DeepBookApi.constants.moduleNames.wrapper,
				"swap_exact_quote_for_base"
			),
			typeArguments: [
				inputs.routerSwapCapCoinType,
				inputs.coinOutType,
				inputs.coinInType,
			],
			arguments: [
				tx.object(this.addresses.objects.wrapperApp),
				inputs.routerSwapCap,

				tx.object(inputs.poolObjectId),
				typeof coinInId === "string" ? tx.object(coinInId) : coinInId,
				tx.object(Sui.constants.addresses.suiClockId),
			],
		});
	};

	public getAsksTx = (inputs: {
		tx: TransactionBlock;
		poolObjectId: ObjectId;
		baseCoinType: CoinType;
		quoteCoinType: CoinType;
	}) /* (vector<u64> (prices), vector<u64> (depths)) */ => {
		const { tx } = inputs;
		return tx.moveCall({
			target: Helpers.transactions.createTxTarget(
				this.addresses.packages.clob,
				DeepBookApi.constants.moduleNames.clobV2,
				"get_level2_book_status_ask_side"
			),
			typeArguments: [inputs.baseCoinType, inputs.quoteCoinType],
			arguments: [
				tx.object(inputs.poolObjectId),
				tx.pure(Casting.zeroBigInt.toString(), "u64"), // price_low
				tx.pure(Casting.u64MaxBigInt.toString(), "u64"), // price_high
				tx.object(Sui.constants.addresses.suiClockId),
			],
		});
	};

	public getBidsTx = (inputs: {
		tx: TransactionBlock;
		poolObjectId: ObjectId;
		baseCoinType: CoinType;
		quoteCoinType: CoinType;
	}) /* (vector<u64> (prices), vector<u64> (depths)) */ => {
		const { tx } = inputs;
		return tx.moveCall({
			target: Helpers.transactions.createTxTarget(
				this.addresses.packages.clob,
				DeepBookApi.constants.moduleNames.clobV2,
				"get_level2_book_status_bid_side"
			),
			typeArguments: [inputs.baseCoinType, inputs.quoteCoinType],
			arguments: [
				tx.object(inputs.poolObjectId),
				tx.pure(Casting.zeroBigInt.toString(), "u64"), // price_low
				tx.pure(Casting.u64MaxBigInt.toString(), "u64"), // price_high
				tx.object(Sui.constants.addresses.suiClockId),
			],
		});
	};

	// =========================================================================
	//  Pool Setup Transaction Commands
	// =========================================================================

	public createPoolTx = (inputs: {
		tx: TransactionBlock;
		tickSize: bigint;
		lotSize: bigint;
		suiFeeCoinId: ObjectId | TransactionArgument;
		baseCoinType: CoinType;
		quoteCoinType: CoinType;
	}) => {
		const { tx, suiFeeCoinId } = inputs;
		return tx.moveCall({
			target: AftermathApi.helpers.transactions.createTxTarget(
				this.addresses.packages.clob,
				DeepBookApi.constants.moduleNames.clobV2,
				"create_pool"
			),
			typeArguments: [inputs.baseCoinType, inputs.quoteCoinType],
			arguments: [
				tx.pure(inputs.tickSize, "u64"),
				tx.pure(inputs.lotSize, "u64"),
				typeof suiFeeCoinId === "string"
					? tx.object(suiFeeCoinId)
					: suiFeeCoinId,
			],
		});
	};

	public createAccountTx = (inputs: {
		tx: TransactionBlock;
	}) /* AccountCap */ => {
		const { tx } = inputs;
		return tx.moveCall({
			target: AftermathApi.helpers.transactions.createTxTarget(
				this.addresses.packages.clob,
				DeepBookApi.constants.moduleNames.clobV2,
				"create_account"
			),
			typeArguments: [],
			arguments: [],
		});
	};

	public depositBaseTx = (inputs: {
		tx: TransactionBlock;
		poolObjectId: ObjectId;
		baseCoinId: ObjectId | TransactionArgument;
		accountCapId: ObjectId | TransactionArgument;
		baseCoinType: CoinType;
		quoteCoinType: CoinType;
	}) => {
		const { tx, baseCoinId, accountCapId } = inputs;
		return tx.moveCall({
			target: AftermathApi.helpers.transactions.createTxTarget(
				this.addresses.packages.clob,
				DeepBookApi.constants.moduleNames.clobV2,
				"deposit_base"
			),
			typeArguments: [inputs.baseCoinType, inputs.quoteCoinType],
			arguments: [
				tx.object(inputs.poolObjectId),
				typeof baseCoinId === "string"
					? tx.object(baseCoinId)
					: baseCoinId,
				typeof accountCapId === "string"
					? tx.object(accountCapId)
					: accountCapId,
			],
		});
	};

	public depositQuoteTx = (inputs: {
		tx: TransactionBlock;
		poolObjectId: ObjectId;
		quoteCoinId: ObjectId | TransactionArgument;
		accountCapId: ObjectId | TransactionArgument;
		baseCoinType: CoinType;
		quoteCoinType: CoinType;
	}) => {
		const { tx, quoteCoinId, accountCapId } = inputs;
		return tx.moveCall({
			target: AftermathApi.helpers.transactions.createTxTarget(
				this.addresses.packages.clob,
				DeepBookApi.constants.moduleNames.clobV2,
				"deposit_quote"
			),
			typeArguments: [inputs.baseCoinType, inputs.quoteCoinType],
			arguments: [
				tx.object(inputs.poolObjectId),
				typeof quoteCoinId === "string"
					? tx.object(quoteCoinId)
					: quoteCoinId,
				typeof accountCapId === "string"
					? tx.object(accountCapId)
					: accountCapId,
			],
		});
	};

	public placeLimitOrderTx = (inputs: {
		tx: TransactionBlock;
		poolObjectId: ObjectId;
		accountCapId: ObjectId | TransactionArgument;
		price: bigint;
		quantity: Balance;
		isBidOrder: boolean;
		baseCoinType: CoinType;
		quoteCoinType: CoinType;
	}) => {
		const { tx, accountCapId } = inputs;
		return tx.moveCall({
			target: AftermathApi.helpers.transactions.createTxTarget(
				this.addresses.packages.clob,
				DeepBookApi.constants.moduleNames.clobV2,
				"place_limit_order"
			),
			typeArguments: [inputs.baseCoinType, inputs.quoteCoinType],
			arguments: [
				tx.object(inputs.poolObjectId),
				tx.pure(inputs.price, "u64"),
				tx.pure(inputs.quantity, "u64"),
				tx.pure(inputs.isBidOrder, "bool"),
				tx.pure(Casting.u64MaxBigInt.toString(), "u64"), // expire_timestamp
				tx.pure(3, "u8"), // restriction (0 = NO_RESTRICTION, 1 = IMMEDIATE_OR_CANCEL, 2 = FILL_OR_KILL, 3 = POST_OR_ABORT)
				tx.object(Sui.constants.addresses.suiClockId),
				typeof accountCapId === "string"
					? tx.object(accountCapId)
					: accountCapId,
			],
		});
	};

	// =========================================================================
	//  Transaction Command Wrappers
	// =========================================================================

	public tradeTx = (
		inputs: RouterPoolTradeTxInputs & {
			pool: PartialDeepBookPoolObject;
		}
	) /* (Coin) */ => {
		const commandInputs = {
			...inputs,
			poolObjectId: inputs.pool.objectId,
		};

		if (
			Helpers.stripLeadingZeroesFromType(inputs.coinInType) ===
			Helpers.stripLeadingZeroesFromType(inputs.pool.baseCoinType)
		) {
			return this.tradeBaseToQuoteTx(commandInputs);
		}

		return this.tradeQuoteToBaseTx(commandInputs);
	};

	public getBookPricesAndDepthsTx = (inputs: {
		tx: TransactionBlock;
		pool: PartialDeepBookPoolObject;
		coinInType: CoinType;
		coinOutType: CoinType;
	}) /* (vector<u64> (prices), vector<u64> (depths)) */ => {
		const commandInputs = {
			...inputs,
			poolObjectId: inputs.pool.objectId,
			baseCoinType: inputs.pool.baseCoinType,
			quoteCoinType: inputs.pool.quoteCoinType,
		};

		if (
			Helpers.stripLeadingZeroesFromType(inputs.coinInType) ===
			Helpers.stripLeadingZeroesFromType(inputs.pool.baseCoinType)
		) {
			return this.getAsksTx(commandInputs);
		}

		return this.getBidsTx(commandInputs);
	};

	// =========================================================================
	//  Inspections
	// =========================================================================

	public fetchBookState = async (inputs: {
		pool: PartialDeepBookPoolObject;
		coinInType: CoinType;
		coinOutType: CoinType;
	}): Promise<DeepBookPriceRange[]> => {
		const tx = new TransactionBlock();
		this.getBookPricesAndDepthsTx({
			...inputs,
			tx,
		});

		let prices: Byte[];
		let depths: Byte[];
		try {
			[prices, depths] =
				await this.Provider.Inspections().fetchAllBytesFromTxOutput({
					tx,
				});
		} catch (e) {
			// dev inspect may fail due to empty tree on orderbook (no bids or asks)
			prices = [];
			depths = [];
		}

		const bookPricesU64 = (
			bcs.de("vector<u64>", new Uint8Array(prices)) as string[]
		).map((val) => BigInt(val));

		const bookDepths = (
			bcs.de("vector<u64>", new Uint8Array(depths)) as string[]
		).map((val) => BigInt(val));

		// TOOD: move decimal to constants
		// TODO: move balance with decimals to generic function in casting file
		const bookPrices = bookPricesU64.map((price) => {
			const priceWithDecimals = Coin.balanceWithDecimals(
				price,
				DeepBookApi.constants.floatDecimals
			);

			if (
				Helpers.stripLeadingZeroesFromType(inputs.coinInType) ===
				Helpers.stripLeadingZeroesFromType(inputs.pool.baseCoinType)
			) {
				return priceWithDecimals;
			}

			return 1 / priceWithDecimals;
		});

		return bookPrices.map((price, index) => {
			return {
				price,
				depth: bookDepths[index],
			};
		});
	};

	// =========================================================================
	//  Transaction Builders
	// =========================================================================

	public buildCreateAccountTx = (inputs: {
		walletAddress: SuiAddress;
	}): TransactionBlock => {
		const tx = new TransactionBlock();
		tx.setSender(inputs.walletAddress);

		const [accountCap] = this.createAccountTx({ tx });

		tx.transferObjects([accountCap], tx.pure(inputs.walletAddress));

		return tx;
	};

	public fetchBuildDepositBaseAndQuoteTx = async (inputs: {
		walletAddress: SuiAddress;
		pool: PartialDeepBookPoolObject;
		baseCoinAmount: Balance;
		quoteCoinAmount: Balance;
	}): Promise<TransactionBlock> => {
		const tx = new TransactionBlock();
		tx.setSender(inputs.walletAddress);

		const accountCapId = await this.fetchOwnedAccountCapObjectId(inputs);

		const [baseCoinId, quoteCoinId] =
			await this.Provider.Coin().fetchCoinsWithAmountTx({
				...inputs,
				tx,
				coinTypes: [
					inputs.pool.baseCoinType,
					inputs.pool.quoteCoinType,
				],
				coinAmounts: [inputs.baseCoinAmount, inputs.quoteCoinAmount],
			});

		const commandInputs = {
			...inputs,
			tx,
			poolObjectId: inputs.pool.objectId,
			baseCoinType: inputs.pool.baseCoinType,
			quoteCoinType: inputs.pool.quoteCoinType,
			baseCoinId,
			quoteCoinId,
			accountCapId,
		};

		this.depositBaseTx(commandInputs);
		this.depositQuoteTx(commandInputs);

		return tx;
	};

	public fetchBuildPlaceLimitOrderTx = async (inputs: {
		walletAddress: SuiAddress;
		pool: PartialDeepBookPoolObject;
		price: bigint;
		quantity: Balance;
		isBidOrder: boolean;
	}): Promise<TransactionBlock> => {
		const tx = new TransactionBlock();
		tx.setSender(inputs.walletAddress);

		const accountCapId = await this.fetchOwnedAccountCapObjectId(inputs);

		const commandInputs = {
			...inputs,
			poolObjectId: inputs.pool.objectId,
			baseCoinType: inputs.pool.baseCoinType,
			quoteCoinType: inputs.pool.quoteCoinType,
			accountCapId,
			tx,
		};

		this.placeLimitOrderTx(commandInputs);

		return tx;
	};

	public fetchBuildCreatePoolTx = async (inputs: {
		walletAddress: SuiAddress;
		baseCoinType: CoinType;
		quoteCoinType: CoinType;
		tickSize: bigint;
		lotSize: bigint;
	}): Promise<TransactionBlock> => {
		const tx = new TransactionBlock();
		tx.setSender(inputs.walletAddress);

		const suiFeeCoinId = await this.Provider.Coin().fetchCoinWithAmountTx({
			...inputs,
			tx,
			coinType: Coin.constants.suiCoinType,
			coinAmount: DeepBookApi.constants.poolCreationFeeInSui,
		});

		const commandInputs = {
			...inputs,
			tx,
			suiFeeCoinId,
		};

		this.createPoolTx(commandInputs);

		return tx;
	};

	// =========================================================================
	//  Private Methods
	// =========================================================================

	// =========================================================================
	//  Dev Inspect Transaction Commands
	// =========================================================================

	private tradeBaseToQuoteDevInspectTx = (inputs: {
		tx: TransactionBlock;
		coinInType: CoinType;
		coinOutType: CoinType;
		routerSwapCapCoinType: CoinType;
		poolObjectId: ObjectId;
		routerSwapCapBytes: Uint8Array;
		coinInBytes: Uint8Array;
	}) /* (Coin) */ => {
		const { tx } = inputs;

		return tx.moveCall({
			target: Helpers.transactions.createTxTarget(
				this.addresses.packages.wrapper,
				DeepBookApi.constants.moduleNames.wrapper,
				"swap_exact_base_for_quote"
			),
			typeArguments: [
				inputs.routerSwapCapCoinType,
				inputs.coinInType,
				inputs.coinOutType,
			],
			arguments: [
				tx.object(this.addresses.objects.wrapperApp),
				tx.pure(inputs.routerSwapCapBytes),

				tx.object(inputs.poolObjectId),
				tx.pure(inputs.coinInBytes),
				tx.object(Sui.constants.addresses.suiClockId),
			],
		});
	};

	private tradeQuoteToBaseDevInspectTx = (inputs: {
		tx: TransactionBlock;
		coinInType: CoinType;
		coinOutType: CoinType;
		routerSwapCapCoinType: CoinType;
		poolObjectId: ObjectId;
		routerSwapCapBytes: Uint8Array;
		coinInBytes: Uint8Array;
	}) /* (Coin) */ => {
		const { tx } = inputs;

		return tx.moveCall({
			target: Helpers.transactions.createTxTarget(
				this.addresses.packages.wrapper,
				DeepBookApi.constants.moduleNames.wrapper,
				"swap_exact_quote_for_base"
			),
			typeArguments: [
				inputs.routerSwapCapCoinType,
				inputs.coinOutType,
				inputs.coinInType,
			],
			arguments: [
				tx.object(this.addresses.objects.wrapperApp),
				tx.pure(inputs.routerSwapCapBytes),

				tx.object(inputs.poolObjectId),
				tx.pure(inputs.coinInBytes),
				tx.object(Sui.constants.addresses.suiClockId),
			],
		});
	};

	private registerTradeBcsStructs = (inputs: {
		coinStructNames: CoinType[];
	}) => {
		for (const coinStructName of inputs.coinStructNames) {
			bcs.registerStructType(coinStructName, {});
		}

		bcs.registerStructType("ID", {
			bytes: BCS.ADDRESS,
		});

		bcs.registerStructType("UID", {
			id: "ID",
		});

		bcs.registerStructType(`Balance<${inputs.coinStructNames[0]}>`, {
			value: BCS.U64,
		});

		bcs.registerStructType(`Coin<${inputs.coinStructNames[0]}>`, {
			id: "UID",
			balance: `Balance<${inputs.coinStructNames[0]}>`,
		});

		/*

		struct RouterFeeMetadata has copy, drop {
			recipient: address,
			fee: u64,
		}

		struct SwapMetadata has copy, drop {
			type: vector<u8>,
			amount: u64,
		}
		
		struct RouterSwapCap<phantom CS> {
			coin_in: Coin<CS>,
			min_amount_out: u64,
			first_swap: SwapMetadata,
			previous_swap: SwapMetadata,
			final_swap: SwapMetadata,
			router_fee_metadata: RouterFeeMetadata,
			referrer: Option<address>,
		}

		*/

		bcs.registerStructType("RouterFeeMetadata", {
			recipient: BCS.ADDRESS,
			fee: BCS.U64,
		});

		bcs.registerStructType("SwapMetadata", {
			type: "vector<u8>",
			amount: BCS.U64,
		});

		bcs.registerStructType(`RouterSwapCap<${inputs.coinStructNames[0]}>`, {
			coin_in: `Coin<${inputs.coinStructNames[0]}>`,
			min_amount_out: BCS.U64,
			first_swap: "SwapMetadata",
			previous_swap: "SwapMetadata",
			final_swap: "SwapMetadata",
			router_fee_metadata: "RouterFeeMetadata",
			referrer: "Option<address>",
		});
	};

	// =========================================================================
	//  Objects
	// =========================================================================

	private fetchPoolsForCoinType = async (inputs: { coinType: CoinType }) => {
		const allPools = await this.fetchAllPools();

		const foundPools = allPools.filter((pool) =>
			DeepBookApi.isPoolForCoinType({
				pool,
				...inputs,
			})
		);

		return foundPools;
	};

	// =========================================================================
	//  Private Static Methods
	// =========================================================================

	// =========================================================================
	//  Helpers
	// =========================================================================

	private static isPoolForCoinTypes = (inputs: {
		pool: DeepBookPoolObject;
		coinType1: CoinType;
		coinType2: CoinType;
	}) => {
		const { pool, coinType1, coinType2 } = inputs;

		return (
			(pool.baseCoinType === Helpers.addLeadingZeroesToType(coinType1) &&
				pool.quoteCoinType ===
					Helpers.addLeadingZeroesToType(coinType2)) ||
			(pool.baseCoinType === Helpers.addLeadingZeroesToType(coinType2) &&
				pool.quoteCoinType ===
					Helpers.addLeadingZeroesToType(coinType1))
		);
	};

	private static isPoolForCoinType = (inputs: {
		pool: DeepBookPoolObject;
		coinType: CoinType;
	}) => {
		const { pool, coinType } = inputs;

		return (
			pool.baseCoinType === Helpers.addLeadingZeroesToType(coinType) ||
			pool.quoteCoinType === Helpers.addLeadingZeroesToType(coinType)
		);
	};

	private static isBaseCoinType = (inputs: {
		pool: DeepBookPoolObject;
		coinType: CoinType;
	}) => {
		const { coinType, pool } = inputs;
		return (
			Helpers.addLeadingZeroesToType(coinType) ===
			Helpers.addLeadingZeroesToType(pool.baseCoinType)
		);
	};
}
