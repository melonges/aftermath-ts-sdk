import {
	ObjectId,
	SequenceNumber,
	SuiAddress,
	SuiMoveModuleId,
	TransactionDigest,
} from "@mysten/sui.js";
import { AnyObjectType, ModuleName } from "./generalTypes";

/////////////////////////////////////////////////////////////////////
//// On Chain
/////////////////////////////////////////////////////////////////////

export interface EventOnChain<Fields> {
	id: {
		txDigest: TransactionDigest;
		eventSeq: number;
	};
	packageId: ObjectId;
	transactionModule: ModuleName;
	sender: SuiAddress;
	type: AnyObjectType;
	parsedJson: Fields; // | undefined;
	bcs: string; // | undefined;
	timestampMs: number; // | undefined;
}
