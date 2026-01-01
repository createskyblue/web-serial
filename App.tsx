import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  SerialConfig, 
  DataBits, 
  StopBits, 
  Parity, 
  DisplayMode, 
  LogEntry,
  QuickSendItem,
  FileSendMode
} from './types';
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
  const [isAutoLineBreak, setIsAutoLineBreak] = useState(false); 
  const [isAutoScroll, setIsAutoScroll] = useState(true); 
  const [isPaused, setIsPaused] = useState(false); // 新增暂停状态
  const [config, setConfig] = useState<SerialConfig>({
    baudRate: 115200,
    dataBits: DataBits.Eight,
    stopBits: StopBits.One,
    parity: Parity.None,
    bufferSize: 255,
    flowControl: 'none'
  });
  
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(DisplayMode.Text);

  // 添加频率统计相关状态
  const [lineFrequency, setLineFrequency] = useState(0);

  const [quickSendItems, setQuickSendItems] = useState<QuickSendItem[]>(() => {
    const saved = localStorage.getItem('quick_send_list');
    return saved ? JSON.parse(saved) : [];
  });

  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const keepReadingRef = useRef(true);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const decoderRef = useRef(new TextDecoder("utf-8", { fatal: false }));
  const isPausedRef = useRef(false); // 使用ref来跟踪暂停状态，确保在异步函数中能获取最新值
  
  // 用于统计每秒\n的计数器
  const newlineCountRef = useRef(0);
  const lastFrequencyUpdateRef = useRef(Date.now());

  // 同步isPaused状态到ref
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    localStorage.setItem('quick_send_list', JSON.stringify(quickSendItems));
  }, [quickSendItems]);

  useEffect(() => {
    if (isAutoScroll) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [logs, isAutoScroll]);

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

  const addLog = useCallback((type: LogEntry['type'], data: Uint8Array, newText: string) => {
    setLogs(prev => {
      if (!isAutoLineBreak && type === 'rx' && prev.length > 0) {
        const lastLog = prev[prev.length - 1];
        if (lastLog.type === 'rx') {
          const updatedLogs = [...prev];
          const combinedData = new Uint8Array(lastLog.data.length + data.length);
          combinedData.set(lastLog.data);
          combinedData.set(data, lastLog.data.length);
          updatedLogs[updatedLogs.length - 1] = {
            ...lastLog,
            data: combinedData,
            text: lastLog.text + newText
          };
          
          // 检查新文本中包含多少个\n，更新计数器（对于合并的记录）
          if (type === 'rx') {
            const newlineCount = (newText.match(/\n/g) || []).length;
            newlineCountRef.current += newlineCount;
          }
          
          return updatedLogs;
        }
      }
      
      // 检查新文本中包含多少个\n，更新计数器
      if (type === 'rx') {
        const newlineCount = (newText.match(/\n/g) || []).length;
        newlineCountRef.current += newlineCount;
      }
      
      const newLog: LogEntry = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date(),
        type,
        data,
        text: newText
      };
      const nextLogs = [...prev, newLog];
      return nextLogs.length > 3000 ? nextLogs.slice(-3000) : nextLogs;
    });
  }, [isAutoLineBreak]);

  const disconnect = async () => {
    keepReadingRef.current = false;
    if (readerRef.current) {
      await readerRef.current.cancel();
      readerRef.current = null;
    }
    if (port) {
      try { await port.close(); } catch (e) {}
      setPort(null);
    }
    setIsConnected(false);
    setIsPaused(false); // 断开连接时取消暂停
    addLog('info', new Uint8Array(), '串口已关闭');
  };

  const connect = async () => {
    if (!('serial' in navigator)) {
      alert('您的浏览器不支持 Web Serial API。');
      return;
    }
    try {
      const selectedPort = await (navigator as any).serial.requestPort();
      await selectedPort.open({
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity,
        flowControl: config.flowControl
      });
      setPort(selectedPort);
      setIsConnected(true);
      keepReadingRef.current = true;
      addLog('info', new Uint8Array(), `已连接: ${config.baudRate} bps`);
      readLoop(selectedPort);
    } catch (err: any) {
      addLog('error', new Uint8Array(), `连接失败: ${err.message}`);
    }
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
            addLog('rx', value, textChunk);
          }
        }
      } catch (error) {
        console.error('Read error:', error);
      } finally {
        reader.releaseLock();
      }
    }
  };

  const sendData = async (input: string, mode: DisplayMode) => {
    if (!port || !port.writable) return;
    
    // 如果暂停状态，不允许发送数据
    if (isPaused) {
      addLog('error', new Uint8Array(), '发送失败: 串口已暂停');
      return;
    }
    
    try {
      const data = mode === DisplayMode.Hex ? hexToUint8Array(input) : stringToUint8Array(input);
      const writer = port.writable.getWriter();
      await writer.write(data);
      writer.releaseLock();
      addLog('tx', data, input);
    } catch (err: any) {
      addLog('error', new Uint8Array(), `发送失败: ${err.message}`);
    }
  };

  const exportLogs = (format: 'txt' | 'bin') => {
    if (logs.length === 0) return;
    let blob: Blob;
    let filename = `serial_log_${new Date().getTime()}`;

    if (format === 'txt') {
      const content = logs.map(l => {
        const time = l.timestamp.toLocaleTimeString();
        const prefix = l.type === 'rx' ? '[RX]' : l.type === 'tx' ? '[TX]' : '[SYS]';
        return `${time} ${prefix} ${l.text}`;
      }).join('\n');
      blob = new Blob([content], { type: 'text/plain' });
      filename += '.txt';
    } else {
      // BIN 模式：只合并 RX 数据
      const rxData = logs.filter(l => l.type === 'rx').map(l => l.data);
      const totalLength = rxData.reduce((acc, curr) => acc + curr.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      rxData.forEach(data => {
        merged.set(data, offset);
        offset += data.length;
      });
      blob = new Blob([merged], { type: 'application/octet-stream' });
      filename += '.bin';
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 处理文件流发送
  const handleFileSend = async (file: File, options: { mode: FileSendMode, throttleBytes: number, throttleMs: number, onProgress: (p: number) => void }) => {
    if (!port || !port.writable) return;
    
    // 如果暂停状态，不允许发送文件
    if (isPaused) {
      addLog('error', new Uint8Array(), '文件发送失败: 串口已暂停');
      return;
    }
    
    const writer = port.writable.getWriter();
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const total = data.length;
    
    try {
      addLog('info', new Uint8Array(), `开始发送文件: ${file.name} (${total} 字节)`);
      
      let sent = 0;
      while (sent < total) {
        // 检查是否在发送过程中被暂停
        if (isPaused) {
          addLog('error', new Uint8Array(), '文件发送中断: 串口已暂停');
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
        addLog('info', new Uint8Array(), `文件发送完毕`);
      }
    } catch (err: any) {
      addLog('error', new Uint8Array(), `文件发送中断: ${err.message}`);
    } finally {
      writer.releaseLock();
    }
  };

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

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden text-gray-800">
      <Sidebar 
        config={config} setConfig={setConfig} isConnected={isConnected} 
        isAutoLineBreak={isAutoLineBreak} setIsAutoLineBreak={setIsAutoLineBreak}
        isAutoScroll={isAutoScroll} setIsAutoScroll={setIsAutoScroll}
        onConnect={connect} onDisconnect={disconnect} 
      />

      <main className="flex-1 flex flex-col min-w-0 bg-white">
        <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm z-10">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold text-blue-600 flex items-center">
              <i className="fas fa-microchip mr-2"></i>
              Web Serial Tool
            </h1>
            <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${isConnected ? 'bg-green-500 text-white' : 'bg-gray-400 text-white'}`}>
              {isConnected ? '已连接' : '未连接'}
            </div>
            {isConnected && (
              <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${isPaused ? 'bg-orange-500 text-white' : 'bg-blue-500 text-white'}`}>
                {isPaused ? '已暂停' : '运行中'}
              </div>
            )}
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
            
            {/* 暂停按钮 */}
            <button 
              onClick={togglePause}
              disabled={!isConnected}
              className={`px-4 py-1.5 border rounded-md text-xs transition-colors shadow-sm ${
                isPaused 
                  ? 'bg-orange-500 hover:bg-orange-600 text-white border-orange-600' 
                  : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-300'
              } disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              <i className={`fas ${isPaused ? 'fa-play' : 'fa-pause'} mr-1`}></i>
              {isPaused ? '恢复' : '暂停'}
            </button>
            
            <button onClick={() => setLogs([])} className="px-4 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-md text-xs transition-colors shadow-sm">
              清屏
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden p-4 flex flex-col">
          <Terminal 
            logs={logs} 
            displayMode={displayMode} 
            isAutoLineBreak={isAutoLineBreak}
            terminalEndRef={terminalEndRef}
            aiAnalysis={null}
            onCloseAi={() => {}}
            lineFrequency={lineFrequency}  // 传递频率数据
          />
        </div>

        <footer className="bg-white border-t p-4 shadow-sm">
          <Sender onSend={sendData} onFileSend={handleFileSend} isConnected={isConnected && !isPaused} />
        </footer>
      </main>

      <QuickSendList items={quickSendItems} onUpdate={setQuickSendItems} onSend={sendData} isConnected={isConnected && !isPaused} />
    </div>
  );
};

export default App;
