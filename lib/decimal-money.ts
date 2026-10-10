/** Round the exact decimal product, not its binary floating-point approximation.
 * Positive ties round up, as before. Each caller keeps its existing rounding
 * boundary (line, discount or VAT); no invoice/discount policy changes here.
 * Number.toString() also handles scientific notation. Finite JS numbers bound
 * the temporary integer sizes, including subnormal input from an unfinished UI.
 */
export function roundedDecimalProduct(factors:readonly number[],places=0):number {
 let coefficient=BigInt(1),scale=-places;
 for(const value of factors){
  const number=Number(value);
  if(!Number.isFinite(number))return Number.NaN;
  const [mantissa,exponent='0']=String(number).split('e');
  const [whole,fraction='']=mantissa.split('.');
  coefficient*=BigInt(whole+fraction);
  scale+=fraction.length-Number(exponent);
 }
 if(scale<=0)return Number(coefficient*BigInt(10)**BigInt(-scale));
 const divisor=BigInt(10)**BigInt(scale),negative=coefficient<BigInt(0);
 const absolute=negative?-coefficient:coefficient;
 let rounded=absolute/divisor;
 const twiceRemainder=absolute%divisor*BigInt(2);
 // Also preserve Math.round's tie toward +infinity for defensive negative use.
 if(twiceRemainder>divisor||!negative&&twiceRemainder===divisor)rounded+=BigInt(1);
 return Number(negative?-rounded:rounded);
}

export const moneyCents=(amount:number)=>roundedDecimalProduct([amount],2);
export const lineCents=(quantity:number,price:number)=>roundedDecimalProduct([quantity,price],2);
export const percentCents=(netCents:number,rate:number)=>roundedDecimalProduct([netCents,rate],-2);
