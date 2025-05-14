/**
 * Debug script to test discriminator value calculations
 */
import bs58 from 'bs58';

// Manual try with the value we have
const discriminator = Buffer.from("6dfcdac9b377b1ef", "hex");
console.log(`Discriminator (manual): ${bs58.encode(discriminator)}`);

// Try with canonical method
import { createHash } from 'crypto';
function generateAnchorDiscriminator(name: string): Buffer {
  const preimage = `anchor:sighash(${JSON.stringify(name)})`;
  console.log('Preimage:', preimage);
  
  const hash = createHash('sha256').update(preimage).digest();
  return hash.slice(0, 8);
}

const personalPositionDiscriminator = generateAnchorDiscriminator("personal_position");
console.log(`Discriminator (generated): ${bs58.encode(personalPositionDiscriminator)}`);
console.log(`Raw bytes: [${[...personalPositionDiscriminator].map(b => b.toString()).join(', ')}]`); 