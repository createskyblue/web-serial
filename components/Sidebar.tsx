import React, { useEffect, useState, useRef } from 'react';
import { SerialConfig, DataBits, StopBits, Parity, CommMode } from '../types';

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
    bufferSize?: number;
    flowControl?: string;
  }): Promise<void>;
  close(): Promise<void>;
}

interface SidebarProps {
  config: SerialConfig;
  setConfig: React.Dispatch<React.SetStateAction<SerialConfig>>;
  isConnected: boolean;
  isGroupByTimeout: boolean;
  setIsGroupByTimeout: (val: boolean) => void;
  groupTimeoutMs: number;
  setGroupTimeoutMs: (val: number) => void;
  isShowTimestamp: boolean;
  setIsShowTimestamp: (val: boolean) => void;
  maxBufferSize: number;
  setMaxBufferSize: (val: number) => void;
  currentBufferSize: number;
  commMode: CommMode;
  setCommMode: (val: CommMode) => void;
  wsUrl: string;
  setWsUrl: (val: string) => void;
  bluetoothServiceUUID: string;
  setBluetoothServiceUUID: (val: string) => void;
  bluetoothTxCharacteristicUUID: string;
  setBluetoothTxCharacteristicUUID: (val: string) => void;
  bluetoothRxCharacteristicUUID: string;
  setBluetoothRxCharacteristicUUID: (val: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  isReconnecting?: boolean;
  // 串口选择相关
  hasSavedSerialPort?: boolean;
  onReselectSerialPort?: () => void;
  // 流控信号控制（DTR / RTS）
  dtrSignal?: boolean;
  rtsSignal?: boolean;
  onSetDTR?: (value: boolean) => void;
  onSetRTS?: (value: boolean) => void;
  // 折叠相关
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 1500000, 2000000];

// 常见 USB 转串口芯片的 VID/PID 映射
const USB_CHIP_NAMES: Record<string, string> = {
  '1a86_7523': 'CH340',
  '1a86_7522': 'CH340',
  '1a86_5523': 'CH341',
  '0403_6001': 'FT232R',
  '0403_6010': 'FT2232H',
  '0403_6011': 'FT4232H',
  '0403_6014': 'FT232H',
  '0403_6015': 'FT230X',
  '10c4_ea60': 'CP2102',
  '10c4_ea70': 'CP2105',
  '067b_2303': 'PL2303',
  '067b_23a3': 'PL2303',
  '1546_01a8': 'u-blox GPS',
  '2341_0043': 'Arduino Uno',
  '2341_0001': 'Arduino Uno',
  '2a03_0043': 'Arduino Uno',
  '2341_0042': 'Arduino Mega',
  '2341_0010': 'Arduino Mega',
  '239a_800b': 'CircuitPlayground',
  '239a_801b': 'Metro M0',
  '0483_5740': 'STM32 VCP',
  '0483_374b': 'ST-Link V2-1',
};

// 获取串口显示名称
const getPortDisplayName = (port: any, index: number): string => {
  const info = port.getInfo?.() || {};
  const usbVendorId = info.usbVendorId;
  const usbProductId = info.usbProductId;

  if (usbVendorId !== undefined && usbProductId !== undefined) {
    const key = `${usbVendorId.toString(16)}_${usbProductId.toString(16)}`.toLowerCase();
    const chipName = USB_CHIP_NAMES[key];
    if (chipName) {
      return `${chipName} (${usbVendorId.toString(16).padStart(4, '0')}:${usbProductId.toString(16).padStart(4, '0')})`;
    }
    return `USB ${usbVendorId.toString(16).padStart(4, '0')}:${usbProductId.toString(16).padStart(4, '0')}`;
  }
  return `串口 ${index + 1}`;
};
const bufferSizes = [
  { value: 50 * 1024, label: '50 KB' },
  { value: 100 * 1024, label: '100 KB' },
  { value: 200 * 1024, label: '200 KB' },
  { value: 500 * 1024, label: '500 KB' },
  { value: 1024 * 1024, label: '1 MB' },
  { value: 2 * 1024 * 1024, label: '2 MB' },
  { value: 5 * 1024 * 1024, label: '5 MB' },
  { value: 10 * 1024 * 1024, label: '10 MB' }
];

// 格式化缓冲区大小显示
const formatBufferSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const Sidebar: React.FC<SidebarProps> = ({
  config,
  setConfig,
  isConnected,
  isGroupByTimeout,
  setIsGroupByTimeout,
  groupTimeoutMs,
  setGroupTimeoutMs,
  isShowTimestamp,
  setIsShowTimestamp,
  maxBufferSize,
  setMaxBufferSize,
  currentBufferSize,
  commMode,
  setCommMode,
  wsUrl,
  setWsUrl,
  bluetoothServiceUUID,
  setBluetoothServiceUUID,
  bluetoothTxCharacteristicUUID,
  setBluetoothTxCharacteristicUUID,
  bluetoothRxCharacteristicUUID,
  setBluetoothRxCharacteristicUUID,
  onConnect,
  onDisconnect,
  isReconnecting = false,
  hasSavedSerialPort = false,
  onReselectSerialPort,
  dtrSignal = true,
  rtsSignal = false,
  onSetDTR,
  onSetRTS,
  isCollapsed,
  onToggleCollapse
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 自定义波特率状态
  const [isCustomBaudRate, setIsCustomBaudRate] = useState(() => {
    const saved = localStorage.getItem('is_custom_baudrate');
    return saved ? saved === 'true' : false;
  });
  const [customBaudRate, setCustomBaudRate] = useState(() => {
    const saved = localStorage.getItem('custom_baudrate');
    return saved ? saved : '';
  });

  // 持久化蓝牙配置
  useEffect(() => {
    localStorage.setItem('bluetooth_service_uuid', bluetoothServiceUUID);
  }, [bluetoothServiceUUID]);

  useEffect(() => {
    localStorage.setItem('bluetooth_tx_characteristic_uuid', bluetoothTxCharacteristicUUID);
  }, [bluetoothTxCharacteristicUUID]);

  useEffect(() => {
    localStorage.setItem('bluetooth_rx_characteristic_uuid', bluetoothRxCharacteristicUUID);
  }, [bluetoothRxCharacteristicUUID]);

  // 持久化自定义波特率设置
  useEffect(() => {
    localStorage.setItem('is_custom_baudrate', isCustomBaudRate.toString());
  }, [isCustomBaudRate]);

  useEffect(() => {
    localStorage.setItem('custom_baudrate', customBaudRate);
  }, [customBaudRate]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'baudRate') {
      if (value === 'custom') {
        setIsCustomBaudRate(true);
        // 如果有自定义值，使用它，否则保持当前值
        if (customBaudRate && !isNaN(Number(customBaudRate))) {
          setConfig(prev => ({ ...prev, baudRate: Number(customBaudRate) }));
        }
      } else {
        setIsCustomBaudRate(false);
        setConfig(prev => ({ ...prev, baudRate: Number(value) }));
      }
    } else {
      setConfig(prev => ({
        ...prev,
        [name]: name === 'dataBits' || name === 'stopBits' ? Number(value) : value
      }));
    }
  };

  const handleCustomBaudRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // 只允许输入数字
    if (value && !/^\d+$/.test(value)) return;
    setCustomBaudRate(value);
    if (value && !isNaN(Number(value)) && Number(value) > 0) {
      setConfig(prev => ({ ...prev, baudRate: Number(value) }));
    }
  };

