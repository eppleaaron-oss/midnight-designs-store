export function calculatePrice(cost,other,fee,fixed,target,method){
 if(![cost,other,fee,fixed,target].every(Number.isFinite)||cost<0||other<0||fixed<0||fee<0||fee>=100||target<0)throw Error('Enter valid nonnegative costs, fees and targets.');
 const base=cost+other+fixed, f=fee/100;
 if(method==='margin'){if(target/100+f>=1)throw Error('Margin plus payment fee must be below 100%.');return Math.ceil((base/(1-f-target/100)-1e-9)*100)/100;}
 if(!['markup','fixed'].includes(method))throw Error('Unknown pricing method.');
 return Math.ceil(((method==='markup'?base*(1+target/100):base+target)/(1-f)-1e-9)*100)/100;
}
