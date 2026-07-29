import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  SerialConfig,
  DataBits,
  StopBits,
  Parity,
  DisplayMode,
  LogEntry,
  QuickSendItem,
  FileSendMode,
  CommMode
} from './types';

// 蓝牙设备类型定义
interface BluetoothDevice {
  name?: string;
  gatt?: BluetoothRemoteGATTServer | null;
  addEventListener(type: string, listener: (event: Event) => void): void;
}

interface BluetoothRemoteGATTServer {
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
  connected: boolean;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic {
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  writeValue(value: Uint8Array): Promise<void>;
  addEventListener(type: string, listener: (event: any) => void): void;
  value?: DataView;
}
import { 
  uint8ArrayToHex, 
  uint8ArrayToString, 
  stringToUint8Array, 
  hexToUint8Array 
} from './utils/converters';

// Standard components
import Sidebar from './components/Sidebar';
import Terminal from './components/Terminal';
import Sender from './components/Sender';
import QuickSendList from './components/QuickSendList';

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

const App: React.FC = () => {
  const [port, setPort] = useState<SerialPort | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // 串口选择状态管理
  const [savedSerialPort, setSavedSerialPort] = useState<SerialPort | null>(null);

  const [isGroupByTimeout, setIsGroupByTimeout] = useState(() => {
    const saved = localStorage.getItem('is_group_by_timeout');
    return saved ? saved === 'true' : false;
  });
  const [groupTimeoutMs, setGroupTimeoutMs] = useState(() => {
    const saved = localStorage.getItem('group_timeout_ms');
    return saved ? parseInt(saved, 10) : 100;
  });
  const [isShowTimestamp, setIsShowTimestamp] = useState(() => {
    const saved = localStorage.getItem('is_show_timestamp');
    return saved ? saved === 'true' : false;
  });
  const [isAutoScroll, setIsAutoScroll] = useState(() => {
    const saved = localStorage.getItem('is_auto_scroll');
    return saved ? saved === 'true' : true;
  });
  const [isPaused, setIsPaused] = useState(false); // 新增暂停状态
  const [maxBufferSize, setMaxBufferSize] = useState(() => {
    const saved = localStorage.getItem('max_buffer_size');
    return saved ? parseInt(saved, 10) : 100 * 1024;
  }); // 最大缓冲区大小，默认100KB

  // WebSocket 相关状态
  const [commMode, setCommMode] = useState<CommMode>(() => {
    const saved = localStorage.getItem('comm_mode');
    return saved ? saved as CommMode : CommMode.Serial;
  });
  const [wsUrl, setWsUrl] = useState(() => {
    const saved = localStorage.getItem('ws_url');
    return saved !== null ? saved : 'ws://localhost:8080';
  });
  const wsRef = useRef<WebSocket | null>(null);
  const shouldReconnectRef = useRef(true); // 控制是否自动重连
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null); // 重连定时器
  const [isReconnecting, setIsReconnecting] = useState(false); // 是否正在重连中

