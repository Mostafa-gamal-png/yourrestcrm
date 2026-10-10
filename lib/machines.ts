import type {Row} from './crm';

export const machineTypeLabels:Record<string,string>={stationary:'ثابتة',mobile:'متحركة',unknown:'غير محدد'};
export function hasMachineSource(data:{machineCount?:number|null;machineTypes?:string}){return Number(data.machineCount)>0||Boolean(String(data.machineTypes||'').trim());}
export function machineSourceData(customer:Row){
 const source=customer.data;
 const raw=String(source.machineTypes||'').trim();
 const types=Array.from(new Set(raw.split(/[,،]+/).map(s=>s.trim()).filter(Boolean)));
 const count=typeof source.machineCount==='number'?source.machineCount:null;
 return {name:raw||'ماكينات غير محددة النوع',recordType:'group',quantity:count,
  machineBrand:types.length===1&&types[0]!=='خط ثابت'?types[0]:'',machineModel:'',
  machineType:types.length===1&&types[0]==='خط ثابت'?'stationary':'unknown',
  machineSerial:'',boardDimensions:'',location:'',notes:'',
  sourceMachineTypes:raw,sourceMachineCount:count,sourceFile:source.sourceFile||'',
  sourceRow:source.sourceRow,sourceKey:source.sourceKey||'',sourceHash:source.sourceHash||''};
}
export function completeMachineSpecs(data?:{machineBrand?:string;machineModel?:string;machineType?:string}|null){return Boolean(data?.machineBrand?.trim()&&data?.machineModel?.trim()&&(['stationary','mobile'] as (string|undefined)[]).includes(data?.machineType));}
