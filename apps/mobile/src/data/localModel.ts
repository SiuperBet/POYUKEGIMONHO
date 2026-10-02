import type { Game } from './catalog';
import type { DefectRecord, InspectionPhoto } from './store';

/**
 * Local ML contract.
 *
 * CARDGRADE deliberately keeps the ML engine behind this interface so a
 * future ONNX/TFLite model can be added without changing the scanner UI,
 * collection or grading data model. No network/API key is required by this
 * contract.
 */
export type LocalModelStatus='disabled'|'ready'|'not-installed';

export type CardVisionCandidate={
  cardId:string;
  confidence:number;
  reason?:string;
};

export type DefectVisionResult={
  defects:DefectRecord[];
  confidence:number;
  notes:string[];
};

export type LocalCardVisionEngine={
  id:string;
  version:string;
  status:LocalModelStatus;
  recognize(input:{uri:string;game:Game}):Promise<CardVisionCandidate[]>;
  inspect(input:{photos:InspectionPhoto[]}):Promise<DefectVisionResult>;
};

export const LOCAL_MODEL_MANIFEST={
  recognition:{
    target:'card-identification',
    format:'ONNX',
    quantization:'int8',
    input:'cropped-card-image',
    languages:'multilingual',
  },
  defects:{
    target:'card-surface-defect-detection',
    format:'ONNX',
    quantization:'int8',
    input:'front-back-inspection-photos',
    labels:['riga','graffio','piega','puntino_bianco','whitening','angolo_rovinato','bordo_scheggiato','dent','sporco','print_line','difetto_stampa','holo_graffio','imperfezione','altro'],
  },
} as const;

/**
 * Returns the current fallback engine state. The app continues to work with
 * deterministic local computer vision until an actual mobile model is bundled.
 */
export function getLocalModelStatus():LocalModelStatus{
  return 'not-installed';
}
