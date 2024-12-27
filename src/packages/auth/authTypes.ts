import { SuiAddress, Timestamp } from "../../types";

// =========================================================================
//  API
// =========================================================================

// =========================================================================
//  Bodies
// =========================================================================

export interface ApiCreateAuthAccountBody {
	walletAddress: SuiAddress;
	signature: string;
	serializedJson: string;
}

export interface ApiGetAccessTokenBody {
	walletAddress: SuiAddress;
	signature: string;
	serializedJson: string;
}

// =========================================================================
//  Responses
// =========================================================================

export interface ApiGetAccessTokenResponse {
	accessToken: string;
	header: string;
	expirationTimestamp: Timestamp;
}