  const handleBufferSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setMaxBufferSize(Number(e.target.value));
  };

  const bufferUsagePercent = (currentBufferSize / maxBufferSize) * 100;
  const isBufferNearLimit = bufferUsagePercent > 80;

  return (
    <aside className="w-full bg-white border-r flex flex-col h-full shadow-sm z-20">
      {/* 折叠状态：只显示展开按钮 */}
      {isCollapsed ? (
        <div className="flex flex-col items-center py-4 h-full">
          <button
            onClick={onToggleCollapse}
            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="展开侧边栏 ( [ )"
          >
            <i className="fas fa-chevron-right text-sm"></i>
          </button>
        </div>
      ) : (
        <>
      <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
        <h2 className="text-lg font-bold mb-6 text-gray-700 border-b pb-2 flex items-center justify-between">
          <span className="flex items-center">
          <i className="fas fa-cog mr-2 text-blue-500"></i>
          配置参数
          </span>
          <button
            onClick={onToggleCollapse}
            className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="折叠侧边栏 ( [ )"
          >
            <i className="fas fa-chevron-left text-sm"></i>
          </button>
        </h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">通讯模式</label>
            <select
              value={commMode}
              onChange={(e) => setCommMode(e.target.value as CommMode)}
              disabled={isConnected}
              className="w-full bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 outline-none"
            >
              <option value={CommMode.Serial}>串口 (Serial)</option>
              <option value={CommMode.WebSocket}>WebSocket</option>
              <option value={CommMode.Bluetooth}>蓝牙 (Bluetooth)</option>
            </select>
          </div>

          {commMode === CommMode.WebSocket ? (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">WebSocket 服务器地址</label>
              <input
                type="text"
                value={wsUrl}
                onChange={(e) => setWsUrl(e.target.value)}
                disabled={isConnected}
                placeholder="ws://localhost:8080"
                className="w-full bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">支持 ws:// 或 wss:// 协议</p>
            </div>
          ) : commMode === CommMode.Bluetooth ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">服务 UUID (Service UUID)</label>
                <input
                  type="text"
                  value={bluetoothServiceUUID}
                  onChange={(e) => setBluetoothServiceUUID(e.target.value)}
                  disabled={isConnected}
                  placeholder="例如: 0xfff0 或 6e400001-b5a3-f393-e0a9-e50e24dcca9e"
                  className="w-full bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 outline-none font-mono text-xs"
                />
                <p className="text-xs text-gray-500 mt-1">支持 UUID16 (如 0xfff0) 或完整 UUID</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">TX 特征 UUID (发送)</label>
                <input
                  type="text"
                  value={bluetoothTxCharacteristicUUID}
                  onChange={(e) => setBluetoothTxCharacteristicUUID(e.target.value)}
                  disabled={isConnected}
                  placeholder="例如: 0xfff1 或 6e400002-b5a3-f393-e0a9-e50e24dcca9e"
                  className="w-full bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 outline-none font-mono text-xs"
                />
                <p className="text-xs text-gray-500 mt-1">用于发送数据的特征 UUID（Write属性）</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">RX 特征 UUID (接收)</label>
                <input
                  type="text"
                  value={bluetoothRxCharacteristicUUID}
                  onChange={(e) => setBluetoothRxCharacteristicUUID(e.target.value)}
                  disabled={isConnected}
                  placeholder="例如: 0xfff2 或 6e400003-b5a3-f393-e0a9-e50e24dcca9e"
                  className="w-full bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 outline-none font-mono text-xs"
                />
                <p className="text-xs text-gray-500 mt-1">用于接收数据的特征 UUID（Notify属性）</p>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">波特率</label>
                <select
                  name="baudRate"
                  value={isCustomBaudRate ? 'custom' : config.baudRate}
                  onChange={handleChange}
                  disabled={isConnected}
                  className="w-full bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 outline-none"
                >
                  {baudRates.map(br => <option key={br} value={br}>{br}</option>)}
                  <option value="custom">自定义</option>
                </select>
                {isCustomBaudRate && (
                  <input
                    type="text"
                    value={customBaudRate}
                    onChange={handleCustomBaudRateChange}
                    disabled={isConnected}
                    placeholder="输入波特率"
                    className="w-full mt-2 bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 outline-none font-mono"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">数据位</label>
                  <select name="dataBits" value={config.dataBits} onChange={handleChange} disabled={isConnected} className="w-full bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 outline-none">
                    <option value={DataBits.Seven}>7</option>
                    <option value={DataBits.Eight}>8</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">停止位</label>
                  <select name="stopBits" value={config.stopBits} onChange={handleChange} disabled={isConnected} className="w-full bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 outline-none">
                    <option value={StopBits.One}>1</option>
                    <option value={StopBits.Two}>2</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">校验位</label>
                <select name="parity" value={config.parity} onChange={handleChange} disabled={isConnected} className="w-full bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 outline-none">
                  <option value={Parity.None}>None (无)</option>
                  <option value={Parity.Even}>Even (偶)</option>
                  <option value={Parity.Odd}>Odd (奇)</option>
                </select>
              </div>

              {/* 流控信号控制（DTR / RTS 两个按钮同行排列，未连接时也可预置） */}
              <div className="flex items-center justify-between pt-3">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">流控信号</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onSetDTR?.(!dtrSignal)}
                    title="Data Terminal Ready"
                    className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors cursor-pointer ${dtrSignal ? 'bg-blue-500 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                  >
                    DTR
                  </button>
                  <button
                    type="button"
                    disabled={isConnected && config.flowControl === 'hardware'}
                    onClick={() => onSetRTS?.(!rtsSignal)}
                    title="Request To Send"
                    className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors ${rtsSignal ? 'bg-blue-500 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'} ${isConnected && config.flowControl === 'hardware' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                  >
                    RTS
                  </button>
                </div>
              </div>
              {isConnected && config.flowControl === 'hardware' && (
                <p className="text-[10px] text-amber-600 mt-1">硬件流控模式下 RTS 由驱动自动管理</p>
              )}
            </>
          )}

          <div className="pt-4 border-t">
            <label className="block text-sm font-medium text-gray-600 mb-1">最大缓冲区大小</label>
            <select value={maxBufferSize} onChange={handleBufferSizeChange} className="w-full bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
              {bufferSizes.map(size => (
                <option key={size.value} value={size.value}>{size.label}</option>
              ))}
            </select>
            <div className="mt-2">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>当前使用</span>
                <span>{formatBufferSize(currentBufferSize)} / {formatBufferSize(maxBufferSize)}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full transition-colors ${
                    isBufferNearLimit ? 'bg-red-500' : bufferUsagePercent > 60 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(bufferUsagePercent, 100)}%` }}
                ></div>
              </div>
              <div className="text-xs text-gray-500 mt-1 text-right">
                {bufferUsagePercent.toFixed(1)}% 使用中
              </div>
            </div>
          </div>

          <div className="pt-4 border-t">
            <label className="block text-sm font-medium text-gray-600 mb-1">终端设置</label>
            <div className="space-y-3 p-3 bg-gray-50 rounded-md border border-gray-200 overflow-hidden">
              <label className="flex items-center text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isShowTimestamp}
                  onChange={(e) => setIsShowTimestamp(e.target.checked)}
                  className="mr-2 rounded text-blue-600 focus:ring-0"
                />
                <span>显示时间戳</span>
              </label>

              <label className="flex items-center text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isGroupByTimeout}
                  onChange={(e) => setIsGroupByTimeout(e.target.checked)}
                  className="mr-2 rounded text-blue-600 focus:ring-0"
                />
                <span>按空闲时间分组</span>
              </label>

              {isGroupByTimeout && (
                <div className="flex items-center text-xs text-gray-700 pl-5 min-w-0">
                  <span>空闲超过</span>
                  <input
                    type="number"
                    value={groupTimeoutMs}
                    onChange={(e) => setGroupTimeoutMs(Math.max(1, Number(e.target.value)))}
                    className="w-14 mx-1 px-1 border rounded text-center outline-none focus:ring-1 focus:ring-blue-500 text-xs shrink-0"
                    min="1"
                  />
                  <span className="whitespace-nowrap">ms 则换行</span>
                </div>
              )}

            </div>
          </div>

          {/* 导入/导出配置 */}
          <div className="pt-4 border-t">
            <label className="block text-sm font-medium text-gray-600 mb-1">配置管理</label>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const exportData: Record<string, any> = {
                    serial_config: config,
                    comm_mode: commMode,
                    ws_url: wsUrl,
                    bluetooth_service_uuid: bluetoothServiceUUID,
                    bluetooth_tx_characteristic_uuid: bluetoothTxCharacteristicUUID,
                    bluetooth_rx_characteristic_uuid: bluetoothRxCharacteristicUUID,
                    max_buffer_size: maxBufferSize,
                    is_group_by_timeout: isGroupByTimeout,
                    group_timeout_ms: groupTimeoutMs,
                    is_show_timestamp: isShowTimestamp
                  };
                  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `serial_config_${new Date().getTime()}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="flex-1 py-1.5 text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300 transition-colors"
              >
                <i className="fas fa-file-export mr-1"></i>导出配置
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 py-1.5 text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300 transition-colors"
              >
                <i className="fas fa-file-import mr-1"></i>导入配置
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    try {
                      const json = JSON.parse(ev.target?.result as string);
                      if (json.serial_config) setConfig(json.serial_config);
                      if (json.comm_mode) setCommMode(json.comm_mode);
                      if (json.ws_url !== undefined) setWsUrl(json.ws_url);
                      if (json.bluetooth_service_uuid !== undefined) setBluetoothServiceUUID(json.bluetooth_service_uuid);
                      if (json.bluetooth_tx_characteristic_uuid !== undefined) setBluetoothTxCharacteristicUUID(json.bluetooth_tx_characteristic_uuid);
                      if (json.bluetooth_rx_characteristic_uuid !== undefined) setBluetoothRxCharacteristicUUID(json.bluetooth_rx_characteristic_uuid);
                      if (json.max_buffer_size) setMaxBufferSize(json.max_buffer_size);
                      if (json.is_group_by_timeout !== undefined) setIsGroupByTimeout(json.is_group_by_timeout);
                      if (json.group_timeout_ms) setGroupTimeoutMs(json.group_timeout_ms);
                      if (json.is_show_timestamp !== undefined) setIsShowTimestamp(json.is_show_timestamp);
                    } catch {
                      alert('无效的配置文件');
                    }
                  };
                  reader.readAsText(file);
                  e.target.value = '';
                }}
                className="hidden"
                accept=".json"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-3 bg-white border-t">
        {!isConnected && !isReconnecting ? (
          <>
            {/* 串口模式下，如果有已保存的串口，显示重新选择按钮 */}
            {commMode === CommMode.Serial && hasSavedSerialPort && (
              <button
                onClick={onReselectSerialPort}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg border border-gray-300 transition-colors flex items-center justify-center text-sm"
              >
                <i className="fas fa-exchange-alt mr-2"></i>
                重新选择串口
              </button>
            )}
            <button onClick={onConnect} title="快捷键 ( p )" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-colors flex items-center justify-center">
              {commMode === CommMode.WebSocket ? (
                <i className="fas fa-globe mr-2"></i>
              ) : commMode === CommMode.Bluetooth ? (
                <span className="mr-2 text-lg"></span>
              ) : (
                <i className="fas fa-plug mr-2"></i>
              )}
              {commMode === CommMode.WebSocket ? '连接 WebSocket' : commMode === CommMode.Bluetooth ? '扫描蓝牙设备' : (hasSavedSerialPort ? '连接串口' : '选择串口')}
            </button>
          </>
        ) : (
          <button onClick={onDisconnect} title="快捷键 ( p )" className={`w-full ${isReconnecting ? 'bg-orange-500 hover:bg-orange-600' : 'bg-red-500 hover:bg-red-600'} text-white font-bold py-3 px-4 rounded-lg shadow-md transition-colors flex items-center justify-center`}>
            <i className={`fas ${isReconnecting ? 'fa-spinner fa-spin' : 'fa-power-off'} mr-2`}></i>
            {commMode === CommMode.WebSocket ? (isReconnecting ? '放弃重连' : '断开 WebSocket') : commMode === CommMode.Bluetooth ? '断开蓝牙' : '关闭串口'}
          </button>
        )}

        {isBufferNearLimit && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
            <i className="fas fa-exclamation-triangle mr-1"></i>
            缓冲区接近上限，旧数据将被自动删除
          </div>
        )}
      </div>
        </>
      )}
    </aside>
  );
};

export default Sidebar;
