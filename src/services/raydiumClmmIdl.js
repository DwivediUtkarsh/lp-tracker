/**
 * Raydium CLMM IDL
 * This is a simplified version with only the account structures we need
 */
export const IDL = {
  version: "0.1.0",
  name: "raydium_clmm",
  instructions: [],
  accounts: [
    {
      name: "poolState",
      type: {
        kind: "struct",
        fields: [
          {
            name: "bump",
            type: "u8"
          },
          {
            name: "ammConfig",
            type: "publicKey"
          },
          {
            name: "owner",
            type: "publicKey"
          },
          {
            name: "tokenMint0",
            type: "publicKey"
          },
          {
            name: "tokenMint1",
            type: "publicKey"
          },
          {
            name: "tokenVault0",
            type: "publicKey"
          },
          {
            name: "tokenVault1",
            type: "publicKey"
          },
          {
            name: "observationKey",
            type: "publicKey"
          },
          {
            name: "mintDecimals0",
            type: "u8"
          },
          {
            name: "mintDecimals1",
            type: "u8"
          },
          {
            name: "tickSpacing",
            type: "u16"
          },
          {
            name: "liquidity",
            type: "u128"
          },
          {
            name: "sqrtPriceX64",
            type: "u128"
          },
          {
            name: "tickCurrent",
            type: "i32"
          },
          {
            name: "observationIndex",
            type: "u16"
          },
          {
            name: "observationCardinality",
            type: "u16"
          },
          {
            name: "observationCardinalityNext",
            type: "u16"
          },
          {
            name: "feeGrowthGlobal0X64",
            type: "u128"
          },
          {
            name: "feeGrowthGlobal1X64",
            type: "u128"
          },
          {
            name: "protocolFeesToken0",
            type: "u64"
          },
          {
            name: "protocolFeesToken1",
            type: "u64"
          },
          {
            name: "swapInAmountToken0",
            type: "u128"
          },
          {
            name: "swapOutAmountToken1",
            type: "u128"
          },
          {
            name: "swapInAmountToken1",
            type: "u128"
          },
          {
            name: "swapOutAmountToken0",
            type: "u128"
          },
          {
            name: "status",
            type: "u8"
          },
          {
            name: "padding",
            type: {
              array: ["u8", 7]
            }
          },
          {
            name: "rewardInfos",
            type: {
              array: [
                {
                  defined: "RewardInfo"
                },
                3
              ]
            }
          },
          {
            name: "tickArrayBitmap",
            type: {
              array: ["u64", 16]
            }
          },
          {
            name: "totalFeesToken0",
            type: "u64"
          },
          {
            name: "totalFeesClaimedToken0",
            type: "u64"
          },
          {
            name: "totalFeesToken1",
            type: "u64"
          },
          {
            name: "totalFeesClaimedToken1",
            type: "u64"
          },
          {
            name: "fundFeesToken0",
            type: "u64"
          },
          {
            name: "fundFeesToken1",
            type: "u64"
          },
          {
            name: "padding1",
            type: {
              array: ["u64", 26]
            }
          }
        ]
      }
    },
    {
      name: "personalPositionState",
      type: {
        kind: "struct",
        fields: [
          {
            name: "bump",
            type: "u8"
          },
          {
            name: "nftMint",
            type: "publicKey"
          },
          {
            name: "poolId",
            type: "publicKey"
          },
          {
            name: "tickLowerIndex",
            type: "i32"
          },
          {
            name: "tickUpperIndex",
            type: "i32"
          },
          {
            name: "liquidity",
            type: "u128"
          },
          {
            name: "feeGrowthInside0LastX64",
            type: "u128"
          },
          {
            name: "feeGrowthInside1LastX64",
            type: "u128"
          },
          {
            name: "tokenFeesOwed0",
            type: "u64"
          },
          {
            name: "tokenFeesOwed1",
            type: "u64"
          },
          {
            name: "rewardInfos",
            type: {
              array: [
                {
                  defined: "PositionRewardInfo"
                },
                3
              ]
            }
          },
          {
            name: "padding",
            type: {
              array: ["u64", 8]
            }
          }
        ]
      }
    }
  ],
  types: [
    {
      name: "RewardInfo",
      type: {
        kind: "struct",
        fields: [
          {
            name: "rewardState",
            type: "u8"
          },
          {
            name: "openTime",
            type: "u64"
          },
          {
            name: "endTime",
            type: "u64"
          },
          {
            name: "lastUpdateTime",
            type: "u64"
          },
          {
            name: "emissionsPerSecondX64",
            type: "u128"
          },
          {
            name: "rewardTotalEmissioned",
            type: "u64"
          },
          {
            name: "rewardClaimed",
            type: "u64"
          },
          {
            name: "tokenMint",
            type: "publicKey"
          },
          {
            name: "tokenVault",
            type: "publicKey"
          },
          {
            name: "authority",
            type: "publicKey"
          },
          {
            name: "rewardGrowthGlobalX64",
            type: "u128"
          }
        ]
      }
    },
    {
      name: "PositionRewardInfo",
      type: {
        kind: "struct",
        fields: [
          {
            name: "growthInsideLastX64",
            type: "u128"
          },
          {
            name: "rewardAmountOwed",
            type: "u64"
          }
        ]
      }
    }
  ],
  events: []
}; 