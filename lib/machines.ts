import type {Row} from './crm';

export const machineTypeLabels:Record<string,string>={stationary:'ثابتة',mobile:'متحركة',unknown:'غير محدد'};
/** The model's and the bushings' condition: asked of every machine, left unset on the ones recorded before the question existed. */
export const machineConditionLabels:Record<string,string>={'':'غير محدد',new:'جديد',old:'قديم'};
export function hasMachineSource(data:{machineCount?:number|null;machineTypes?:string}){return Number(data.machineCount)>0||Boolean(String(data.machineTypes||'').trim());}
export function machineSourceData(customer:Row){
 const source=customer.data;
 const raw=String(source.machineTypes||'').trim();
 const types=Array.from(new Set(raw.split(/[,،]+/).map(s=>s.trim()).filter(Boolean)));
 const count=typeof source.machineCount==='number'?source.machineCount:null;
 return {name:raw||'ماكينات غير محددة النوع',recordType:'group',quantity:count,
  machineBrand:types.length===1&&types[0]!=='خط ثابت'?types[0]:'',machineModel:'',
  machineType:types.length===1&&types[0]==='خط ثابت'?'stationary':'unknown',modelCondition:'',bushingCondition:'',
  boardDimensions:'',notes:'',
  sourceMachineTypes:raw,sourceMachineCount:count,sourceFile:source.sourceFile||'',
  sourceRow:source.sourceRow,sourceKey:source.sourceKey||'',sourceHash:source.sourceHash||''};
}
/** The model is chosen as new or old; the model name typed before that question existed stays on the machines that have it. Either one completes the model. */
export const hasMachineModel=(data?:{machineModel?:string;modelCondition?:string}|null)=>Boolean(data?.machineModel?.trim()||data?.modelCondition==='new'||data?.modelCondition==='old');
/** What to show for the model: «جديد» or «قديم», then the older typed name when there is one. `tr` translates the condition. */
export function machineModelText(data?:{machineModel?:string;modelCondition?:string}|null,tr:(text:string)=>string=text=>text){
 const condition=data?.modelCondition==='new'||data?.modelCondition==='old'?tr(machineConditionLabels[data.modelCondition]):'';
 return [condition,String(data?.machineModel||'').trim()].filter(Boolean).join(' · ');
}
export function completeMachineSpecs(data?:{machineBrand?:string;machineModel?:string;modelCondition?:string;machineType?:string}|null){return Boolean(data?.machineBrand?.trim()&&hasMachineModel(data)&&(['stationary','mobile'] as (string|undefined)[]).includes(data?.machineType));}