  // 蓝牙相关状态
  const [bluetoothServiceUUID, setBluetoothServiceUUID] = useState(() => {
    const saved = localStorage.getItem('bluetooth_service_uuid');
    return saved !== null ? saved : '';
  });
  const [bluetoothTxCharacteristicUUID, setBluetoothTxCharacteristicUUID] = useState(() => {
    const saved = localStorage.getItem('bluetooth_tx_characteristic_uuid');
    return saved !== null ? saved : '';
  });
  const [bluetoothRxCharacteristicUUID, setBluetoothRxCharacteristicUUID] = useState(() => {
    const saved = localStorage.getItem('bluetooth_rx_characteristic_uuid');
    return saved !== null ? saved : '';
  });
  const bluetoothDeviceRef = useRef<BluetoothDevice | null>(null);
  const bluetoothTxCharacteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const bluetoothRxCharacteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);

  const [config, setConfig] = useState<SerialConfig>(() => {
    const saved = localStorage.getItem('serial_config');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // 解析失败，使用默认值
      }
    }
    return {
      baudRate: 115200,
      dataBits: DataBits.Eight,
      stopBits: StopBits.One,
      parity: Parity.None,
      bufferSize: 255,
      flowControl: 'none'
    };
  });
  
  const [logChunks, setLogChunks] = useState<LogEntry[][]>([[]]);
  const [visibleChunkCount, setVisibleChunkCount] = useState(2);
  const CHUNK_SIZE = 10 * 1024; // 每个块 10KB

  const [displayMode, setDisplayMode] = useState<DisplayMode>(DisplayMode.Text);

  // 添加频率统计相关状态
  const [lineFrequency, setLineFrequency] = useState(0);
  const [splitPosition, setSplitPosition] = useState(60); // 分割条位置（百分比）
  const [isDragging, setIsDragging] = useState(false);

  // 侧边栏宽度和折叠状态
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('left_sidebar_width');
    return saved ? parseInt(saved, 10) : 288;
  });
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('right_sidebar_width');
    return saved ? parseInt(saved, 10) : 320;
  });
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('left_sidebar_collapsed');
    return saved ? saved === 'true' : false;
  });
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('right_sidebar_collapsed');
    return saved ? saved === 'true' : false;
  });
  const [isDraggingLeftSidebar, setIsDraggingLeftSidebar] = useState(false);
  const [isDraggingRightSidebar, setIsDraggingRightSidebar] = useState(false);

  const [quickSendItems, setQuickSendItems] = useState<QuickSendItem[]>(() => {
    const saved = localStorage.getItem('quick_send_list');
    return saved ? JSON.parse(saved) : [];
  });

  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const keepReadingRef = useRef(true);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const decoderRef = useRef(new TextDecoder("utf-8", { fatal: false }));
  const isPausedRef = useRef(false); // 使用ref来跟踪暂停状态，确保在异步函数中能获取最新值
  const maxBufferSizeRef = useRef(maxBufferSize); // 使用ref来跟踪maxBufferSize的最新值
  const sendQueueRef = useRef<{data: Uint8Array, text: string, mode: DisplayMode}[]>([]); // 发送队列
  const isSendingRef = useRef(false); // 是否正在发送
  const isDisconnectingRef = useRef(false); // 是否正在断开中（防止重复触发）

  // 用于统计每秒\n的计数器
  const newlineCountRef = useRef(0);
  const lastFrequencyUpdateRef = useRef(Date.now());

  // 累计收发统计（不随缓冲区清理而重置）
  const [totalRxBytes, setTotalRxBytes] = useState(0);
  const [totalTxBytes, setTotalTxBytes] = useState(0);
  const totalRxBytesRef = useRef(0);
  const totalTxBytesRef = useRef(0);

  // 同步累计计数到 ref
  useEffect(() => {
    totalRxBytesRef.current = totalRxBytes;
  }, [totalRxBytes]);

  useEffect(() => {
    totalTxBytesRef.current = totalTxBytes;
  }, [totalTxBytes]);

  // 同步isPaused状态到ref
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // 同步maxBufferSize状态到ref
  useEffect(() => {
    maxBufferSizeRef.current = maxBufferSize;
  }, [maxBufferSize]);

  // 保存最大缓冲区设置到localStorage
  useEffect(() => {
    localStorage.setItem('max_buffer_size', maxBufferSize.toString());
  }, [maxBufferSize]);

  // 保存WebSocket URL到localStorage
  useEffect(() => {
    localStorage.setItem('ws_url', wsUrl);
  }, [wsUrl]);

  // 保存通讯模式到localStorage
  useEffect(() => {
    localStorage.setItem('comm_mode', commMode);
  }, [commMode]);

  // 保存串口配置到localStorage
  useEffect(() => {
    localStorage.setItem('serial_config', JSON.stringify(config));
  }, [config]);

  // 保存终端设置到localStorage
  useEffect(() => {
    localStorage.setItem('is_group_by_timeout', isGroupByTimeout.toString());
  }, [isGroupByTimeout]);

  useEffect(() => {
    localStorage.setItem('group_timeout_ms', groupTimeoutMs.toString());
  }, [groupTimeoutMs]);

  useEffect(() => {
    localStorage.setItem('is_show_timestamp', isShowTimestamp.toString());
  }, [isShowTimestamp]);

  useEffect(() => {
    localStorage.setItem('is_auto_scroll', isAutoScroll.toString());
  }, [isAutoScroll]);

  useEffect(() => {
    localStorage.setItem('quick_send_list', JSON.stringify(quickSendItems));
  }, [quickSendItems]);

  useEffect(() => {
    localStorage.setItem('left_sidebar_width', leftSidebarWidth.toString());
  }, [leftSidebarWidth]);

  useEffect(() => {
    localStorage.setItem('right_sidebar_width', rightSidebarWidth.toString());
  }, [rightSidebarWidth]);

  useEffect(() => {
    localStorage.setItem('left_sidebar_collapsed', leftSidebarCollapsed.toString());
  }, [leftSidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('right_sidebar_collapsed', rightSidebarCollapsed.toString());
  }, [rightSidebarCollapsed]);

  // 更新频率统计的定时器
  useEffect(() => {
    const frequencyTimer = setInterval(() => {
      const now = Date.now();
      const timeDiff = now - lastFrequencyUpdateRef.current;
      
      if (timeDiff >= 1000) { // 每秒更新一次
        setLineFrequency(newlineCountRef.current);
        newlineCountRef.current = 0; // 重置计数器
        lastFrequencyUpdateRef.current = now;
      }
    }, 1000);

    return () => clearInterval(frequencyTimer);
  }, []);

  // 计算所有块的总数据量
  const calcChunksSize = (chunks: LogEntry[][]): number => {
    let total = 0;
    for (const chunk of chunks) {
      for (const log of chunk) {
        total += log.data.length;
      }
    }
    return total;
  };

  // 计算当前缓冲区使用量（基于所有块）
  const calculateBufferSize = useCallback(() => {
    return calcChunksSize(logChunks);
  }, [logChunks]);

  const currentBufferSize = calculateBufferSize();

  // 派生可见日志
  const visibleLogs = useMemo(() => {
    const startIdx = Math.max(0, logChunks.length - visibleChunkCount);
    return logChunks.slice(startIdx).flat();
  }, [logChunks, visibleChunkCount]);

  // 按空闲时间分组：将间隔 <= groupTimeoutMs 的连续数据包合并为一条
  const displayLogs = useMemo(() => {
    if (!isGroupByTimeout) return visibleLogs;

    const mergeGroup = (group: LogEntry[]): LogEntry => {
      const first = group[0];
      let mergedText = group.map(l => l.text).join('');
      // 确保每组以换行结尾，在 inline 模式下能正确分行
      if (!mergedText.endsWith('\n')) mergedText += '\n';
      if (group.length === 1 && mergedText === first.text) return first; // 无需修改
      // 拼接实际字节数组（HEX 模式需要）
      const totalLen = group.reduce((s, l) => s + l.data.length, 0);
      const mergedData = new Uint8Array(totalLen);
      let offset = 0;
      for (const l of group) {
        mergedData.set(l.data, offset);
        offset += l.data.length;
      }
      return { ...first, text: mergedText, data: mergedData, byteCount: totalLen };
    };

    const result: LogEntry[] = [];
    let group: LogEntry[] = [];

    for (const log of visibleLogs) {
      if (log.type !== 'rx' && log.type !== 'tx') {
        if (group.length > 0) { result.push(mergeGroup(group)); group = []; }
        result.push(log);
        continue;
      }
      if (group.length === 0) {
        group.push(log);
      } else {
        const gap = log.timestamp.getTime() - group[group.length - 1].timestamp.getTime();
        if (gap <= groupTimeoutMs) {
          group.push(log);
        } else {
          result.push(mergeGroup(group));
          group = [log];
        }
      }
    }
    if (group.length > 0) result.push(mergeGroup(group));
    return result;
  }, [visibleLogs, isGroupByTimeout, groupTimeoutMs]);

  const totalLogCount = useMemo(() => {
    let count = 0;
    for (const chunk of logChunks) count += chunk.length;
    return count;
  }, [logChunks]);

  const hasMoreChunks = visibleChunkCount < logChunks.length;
  const hiddenChunksCount = Math.max(0, logChunks.length - visibleChunkCount);

  // 自动滚动到底部
  useEffect(() => {
    if (isAutoScroll) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [displayLogs, isAutoScroll]);

  // 加载更多块（用户上滚时调用）
  const loadMoreChunks = useCallback(() => {
    setVisibleChunkCount(prev => prev + 2);
  }, []);

  const addLog = useCallback((type: LogEntry['type'], data: Uint8Array, newText: string) => {
    // 更新累计字节统计
    if (type === 'rx') {
      setTotalRxBytes(prev => prev + data.length);
      const newlineCount = (newText.match(/\n/g) || []).length;
      newlineCountRef.current += newlineCount;
    } else if (type === 'tx') {
      setTotalTxBytes(prev => prev + data.length);
    }

    setLogChunks(prev => {
      const newLog: LogEntry = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date(),
        type,
        data,
        text: newText,
        byteCount: data.length
      };

      const chunks = prev.map(c => [...c]);
      const lastChunk = chunks[chunks.length - 1];
      const lastChunkSize = lastChunk.reduce((sum, log) => sum + log.data.length, 0);

      // 如果最后一个块 >= 10KB 且非空，新开一个块
      if (lastChunkSize >= CHUNK_SIZE && lastChunk.length > 0) {
        chunks.push([newLog]);
      } else {
        chunks[chunks.length - 1] = [...lastChunk, newLog];
      }

      // 缓冲区清理：从头部删除整块直到低于限制
      const maxSize = maxBufferSizeRef.current;
      while (chunks.length > 1) {
        const totalSize = calcChunksSize(chunks);
        if (totalSize <= maxSize) break;
        chunks.shift();
      }

      return chunks;
    });
  }, []);

  const disconnect = async () => {
    if (commMode === CommMode.Bluetooth) {
      // 蓝牙断开
      if (bluetoothDeviceRef.current && bluetoothDeviceRef.current.gatt) {
        try {
          await bluetoothDeviceRef.current.gatt.disconnect();
        } catch (e) {}
      }
      bluetoothDeviceRef.current = null;
      bluetoothTxCharacteristicRef.current = null;
      bluetoothRxCharacteristicRef.current = null;
      setIsConnected(false);
      setIsPaused(false);
      addLog('info', new Uint8Array(), '蓝牙已断开');
    } else if (commMode === CommMode.WebSocket) {
      // WebSocket 断开 - 用户主动关闭
      shouldReconnectRef.current = false; // 禁止自动重连
      setIsReconnecting(false); // 清除重连状态
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
      setIsPaused(false);
      addLog('info', new Uint8Array(), 'WebSocket 已关闭');
    } else {
      // 串口断开
      addLog('info', new Uint8Array(), '串口已关闭');
      await handleSerialDisconnect();
      // 注意：不清除 savedSerialPort，这样下次可以直接连接
    }
  };

  const connect = async () => {
    if (commMode === CommMode.Bluetooth) {
      // 蓝牙连接
      if (!('bluetooth' in navigator)) {
        alert('您的浏览器不支持 Web Bluetooth API。请使用 Chrome 或 Edge 浏览器。');
        return;
      }

      if (!bluetoothServiceUUID || !bluetoothTxCharacteristicUUID || !bluetoothRxCharacteristicUUID) {
        alert('请先配置蓝牙服务 UUID、TX 特征 UUID 和 RX 特征 UUID');
        return;
      }

      try {
        // 处理UUID16格式（例如：0xfff0 或 fff0）
        const formatUUID = (uuid: string): string => {
          // 如果是UUID16格式（4位或5位十六进制，可能带0x前缀）
          const match = uuid.match(/^(?:0x)?([0-9a-fA-F]{4})$/);
          if (match) {
            // 转换为完整UUID格式：0000xxxx-0000-1000-8000-00805f9b34fb
            const hex = match[1].padStart(4, '0').toLowerCase();
            return `0000${hex}-0000-1000-8000-00805f9b34fb`;
          }
          // 如果是完整UUID格式，直接返回（统一为小写）
          return uuid.toLowerCase();
        };

        const serviceUUID = formatUUID(bluetoothServiceUUID);
        const txUUID = formatUUID(bluetoothTxCharacteristicUUID);
        const rxUUID = formatUUID(bluetoothRxCharacteristicUUID);

        // 请求蓝牙设备（接受所有设备，在连接时验证服务UUID）
        const device = await (navigator as any).bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [serviceUUID]
        });

        addLog('info', new Uint8Array(), `正在连接蓝牙设备: ${device.name || '未知设备'}`);

        // 连接到 GATT 服务器
        const server = await device.gatt!.connect();
        addLog('info', new Uint8Array(), 'GATT 服务器已连接');

        // 获取服务
        const service = await server.getPrimaryService(serviceUUID);
        addLog('info', new Uint8Array(), '已获取服务');

        // 获取 TX 特征（发送）
        const txCharacteristic = await service.getCharacteristic(txUUID);
        addLog('info', new Uint8Array(), '已获取 TX 特征');

        // 获取 RX 特征（接收）
        const rxCharacteristic = await service.getCharacteristic(rxUUID);
        addLog('info', new Uint8Array(), '已获取 RX 特征');

        // 保存设备引用
        bluetoothDeviceRef.current = device;
        bluetoothTxCharacteristicRef.current = txCharacteristic;
        bluetoothRxCharacteristicRef.current = rxCharacteristic;

        // 订阅 RX 特征的通知
        await rxCharacteristic.startNotifications();
        addLog('info', new Uint8Array(), '已启用 RX 通知');

        // 监听 RX 特征值变化
        rxCharacteristic.addEventListener('characteristicvaluechanged', (event: any) => {
          if (isPausedRef.current) return;
          const value = event.target.value;
          const data = new Uint8Array(value.buffer);
          const textChunk = decoderRef.current.decode(data, { stream: true });
          addLog('rx', data, textChunk);
        });

        setIsConnected(true);
        addLog('info', new Uint8Array(), `蓝牙已连接: ${device.name || '未知设备'}`);

        // 监听断开连接事件
        device.addEventListener('gattserverdisconnected', () => {
          if (commMode === CommMode.Bluetooth && isConnected) {
            setIsConnected(false);
            setIsPaused(false);
            bluetoothDeviceRef.current = null;
            bluetoothTxCharacteristicRef.current = null;
            bluetoothRxCharacteristicRef.current = null;
            addLog('info', new Uint8Array(), '蓝牙设备已断开');
          }
        });
      } catch (err: any) {
        addLog('error', new Uint8Array(), `蓝牙连接失败: ${err.message}`);
      }
    } else if (commMode === CommMode.WebSocket) {
      // WebSocket 连接
      if (!wsUrl) {
        alert('请输入 WebSocket 服务器地址');
        return;
      }
      try {
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
          setIsConnected(true);
          setIsReconnecting(false);
          addLog('info', new Uint8Array(), `WebSocket 已连接: ${wsUrl}`);
        };

        ws.onmessage = (event) => {
          if (isPausedRef.current) return;
          let data: Uint8Array;
          let text: string;
          
          // 原样显示数据，不管text还是raw，不管是否乱码
          if (event.data instanceof ArrayBuffer) {
            data = new Uint8Array(event.data);
            // 不管是否乱码，原样解码显示
            text = decoderRef.current.decode(data, { stream: true });
          } else if (typeof event.data === 'string') {
            text = event.data;
            // 文本转为字节数组
            const encoder = new TextEncoder();
            data = encoder.encode(text);
          } else {
            // Blob或其他类型
            text = '[二进制数据]';
            data = new Uint8Array(0);
          }
          
          addLog('rx', data, text);
        };

        ws.onerror = (error) => {
          addLog('error', new Uint8Array(), `WebSocket 错误: ${error}`);
        };

        ws.onclose = () => {
          setIsConnected(false);
          setIsPaused(false);
          wsRef.current = null;
          
          // 如果需要重连，则启动自动重连
          if (shouldReconnectRef.current && commMode === CommMode.WebSocket) {
            setIsReconnecting(true);
            addLog('info', new Uint8Array(), 'WebSocket 连接已断开，1秒后尝试重连...');
            reconnectTimerRef.current = setTimeout(() => {
              connect();
            }, 1000);
          } else {
            setIsReconnecting(false);
            addLog('info', new Uint8Array(), 'WebSocket 连接已关闭');
          }
        };

        wsRef.current = ws;
        // 重置重连标志，允许自动重连
        shouldReconnectRef.current = true;
      } catch (err: any) {
        addLog('error', new Uint8Array(), `WebSocket 连接失败: ${err.message}`);
      }
    } else {
      // 串口连接
      if (!('serial' in navigator)) {
        alert('您的浏览器不支持 Web Serial API。');
        return;
      }

      try {
        let targetPort = savedSerialPort;

        // 如果没有保存的串口，弹窗选择
        if (!targetPort) {
          targetPort = await (navigator as any).serial.requestPort();
          setSavedSerialPort(targetPort);
        }

        await openSerialPort(targetPort);
      } catch (err: any) {
        addLog('error', new Uint8Array(), `连接失败: ${err.message}`);
      }
    }
  };

  // 打开串口的辅助函数
  const openSerialPort = async (targetPort: SerialPort) => {
    try {
      await targetPort.open({
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity,
        flowControl: config.flowControl
      });
      setPort(targetPort);
      setIsConnected(true);
      keepReadingRef.current = true;

      // 监听串口断开事件（硬件拔除）
      const onDisconnect = () => {
        addLog('info', new Uint8Array(), '串口硬件已断开');
        handleSerialDisconnect();
      };
      (targetPort as any).addEventListener('disconnect', onDisconnect);

      // 存储清理函数，用于断开时移除监听
      (targetPort as any)._disconnectHandler = onDisconnect;

      addLog('info', new Uint8Array(), `已连接: ${config.baudRate} bps`);
      readLoop(targetPort);
    } catch (err: any) {
      addLog('error', new Uint8Array(), `打开串口失败: ${err.message}`);
      // 如果打开失败，清除保存的串口
      setSavedSerialPort(null);
    }
  };

  // 处理串口断开（硬件拔除或软件关闭）
  const handleSerialDisconnect = async () => {
    // 防止重复处理
    if (isDisconnectingRef.current) return;
    isDisconnectingRef.current = true;

    keepReadingRef.current = false;

    // 先尝试取消reader，设置超时避免卡死
    if (readerRef.current) {
      try {
        // 使用 Promise.race 添加超时
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('cancel timeout')), 1000)
        );
        await Promise.race([readerRef.current.cancel(), timeoutPromise]);
      } catch (e) {
        console.log('Reader cancel timeout or error:', e);
      }
      readerRef.current = null;
    }

    // 关闭串口，同样添加超时
    if (port) {
      // 清理事件监听器
      const disconnectHandler = (port as any)._disconnectHandler;
      if (disconnectHandler) {
        try {
          (port as any).removeEventListener('disconnect', disconnectHandler);
        } catch (e) {
          // 忽略移除监听器的错误
        }
      }

      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('close timeout')), 1000)
        );
        await Promise.race([port.close(), timeoutPromise]);
      } catch (e) {
        console.log('Port close timeout or error:', e);
      }
      setPort(null);
    }

    setIsConnected(false);
    setIsPaused(false);

    // 延迟重置标志，防止短时间内重复触发
    setTimeout(() => {
      isDisconnectingRef.current = false;
    }, 500);
  };

  const readLoop = async (selectedPort: SerialPort) => {
    decoderRef.current = new TextDecoder("utf-8", { fatal: false });
    while (selectedPort.readable && keepReadingRef.current) {
      const reader = selectedPort.readable.getReader();
      readerRef.current = reader;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          // 使用ref检查暂停状态，确保获取最新值
          if (value && !isPausedRef.current) {
            const textChunk = decoderRef.current.decode(value, { stream: true });
            console.log('收到数据:', textChunk);
            addLog('rx', value, textChunk);
          }
        }
      } catch (error: any) {
        console.error('Read error:', error);
        // 检查是否是硬件断开导致的错误，且未在断开处理中
        if (!isDisconnectingRef.current && (
            error.message?.includes('break') ||
            error.message?.includes('disconnected') ||
            error.message?.includes('The device has been lost') ||
            error.name === 'NetworkError' ||
            error.name === 'NotFoundError')) {
          addLog('error', new Uint8Array(), '串口读取失败: 硬件已断开');
          // 触发断开处理
          handleSerialDisconnect();
          break;
        }
      } finally {
        try {
          reader.releaseLock();
        } catch (e) {
          // 忽略释放锁的错误
        }
        readerRef.current = null;
      }
    }
  };

  const sendData = async (input: string, mode: DisplayMode) => {
    // 如果暂停状态，不允许发送数据
    if (isPaused) {
      addLog('error', new Uint8Array(), '发送失败: 已暂停');
      return;
    }

    const data = mode === DisplayMode.Hex ? hexToUint8Array(input) : stringToUint8Array(input);
    // 将数据解码为文本，确保log.text始终是文本格式
    const textToSend = uint8ArrayToString(data);
    // 先添加发送日志，确保在回环数据之前显示
    addLog('tx', data, textToSend);
    
    // 添加到发送队列，包含mode信息
    sendQueueRef.current.push({ data, text: textToSend, mode });
    
    // 触发队列处理
    processSendQueue();
  };

  const exportLogs = (format: 'txt' | 'bin') => {
    if (totalLogCount === 0) return;
    let blob: Blob;
    let filename = `serial_log_${new Date().getTime()}`;

    // 只导出RX和TX数据，不包含系统日志信息
    const content = logChunks.flat().filter(l => l.type === 'rx' || l.type === 'tx').map(l => l.text).join('');
    blob = new Blob([content], { type: 'text/plain' });
    filename += format === 'txt' ? '.txt' : '.bin';

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 一键复制功能
  const copyLogs = () => {
    if (totalLogCount === 0) return;

    // 只复制RX和TX数据，不包含系统日志信息
    const content = logChunks.flat().filter(l => l.type === 'rx' || l.type === 'tx').map(l => l.text).join('');
    
    navigator.clipboard.writeText(content).then(() => {
      console.log('日志已复制到剪贴板');
    }).catch(err => {
      console.error('复制失败:', err);
      // 降级方案：使用传统的复制方法
      const textArea = document.createElement('textarea');
      textArea.value = content;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        console.log('日志已复制到剪贴板（降级方案）');
      } catch (err) {
        console.error('复制失败（降级方案）:', err);
      }
      document.body.removeChild(textArea);
    });
  };

  // 处理文件流发送
  const handleFileSend = async (file: File, options: { mode: FileSendMode, throttleBytes: number, throttleMs: number, onProgress: (p: number) => void }) => {
    // 如果暂停状态，不允许发送文件
    if (isPaused) {
      addLog('error', new Uint8Array(), '文件发送失败: 已暂停');
      return;
    }

    if (commMode === CommMode.Bluetooth) {
      // 蓝牙模式发送文件
      if (!bluetoothTxCharacteristicRef.current) {
        addLog('error', new Uint8Array(), '文件发送失败: 蓝牙未连接');
        return;
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const total = data.length;

        // 添加文件发送的TX日志
        addLog('tx', data, `文件: ${file.name} (${total} 字节)`);
        addLog('info', new Uint8Array(), `开始发送文件: ${file.name} (${total} 字节)`);

        let sent = 0;
        while (sent < total) {
          if (isPaused) {
            addLog('error', new Uint8Array(), '文件发送中断: 已暂停');
            break;
          }

          // 蓝牙MTU限制，通常最大512字节，使用安全值20字节
          const chunkSize = Math.min(options.throttleBytes, 20);
          const chunk = data.slice(sent, sent + chunkSize);
          await bluetoothTxCharacteristicRef.current.writeValue(chunk);
          sent += chunk.length;
          options.onProgress(Math.round((sent / total) * 100));

          if (options.throttleMs > 0 && sent < total) {
            await new Promise(resolve => setTimeout(resolve, options.throttleMs));
          }
        }

        if (!isPaused) {
          addLog('info', new Uint8Array(), '文件发送完毕');
        }
      } catch (err: any) {
        addLog('error', new Uint8Array(), `文件发送中断: ${err.message}`);
      }
    } else if (commMode === CommMode.WebSocket) {
      // WebSocket 模式发送文件
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        addLog('error', new Uint8Array(), '文件发送失败: WebSocket 未连接');
        return;
      }
      
      try {
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const total = data.length;
        
        // 添加文件发送的TX日志，用于计数
        addLog('tx', data, `文件: ${file.name} (${total} 字节)`);
        addLog('info', new Uint8Array(), `开始发送文件: ${file.name} (${total} 字节)`);
        
        let sent = 0;
        while (sent < total) {
          // 检查是否在发送过程中被暂停
          if (isPaused) {
            addLog('error', new Uint8Array(), '文件发送中断: 已暂停');
            break;
          }
          
          const chunk = data.slice(sent, sent + options.throttleBytes);
          wsRef.current.send(chunk);
          sent += chunk.length;
          options.onProgress(Math.round((sent / total) * 100));
          
          if (options.throttleMs > 0 && sent < total) {
            await new Promise(resolve => setTimeout(resolve, options.throttleMs));
          }
        }
        
        if (!isPaused) {
          addLog('info', new Uint8Array(), '文件发送完毕');
        }
      } catch (err: any) {
        addLog('error', new Uint8Array(), `文件发送中断: ${err.message}`);
      }
    } else {
      // 串口模式发送文件
      if (!port || !port.writable) return;
      
      const writer = port.writable.getWriter();
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const total = data.length;
      
      // 添加文件发送的TX日志，用于计数
      addLog('tx', data, `文件: ${file.name} (${total} 字节)`);
      
      try {
        addLog('info', new Uint8Array(), `开始发送文件: ${file.name} (${total} 字节)`);
        
        let sent = 0;
        while (sent < total) {
          // 检查是否在发送过程中被暂停
          if (isPaused) {
            addLog('error', new Uint8Array(), '文件发送中断: 已暂停');
            break;
          }
          
          const chunk = data.slice(sent, sent + options.throttleBytes);
          await writer.write(chunk);
          sent += chunk.length;
          options.onProgress(Math.round((sent / total) * 100));
          
          if (options.throttleMs > 0 && sent < total) {
            await new Promise(resolve => setTimeout(resolve, options.throttleMs));
          }
        }
        
        if (!isPaused) {
          addLog('info', new Uint8Array(), '文件发送完毕');
        }
      } catch (err: any) {
        addLog('error', new Uint8Array(), `文件发送中断: ${err.message}`);
      } finally {
        writer.releaseLock();
      }
    }
  };

  // 发送队列处理函数
  const processSendQueue = useCallback(async () => {
    if (isSendingRef.current || sendQueueRef.current.length === 0) {
      return;
    }

    isSendingRef.current = true;

    while (sendQueueRef.current.length > 0) {
      const item = sendQueueRef.current.shift();
      if (!item) break;

      try {
        if (commMode === CommMode.Bluetooth) {
          // 蓝牙模式发送
          if (bluetoothTxCharacteristicRef.current) {
            // 蓝牙发送字节数据（使用 TX 特征）
            await bluetoothTxCharacteristicRef.current.writeValue(item.data);
          }
        } else if (commMode === CommMode.WebSocket) {
          // WebSocket 模式发送
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            // 根据发送模式选择发送方式
            if (item.mode === DisplayMode.Hex) {
              // Hex模式：发送字节数据
              wsRef.current.send(item.data);
            } else {
              // Text模式：直接发送文本字符串
              wsRef.current.send(item.text);
            }
          }
        } else {
          // 串口模式发送（始终发送字节数据）
          if (port && port.writable) {
            const writer = port.writable.getWriter();
            await writer.write(item.data);
            writer.releaseLock();
          }
        }
      } catch (err: any) {
        addLog('error', new Uint8Array(), `发送失败: ${err.message}`);
      }
    }

    isSendingRef.current = false;
  }, [commMode, port]);

  // 切换暂停状态
  const togglePause = () => {
    if (!isConnected) return;
    
    const newPausedState = !isPaused;
    setIsPaused(newPausedState);
    
    if (newPausedState) {
      addLog('info', new Uint8Array(), '串口数据已暂停');
    } else {
      addLog('info', new Uint8Array(), '串口数据已恢复');
    }
  };

  // 格式化缓冲区大小显示
  const formatBufferSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 处理分割条拖拽
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const mainElement = document.querySelector('main');
      if (!mainElement) return;

      const rect = mainElement.getBoundingClientRect();
      const headerHeight = rect.top + 56; // header height approximately
      const footerHeight = 80; // sender minimum height
      const totalHeight = window.innerHeight - headerHeight - footerHeight;

      // 计算新的分割位置（限制在10%-90%之间）
      const relativeY = e.clientY - headerHeight;
      const newPercent = Math.max(10, Math.min(90, (relativeY / (window.innerHeight - headerHeight - footerHeight)) * 100));
      setSplitPosition(newPercent);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 左侧边栏拖拽调整宽度
  useEffect(() => {
    if (!isDraggingLeftSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(500, e.clientX));
      setLeftSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingLeftSidebar(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingLeftSidebar]);

  // 右侧边栏拖拽调整宽度
  useEffect(() => {
    if (!isDraggingRightSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(500, window.innerWidth - e.clientX));
      setRightSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingRightSidebar(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingRightSidebar]);

  // 键盘快捷键： [ 折叠/展开左侧栏， ] 折叠/展开右侧栏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 不在输入框中响应快捷键
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === '[') {
        e.preventDefault();
        setLeftSidebarCollapsed(prev => !prev);
      } else if (e.key === ']') {
        e.preventDefault();
        setRightSidebarCollapsed(prev => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden text-gray-800">
      {/* 左侧边栏 */}
      <div
        className="relative shrink-0 overflow-hidden transition-[width] duration-200 z-20"
        style={{ width: leftSidebarCollapsed ? 36 : leftSidebarWidth }}
      >
        <Sidebar
          config={config} setConfig={setConfig} isConnected={isConnected}
          isGroupByTimeout={isGroupByTimeout} setIsGroupByTimeout={setIsGroupByTimeout}
          groupTimeoutMs={groupTimeoutMs} setGroupTimeoutMs={setGroupTimeoutMs}
          isShowTimestamp={isShowTimestamp} setIsShowTimestamp={setIsShowTimestamp}
          isAutoScroll={isAutoScroll} setIsAutoScroll={setIsAutoScroll}
          maxBufferSize={maxBufferSize} setMaxBufferSize={setMaxBufferSize}
          currentBufferSize={currentBufferSize}
          commMode={commMode} setCommMode={setCommMode}
          wsUrl={wsUrl} setWsUrl={setWsUrl}
          bluetoothServiceUUID={bluetoothServiceUUID} setBluetoothServiceUUID={setBluetoothServiceUUID}
          bluetoothTxCharacteristicUUID={bluetoothTxCharacteristicUUID} setBluetoothTxCharacteristicUUID={setBluetoothTxCharacteristicUUID}
          bluetoothRxCharacteristicUUID={bluetoothRxCharacteristicUUID} setBluetoothRxCharacteristicUUID={setBluetoothRxCharacteristicUUID}
          onConnect={connect} onDisconnect={disconnect}
          isReconnecting={isReconnecting}
          hasSavedSerialPort={!!savedSerialPort}
          isCollapsed={leftSidebarCollapsed}
          onToggleCollapse={() => setLeftSidebarCollapsed(prev => !prev)}
          onReselectSerialPort={async () => {
            if (!('serial' in navigator)) return;
            try {
              const newPort = await (navigator as any).serial.requestPort();
              setSavedSerialPort(newPort);
              addLog('info', new Uint8Array(), '已选择新串口，点击"连接串口"按钮连接');
            } catch (err: any) {
              addLog('error', new Uint8Array(), `选择串口失败: ${err.message}`);
            }
          }}
        />
        {/* 左侧栏拖拽调整大小手柄 */}
        {!leftSidebarCollapsed && (
          <div
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-400 active:bg-blue-500 transition-colors z-30"
            onMouseDown={(e) => {
              e.preventDefault();
              setIsDraggingLeftSidebar(true);
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          />
        )}
      </div>

      <main className="flex-1 flex flex-col min-w-0 bg-white relative z-10">
        <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold text-blue-600 flex items-center">
              <i className="fas fa-microchip mr-2"></i>
              Web Serial Tool
            </h1>
          </div>
          
          <div className="flex items-center space-x-3">
            <div className="bg-gray-100 p-1 rounded-lg flex border border-gray-200">
              <button onClick={() => setDisplayMode(DisplayMode.Text)} className={`px-3 py-1 text-xs rounded-md transition-colors ${displayMode === DisplayMode.Text ? 'bg-white shadow-sm text-blue-600 font-bold' : 'text-gray-500'}`}>文本</button>
              <button onClick={() => setDisplayMode(DisplayMode.Hex)} className={`px-3 py-1 text-xs rounded-md transition-colors ${displayMode === DisplayMode.Hex ? 'bg-white shadow-sm text-blue-600 font-bold' : 'text-gray-500'}`}>HEX</button>
            </div>
            
            <div className="flex bg-white border rounded-md overflow-hidden shadow-sm">
              <button onClick={() => exportLogs('txt')} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 border-r border-gray-100">
                <i className="fas fa-file-alt mr-1"></i> 导出 TXT
              </button>
              <button onClick={() => exportLogs('bin')} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
                <i className="fas fa-file-code mr-1"></i> 导出 BIN
              </button>
            </div>
            
            {/* 一键复制按钮 */}
            <button
              onClick={copyLogs}
              disabled={totalLogCount === 0}
              className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white border border-blue-600 rounded-md text-xs transition-colors shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <i className="fas fa-copy mr-1"></i> 复制
            </button>

            <button
              onClick={() => {
                setLogChunks([[]]);
                setVisibleChunkCount(2);
                setTotalRxBytes(0);
                setTotalTxBytes(0);
              }}
              className="px-4 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-md text-xs transition-colors shadow-sm"
              title="清空屏幕和统计数据"
            >
              清屏
            </button>

            <button
              onClick={() => {
                setTotalRxBytes(0);
                setTotalTxBytes(0);
                addLog('info', new Uint8Array(), '统计数据已重置');
              }}
              className="px-4 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-md text-xs transition-colors shadow-sm"
              title="仅重置统计计数"
            >
              清计数
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex flex-col" style={{ height: `${splitPosition}%` }}>
          <div className="flex-1 overflow-hidden p-2 flex flex-col">
            <Terminal
              logs={displayLogs}
              displayMode={displayMode}
              isShowTimestamp={isShowTimestamp}
              terminalEndRef={terminalEndRef}
              aiAnalysis={null}
              onCloseAi={() => {}}
              lineFrequency={lineFrequency}
              totalRxBytes={totalRxBytes}
              totalTxBytes={totalTxBytes}
              totalLogCount={totalLogCount}
              hasMoreChunks={hasMoreChunks}
              hiddenChunksCount={hiddenChunksCount}
              onLoadMore={loadMoreChunks}
            />
          </div>
        </div>

        {/* 分割条 */}
        <div 
          className="h-1 bg-gray-200 hover:bg-blue-400 cursor-row-resize transition-colors flex items-center justify-center"
          onMouseDown={handleMouseDown}
        ></div>
        

        <div className="bg-white shadow-sm m-2 mb-2" style={{ height: `${100 - splitPosition}%`, minHeight: '80px' }}>
          <Sender onSend={sendData} onFileSend={handleFileSend} isConnected={isConnected && !isPaused} isReconnecting={isReconnecting} />
        </div>
      </main>

      {/* 右侧边栏 */}
      <div
        className="relative shrink-0 overflow-hidden transition-[width] duration-200 z-20"
        style={{ width: rightSidebarCollapsed ? 36 : rightSidebarWidth }}
      >
        {/* 右侧栏拖拽调整大小手柄 */}
        {!rightSidebarCollapsed && (
          <div
            className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-blue-400 active:bg-blue-500 transition-colors z-30"
            onMouseDown={(e) => {
              e.preventDefault();
              setIsDraggingRightSidebar(true);
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          />
        )}
        <QuickSendList
          items={quickSendItems} onUpdate={setQuickSendItems} onSend={sendData}
          isConnected={isConnected && !isPaused} isReconnecting={isReconnecting}
          isCollapsed={rightSidebarCollapsed}
          onToggleCollapse={() => setRightSidebarCollapsed(prev => !prev)}
        />
      </div>
    </div>
  );
};

export default App;
