
import React from 'react';
import { SerialConfig, DataBits, StopBits, Parity } from '../types';

interface SidebarProps {
  config: SerialConfig;
  setConfig: React.Dispatch<React.SetStateAction<SerialConfig>>;
  isConnected: boolean;
  isAutoLineBreak: boolean;
  setIsAutoLineBreak: (val: boolean) => void;
  isAutoScroll: boolean;
  setIsAutoScroll: (val: boolean) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

const Sidebar: React.FC<SidebarProps> = ({ 
  config, 
  setConfig, 
  isConnected, 
  isAutoLineBreak, 
  setIsAutoLineBreak,
  isAutoScroll,
  setIsAutoScroll,
  onConnect, 
  onDisconnect 
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: name === 'baudRate' || name === 'dataBits' || name === 'stopBits' ? Number(value) : value
    }));
  };

  return (
    <aside className="w-72 bg-white border-r flex flex-col h-full shadow-sm z-20">
      <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
        <h2 className="text-lg font-bold mb-6 text-gray-700 border-b pb-2 flex items-center">
          <i className="fas fa-cog mr-2 text-blue-500"></i>
          配置参数
        </h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">波特率</label>
            <select name="baudRate" value={config.baudRate} onChange={handleChange} disabled={isConnected} className="w-full bg-gray-50 border border-gray-300 rounded-md py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 outline-none">
              {baudRates.map(br => <option key={br} value={br}>{br}</option>)}
            </select>
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

          <div className="pt-4 border-t">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">终端设置</label>
            <div className="space-y-3 p-3 bg-gray-50 rounded-md border border-gray-200">
              <label className="flex items-center text-xs text-gray-700 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={isAutoLineBreak}
                  onChange={(e) => setIsAutoLineBreak(e.target.checked)}
                  className="mr-2 rounded text-blue-600 focus:ring-0"
                />
                <span>按数据包强制换行</span>
              </label>
              
              <label className="flex items-center text-xs text-gray-700 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={isAutoScroll}
                  onChange={(e) => setIsAutoScroll(e.target.checked)}
                  className="mr-2 rounded text-blue-600 focus:ring-0"
                />
                <span>自动滚动到底部</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-3 bg-white border-t">
        {!isConnected ? (
          <button onClick={onConnect} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-colors flex items-center justify-center">
            <i className="fas fa-plug mr-2"></i>开启串口
          </button>
        ) : (
          <button onClick={onDisconnect} className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-colors flex items-center justify-center">
            <i className="fas fa-power-off mr-2"></i>关闭串口
          </button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
