import { TickMath, LiquidityMath } from '@raydium-io/raydium-sdk-v2';

// Log the available methods on TickMath
console.log('TickMath methods:');
console.log(Object.getOwnPropertyNames(TickMath));

// Log the available methods on LiquidityMath
console.log('\nLiquidityMath methods:');
console.log(Object.getOwnPropertyNames(LiquidityMath));

// Check the signature of getAmountsFromLiquidity
console.log('\nLiquidityMath.getAmountsFromLiquidity signature:');
console.log(LiquidityMath.getAmountsFromLiquidity.toString()); 