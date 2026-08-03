
import React, { useRef, useState, useEffect } from 'react';
import { QuickSendItem, DisplayMode } from '../types';
import { stringToUint8Array, uint8ArrayToHex, hexToUint8Array, uint8ArrayToString } from '../utils/converters';

interface QuickSendListProps {
  items: QuickSendItem[];
  onSend: (content: string, mode: DisplayMode) => void;
  onUpdate: (items: QuickSendItem[]) => void;
  isConnected: boolean;
  isReconnecting?: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  hideHeader?: boolean;
}

const QuickSendList: React.FC<QuickSendListProps> = ({ items, onSend, onUpdate, isConnected, isReconnecting = false, isCollapsed, onToggleCollapse, hideHeader = false }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addItem = () => {
    const newItem: QuickSendItem = {
      id: Math.random().toString(36).substr(2, 9),
      label: '新指令',
      content: '',
      mode: DisplayMode.Text
    };
    onUpdate([...items, newItem]);
  };

  const removeItem = (id: string) => {
    onUpdate(items.filter(item => item.id !== id));
  };

  const updateItem = (id: string, updates: Partial<QuickSendItem>) => {
    onUpdate(items.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  // 切换 Text/HEX 模式时自动转换内容（HEX 用空格分隔）
  const changeMode = (id: string, newMode: DisplayMode) => {
    const item = items.find(i => i.id === id);
    if (!item || item.mode === newMode) return;
    let content = item.content;
    try {
      if (item.mode === DisplayMode.Text && newMode === DisplayMode.Hex) {
        content = uint8ArrayToHex(stringToUint8Array(item.content));
      } else if (item.mode === DisplayMode.Hex && newMode === DisplayMode.Text) {
        content = uint8ArrayToString(hexToUint8Array(item.content));
      }
    } catch {
      // 非法 HEX 等转换失败时保留原内容，仅切换模式
    }
    updateItem(id, { mode: newMode, content });
  };

  // 拖拽排序（调整显示/发送顺序）
  const listRef = useRef<HTMLDivElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  // 用 ref 保存最新值，避免 mousemove 监听器重复注册
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const onHandleMouseDown = (e: React.MouseEvent, index: number) => {
    e.preventDefault(); // 防止拖拽时选中文本
    dragIndexRef.current = index;
    setDraggingIndex(index);
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const from = dragIndexRef.current;
      if (from === null) return;
      const list = listRef.current;
      if (!list) return;
      const items = Array.from(list.querySelectorAll('[data-item-id]')) as HTMLElement[];
      let to = from;
      for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          to = i;
          break;
        }
        to = i + 1;
      }
      to = Math.max(0, Math.min(to, itemsRef.current.length - 1));
      if (to !== from) {
        const next = [...itemsRef.current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onUpdateRef.current(next);
        dragIndexRef.current = to;
        setDraggingIndex(to); // 高亮跟随拖动的卡片
      }
    };
    const onMouseUp = () => {
      if (dragIndexRef.current !== null) {
        dragIndexRef.current = null;
        setDraggingIndex(null);
        document.body.style.userSelect = '';
      }
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const exportData = () => {
    const dataStr = JSON.stringify(items, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `serial_quick_send_${new Date().getTime()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          onUpdate(json);
        }
      } catch (err) {
        alert('无效的 JSON 文件');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <aside className="w-full bg-white border-l flex flex-col h-full shadow-sm z-20">
      {/* 折叠状态：只显示展开按钮 */}
      {isCollapsed ? (
        <div className="flex flex-col items-center py-4 h-full">
          <button
            onClick={onToggleCollapse}
            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="展开侧边栏 ( ] )"
          >
            <i className="fas fa-chevron-left text-sm"></i>
          </button>
        </div>
      ) : (
        <>
      {!hideHeader && (
      <div className="p-4 border-b bg-gray-50/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleCollapse}
            className="p-1.5 text-xs text-gray-400 hover:text-blue-600 hover:bg-white rounded transition-colors"
            title="折叠侧边栏 ( ] )"
          >
            <i className="fas fa-chevron-right text-sm"></i>
          </button>
          <h2 className="text-sm font-bold text-gray-700 flex items-center">
            <i className="fas fa-bolt mr-2 text-yellow-500"></i>
            快捷发送
          </h2>
        </div>
        <div className="flex space-x-1">
          <button onClick={() => fileInputRef.current?.click()} className="p-1.5 text-xs text-gray-500 hover:text-blue-600 hover:bg-white rounded transition-colors" title="导入">
            <i className="fas fa-file-import"></i>
          </button>
          <button onClick={exportData} className="p-1.5 text-xs text-gray-500 hover:text-blue-600 hover:bg-white rounded transition-colors" title="导出">
            <i className="fas fa-file-export"></i>
          </button>
          <input type="file" ref={fileInputRef} onChange={handleImport} className="hidden" accept=".json" />
        </div>
      </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        {items.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-xs">
            暂无快捷指令
          </div>
        )}
        {items.map((item, index) => (
          <div key={item.id} data-item-id={item.id} className={`p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-blue-200 transition-colors group ${draggingIndex === index ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  onMouseDown={(e) => onHandleMouseDown(e, index)}
                  title="拖拽调整顺序"
                  className="cursor-grab text-gray-400 hover:text-blue-500 select-none active:cursor-grabbing shrink-0"
                >
                  <i className="fas fa-grip-vertical text-[10px]"></i>
                </span>
                <input
                  value={item.label}
                  onChange={(e) => updateItem(item.id, { label: e.target.value })}
                  className="bg-transparent text-[11px] font-bold text-gray-600 focus:outline-none focus:text-blue-600 w-2/3"
                  placeholder="指令名称"
                />
              </div>
              <button onClick={() => removeItem(item.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                <i className="fas fa-times-circle text-xs"></i>
              </button>
            </div>

            <textarea
              value={item.content}
              onChange={(e) => updateItem(item.id, { content: e.target.value })}
              className="w-full text-xs font-mono p-2 bg-white border border-gray-200 rounded mb-2 h-12 outline-none focus:border-blue-300 resize-none"
              placeholder="内容..."
            />

            <div className="flex items-center justify-between">
              <div className="flex bg-gray-200 p-0.5 rounded">
                <button
                  onClick={() => changeMode(item.id, DisplayMode.Text)}
                  className={`px-2 py-0.5 text-[9px] rounded ${item.mode === DisplayMode.Text ? 'bg-white shadow-sm text-blue-600 font-bold' : 'text-gray-500'}`}
                >Text</button>
                <button
                  onClick={() => changeMode(item.id, DisplayMode.Hex)}
                  className={`px-2 py-0.5 text-[9px] rounded ${item.mode === DisplayMode.Hex ? 'bg-white shadow-sm text-blue-600 font-bold' : 'text-gray-500'}`}
                >HEX</button>
              </div>

              <button
                onClick={() => onSend(item.content, item.mode)}
                disabled={(!isConnected && !isReconnecting) || !item.content}
                className="px-4 py-1 bg-blue-500 hover:bg-blue-600 disabled:opacity-30 text-white text-[10px] font-bold rounded shadow-sm transition-colors flex items-center"
              >
                发送
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t">
        <button
          onClick={addItem}
          className="w-full py-2 bg-white border-2 border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-500 hover:text-blue-600 rounded-lg text-xs font-medium transition-all"
        >
          <i className="fas fa-plus mr-1"></i> 添加快捷指令
        </button>
      </div>
        </>
      )}
    </aside>
  );
};

export default QuickSendList;
