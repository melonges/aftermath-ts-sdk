import {
	EventId,
	ObjectId,
	SignableTransaction,
	SuiAddress,
	SuiObjectInfo,
} from "@mysten/sui.js";
import {
	ApiBreedCapyBody,
	ApiDynamicFieldsBody,
	ApiEventsBody,
	BreedCapyEvent,
	CapyAttribute,
	CapyObject,
	CapyStats,
	DynamicFieldObjectsWithCursor,
	EventsWithCursor,
	StakeCapyEvent,
	StakedCapyReceiptObject,
	SuiNetwork,
	UnstakeCapyEvent,
} from "../../types";
import { Aftermath } from "../../general/providers/aftermath";
import { Capy } from "./capy";
import { StakedCapyReceipt } from "./stakedCapyReceipt";

export class Capys extends Aftermath {
	/////////////////////////////////////////////////////////////////////
	//// Constants
	/////////////////////////////////////////////////////////////////////

	public static readonly constants = {
		breedingFees: {
			coinType: "0x0000000000000000000000000000000000000002::sui::SUI",
			amounts: {
				breedAndKeep: BigInt(1_000_000), // MIST -> 0.001 SUI
				breedWithStakedAndKeep: BigInt(5_000_000), // MIST -> 0.005 SUI
				breedStakedWithStakedAndKeep: BigInt(10_000_000), // MIST -> 0.01 SUI
			},
		},
	};

	/////////////////////////////////////////////////////////////////////
	//// Constructor
	/////////////////////////////////////////////////////////////////////

	constructor(public readonly network?: SuiNetwork) {
		super(network, "capys");
	}

	/////////////////////////////////////////////////////////////////////
	//// Public Methods
	/////////////////////////////////////////////////////////////////////

	/////////////////////////////////////////////////////////////////////
	//// Class Objects
	/////////////////////////////////////////////////////////////////////

	public async getCapy(capyObjectId: ObjectId): Promise<Capy> {
		return (await this.getCapys([capyObjectId]))[0];
	}

	public async getCapys(capyObjectIds: ObjectId[]): Promise<Capy[]> {
		return (
			await this.fetchApi<CapyObject[]>(
				`${JSON.stringify(capyObjectIds)}`
			)
		).map((capy) => new Capy(capy, this.network));
	}

	public async getOwnedCapys(walletAddress: SuiAddress): Promise<Capy[]> {
		return (
			await this.fetchApi<CapyObject[]>(`${walletAddress}/ownedCapys`)
		).map((capy) => new Capy(capy, this.network));
	}

	public async getStakedCapyReceipts(
		walletAddress: SuiAddress
	): Promise<StakedCapyReceipt[]> {
		return (
			await this.fetchApi<StakedCapyReceiptObject[]>(
				`${walletAddress}/stakedCapyReceipts`
			)
		).map((receipt) => new StakedCapyReceipt(receipt, this.network));
	}

	/////////////////////////////////////////////////////////////////////
	//// Dynamic Fields
	/////////////////////////////////////////////////////////////////////

	public async getStakedCapys(
		attributes?: CapyAttribute[],
		cursor?: ObjectId,
		limit?: number
	): Promise<DynamicFieldObjectsWithCursor<CapyObject>> {
		return this.fetchApi<
			DynamicFieldObjectsWithCursor<CapyObject>,
			ApiDynamicFieldsBody
		>(`stakedCapys${Capys.createCapyAttributesQueryString(attributes)}`, {
			cursor,
			limit,
		});
	}

	/////////////////////////////////////////////////////////////////////
	//// Events
	/////////////////////////////////////////////////////////////////////

	public async getBreedCapyEvents(
		cursor?: EventId,
		limit?: number
	): Promise<EventsWithCursor<BreedCapyEvent>> {
		return this.fetchApi<EventsWithCursor<BreedCapyEvent>, ApiEventsBody>(
			"events/breedCapy",
			{
				cursor,
				limit,
			}
		);
	}

	public async getStakeCapyEvents(
		cursor?: EventId,
		limit?: number
	): Promise<EventsWithCursor<StakeCapyEvent>> {
		return this.fetchApi<EventsWithCursor<StakeCapyEvent>, ApiEventsBody>(
			"events/stakeCapy",
			{
				cursor,
				limit,
			}
		);
	}

	public async getUnstakeCapyEvents(
		cursor?: EventId,
		limit?: number
	): Promise<EventsWithCursor<UnstakeCapyEvent>> {
		return this.fetchApi<EventsWithCursor<UnstakeCapyEvent>, ApiEventsBody>(
			"events/unstakeCapy",
			{
				cursor,
				limit,
			}
		);
	}

	/////////////////////////////////////////////////////////////////////
	//// Transactions
	/////////////////////////////////////////////////////////////////////

	public async getBreedCapysTransactions(
		walletAddress: SuiAddress,
		capyParentOneId: ObjectId,
		capyParentTwoId: ObjectId
	): Promise<SignableTransaction[]> {
		return this.fetchApi<SignableTransaction[], ApiBreedCapyBody>(
			"transactions/breed",
			{
				walletAddress,
				capyParentOneId,
				capyParentTwoId,
			}
		);
	}

	/////////////////////////////////////////////////////////////////////
	//// Inspections
	/////////////////////////////////////////////////////////////////////

	public async getIsPackageOnChain(): Promise<boolean> {
		return this.fetchApi("status");
	}

	public async getStats(): Promise<CapyStats> {
		return this.fetchApi("stats");
	}

	/////////////////////////////////////////////////////////////////////
	//// Helpers
	/////////////////////////////////////////////////////////////////////

	public isStakedCapyReceiptObjectType = (
		suiObjectInfo: SuiObjectInfo
	): boolean =>
		suiObjectInfo.type === config.capyVault.capyStakingReceiptType;

	public isCapyObjectType = (suiObjectInfo: SuiObjectInfo): boolean =>
		suiObjectInfo.type === config.capy.capyType;

	/////////////////////////////////////////////////////////////////////
	//// Private Static Methods
	/////////////////////////////////////////////////////////////////////

	/////////////////////////////////////////////////////////////////////
	//// Helpers
	/////////////////////////////////////////////////////////////////////

	private static createCapyAttributesQueryString(
		attributes?: CapyAttribute[]
	) {
		return attributes === undefined || attributes.length === 0
			? ""
			: "?" +
					attributes
						.map(
							(attr, i) =>
								`${i === 0 ? "" : "&"}${attr.name}=${
									attr.value
								}`
						)
						.reduce((acc, curr) => acc + curr, "");
	}
}
