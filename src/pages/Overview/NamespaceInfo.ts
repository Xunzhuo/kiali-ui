import { TLSStatus } from '../../types/TLSStatus';
import { TimeSeries } from '../../types/Metrics';
import { ValidationStatus } from '../../types/IstioObjects';

export type NamespaceInfo = {
  name: string;
  status?: NamespaceStatus;
  tlsStatus?: TLSStatus;
  validations?: ValidationStatus;
  metrics?: TimeSeries[];
  labels?: { [key: string]: string };
};

export type NamespaceStatus = {
  inIdle: string[];
  inError: string[];
  inWarning: string[];
  inSuccess: string[];
  notAvailable: string[];
};

export default NamespaceInfo;
