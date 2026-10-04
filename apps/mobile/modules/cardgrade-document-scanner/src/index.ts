import { requireNativeModule } from 'expo-modules-core';

export type DocumentScannerResult = {
  uri: string;
};

type CardgradeDocumentScannerModule = {
  launchAsync(): Promise<DocumentScannerResult | null>;
};

export default requireNativeModule<CardgradeDocumentScannerModule>('CardgradeDocumentScanner');
