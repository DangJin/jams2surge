export interface SurgeShadowsocksNode {
  name: string;
  host: string;
  port: number;
  method: string;
  password: string;
  udpRelay: true;
  obfs?: "http" | "tls";
  obfsHost?: string;
}

export type IssueKind = "invalid" | "unsupported";

export interface ConversionIssue {
  index: number;
  name?: string;
  protocol: "ss" | "vless" | "unknown";
  kind: IssueKind;
  message: string;
}

export interface ConversionResult {
  nodes: SurgeShadowsocksNode[];
  issues: ConversionIssue[];
}
