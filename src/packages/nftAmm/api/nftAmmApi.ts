import { ObjectId, SuiAddress } from "@mysten/sui.js";
import { AftermathApi } from "../../../general/providers/aftermathApi";
import { NftAmmApiHelpers } from "./nftAmmApiHelpers";
import { Nft, NftAmmMarketObject } from "../nftAmmTypes";
import { NftAmmApiCasting } from "./nftAmmApiCasting";
import { NftAmmMarket } from "../nftAmmMarket";
import { Balance, SerializedTransaction, Slippage } from "../../../types";

export class NftAmmApi {
	/////////////////////////////////////////////////////////////////////
	//// Class Members
	/////////////////////////////////////////////////////////////////////

	public readonly Helpers;

	/////////////////////////////////////////////////////////////////////
	//// Constructor
	/////////////////////////////////////////////////////////////////////

	constructor(private readonly Provider: AftermathApi) {
		this.Provider = Provider;
		this.Helpers = new NftAmmApiHelpers(Provider);
	}

	/////////////////////////////////////////////////////////////////////
	//// Public Methods
	/////////////////////////////////////////////////////////////////////

	/////////////////////////////////////////////////////////////////////
	//// Objects
	/////////////////////////////////////////////////////////////////////

	public fetchNfts = async (objectIds: ObjectId[]): Promise<Nft[]> => {
		const objects = await this.Provider.Objects().fetchObjectBatch(
			objectIds,
			{
				// NOTE: do we need all of this ?
				showContent: true,
				showOwner: true,
				showType: true,
				showDisplay: true,
			}
		);
		return objects.map(NftAmmApiCasting.nftFromSuiObject);
	};

	public fetchMarkets = async (
		objectIds: ObjectId[]
	): Promise<NftAmmMarketObject[]> => {
		const objects = await this.Provider.Objects().fetchObjectBatch(
			objectIds
		);
		return objects.map(NftAmmApiCasting.marketObjectFromSuiObject);
	};

	/////////////////////////////////////////////////////////////////////
	//// Transactions
	/////////////////////////////////////////////////////////////////////

	public fetchDepositTransaction = async (inputs: {
		walletAddress: SuiAddress;
		market: NftAmmMarket;
		assetCoinAmountIn: Balance;
		nftObjectIds: ObjectId[];
		slippage: Slippage;
		referrer?: SuiAddress;
	}): Promise<SerializedTransaction> => {
		return this.Provider.Transactions().fetchSetGasBudgetAndSerializeTransaction(
			this.Helpers.fetchBuildDepositTransaction({
				...inputs,
				nfts: inputs.nftObjectIds,
			})
		);
	};
}
