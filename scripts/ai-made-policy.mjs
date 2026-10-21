// A Printful receipt proves production, not permission to sell.
export function ownerApproved(reviews,id,external){
 const r=reviews?.products?.[String(id)];
 return !!r&&['approved','existing_live'].includes(r.decision)&&r.external===external;
}
