
export enum Parity {
  None = 'none',
  Even = 'even',
  Odd = 'odd'
}

export enum StopBits {
  One = 1,
  Two = 2
}

export enum DataBits {
  Seven = 7,
  Eight = 8
}

export interface SerialConfig {
  baudRate: number;
  dataBits: DataBits;
  stopBits: StopBits;
  parity: Parity;
  bufferSize: number;
  dtr: boolean;  // 初始流控 DTR（连接瞬间应用，可预置）
  rts: boolean;  // 初始流控 RTS（连接瞬间应用，可预置）
}

export enum DisplayMode {
  Text = 'text',
  Hex = 'hex',
  SplitView = 'splitview'
}

export enum FileSendMode {
  Raw = 'raw',
  YModem = 'ymodem'
}

export enum CommMode {
  Serial = 'serial',
  WebSocket = 'websocket',
  Bluetooth = 'bluetooth'
}

export interface BluetoothConfig {
  serviceUUID: string;
  txCharacteristicUUID: string;  // 发送特征 UUID
  rxCharacteristicUUID: string;  // 接收特征 UUID
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'rx' | 'tx' | 'info' | 'error';
  data: Uint8Array;
  text: string;
  byteCount: number; // 记录实际接收/发送的字节数
}

export interface QuickSendItem {
  id: string;
  label: string;
  content: string;
  mode: DisplayMode;
}

export interface Rule {
  id: string;
  color: string;             // 染色颜色
  leftKey: string;           // 起始（只填起始、结束留空 = 关键词模式）
  leftKeyMode: DisplayMode;
  rightKey: string;          // 结束（留空 = 关键词模式）
  rightKeyMode: DisplayMode;
  displayMode: DisplayMode;  // 提取结果显示模式（T/H）
}
