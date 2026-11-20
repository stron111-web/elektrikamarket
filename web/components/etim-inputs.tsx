import type {Filters} from '../lib/data';
import {etimTokens} from '../../scripts/storefront/etim.cjs';
export function EtimInputs({filters}:{filters:Filters}){
 if(!filters.etim.length)return null;
 return <><input type="hidden" name="etimCategory" value={filters.category}/>{etimTokens(filters.etim).map(value=><input key={value} type="hidden" name="etim" value={value}/>)}</>;
}
