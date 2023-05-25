import { Balance, Object, Timestamp } from "../../general/types/generalTypes";
import { CoinType } from "../coin/coinTypes";

/////////////////////////////////////////////////////////////////////
//// Name Only
/////////////////////////////////////////////////////////////////////

export type FarmsMultiplier = bigint;

/////////////////////////////////////////////////////////////////////
//// Objects
/////////////////////////////////////////////////////////////////////

export type FarmsStakingPoolCoins = Record<CoinType, FarmsStakingPoolCoin>;

export interface FarmsStakingPoolCoin {
	coinType: CoinType;
	rewards: Balance;
	rewardsAccumulatedPerShare: Balance;
	emissionRateMs: Timestamp;
	emissionStartTimestamp: Timestamp;
	lastRewardTimestamp: Timestamp;
}

export interface FarmsStakingPool extends Object {
	stakeCoinType: CoinType;
	stakedAmount: Balance;
	stakedAmountWithMultiplier: Balance;
	minLockDurationMs: Timestamp;
	maxLockDurationMs: Timestamp;
	maxLockMultiplier: FarmsMultiplier;
	coins: FarmsStakingPoolCoins;
}
