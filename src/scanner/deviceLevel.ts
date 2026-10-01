export type DeviceLevel={available:boolean;permission:'unknown'|'granted'|'denied'|'unavailable';beta:number|null;gamma:number|null;tilt:number;stable:boolean};

let current:DeviceLevel={available:false,permission:'unknown',beta:null,gamma:null,tilt:99,stable:false};
let listening=false;

function update(beta:number|null,gamma:number|null){
  const b=typeof beta==='number'?beta:null,g=typeof gamma==='number'?gamma:null;
  const tilt=b===null||g===null?99:Math.hypot(b,g);
  current={...current,available:b!==null||g!==null,beta:b,gamma:g,tilt,stable:tilt<=6};
}

export function getDeviceLevel(){return current}

export async function enableDeviceLevel():Promise<DeviceLevel>{
  try{
    const Orientation=window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {requestPermission?:()=>Promise<'granted'|'denied'>};
    const Motion=window.DeviceMotionEvent as typeof DeviceMotionEvent & {requestPermission?:()=>Promise<'granted'|'denied'>};
    if(typeof Orientation==='undefined'){current={...current,permission:'unavailable'};return current}
    if(Orientation.requestPermission){
      const p=await Orientation.requestPermission();
      if(p!=='granted'){current={...current,permission:'denied'};return current}
    }
    if(Motion?.requestPermission){
      try{await Motion.requestPermission()}catch{}
    }
    if(!listening){
      window.addEventListener('deviceorientation',(e)=>update(e.beta,e.gamma),true);
      listening=true;
    }
    current={...current,permission:'granted'};
  }catch{current={...current,permission:'denied'}}
  return current;
}
