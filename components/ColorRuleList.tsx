import React from 'react';
import { ColorRule, DisplayMode } from '../types';

interface ColorRuleListProps {
  rules: ColorRule[];
  onUpdate: (rules: ColorRule[]) => void;
  onRefreshAll: () => void;
}

const ColorRuleList: React.FC<ColorRuleListProps> = ({ rules, onUpdate, onRefreshAll }) => {
  const addRule = () => {
    const newRule: ColorRule = {
      id: Math.random().toString(36).substr(2, 9),
      color: '#e53e3e',
      leftKey: '',
      leftKeyMode: DisplayMode.Text,
      content: '',
      contentMode: DisplayMode.Text,
      rightKey: '',
      rightKeyMode: DisplayMode.Text
    };
    onUpdate([...rules, newRule]);
  };

  const removeRule = (id: string) => {
    onUpdate(rules.filter(r => r.id !== id));
  };

  const updateRule = (id: string, updates: Partial<ColorRule>) => {
    onUpdate(rules.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const ModeToggle = ({ mode, onChange }: { mode: DisplayMode; onChange: (m: DisplayMode) => void }) => (
    <div className="flex bg-gray-200 p-0.5 rounded text-[9px] shrink-0">
      <button onClick={() => onChange(DisplayMode.Text)} className={`px-1.5 py-0.5 rounded ${mode === DisplayMode.Text ? 'bg-white shadow-sm font-bold text-blue-600' : 'text-gray-500'}`}>T</button>
      <button onClick={() => onChange(DisplayMode.Hex)} className={`px-1.5 py-0.5 rounded ${mode === DisplayMode.Hex ? 'bg-white shadow-sm font-bold text-blue-600' : 'text-gray-500'}`}>H</button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
        {rules.length === 0 && (
          <div className="text-center text-gray-400 text-xs py-8">
            <i className="fas fa-palette text-2xl opacity-20 mb-2 block"></i>
            暂无染色规则，点击下方按钮添加
          </div>
        )}

        {rules.map((rule) => (
          <div key={rule.id} className="p-2 bg-gray-50 rounded-lg border border-gray-200 space-y-1.5">
            {/* 行1: color + 输入框 + 删除 */}
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={rule.color}
                onChange={(e) => updateRule(rule.id, { color: e.target.value })}
                className="w-6 h-6 rounded cursor-pointer border-0 p-0 shrink-0"
              />
              <input
                type="text"
                value={rule.leftKey}
                onChange={(e) => updateRule(rule.id, { leftKey: e.target.value })}
                placeholder="起始"
                className="flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded text-[10px] font-mono outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="text"
                value={rule.content}
                onChange={(e) => updateRule(rule.id, { content: e.target.value })}
                placeholder="关键字"
                className="flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded text-[10px] font-mono outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="text"
                value={rule.rightKey}
                onChange={(e) => updateRule(rule.id, { rightKey: e.target.value })}
                placeholder="结束" title={"别忘了切换 HEX 模式：\n\\r 回车 = 0D\n\\n 换行 = 0A"}
                className="flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded text-[10px] font-mono outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={() => removeRule(rule.id)}
                className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
              >
                <i className="fas fa-times text-[10px]"></i>
              </button>
            </div>
            {/* 行2: mode toggles */}
            <div className="flex items-center gap-1.5" style={{ paddingLeft: '28px' }}>
              <ModeToggle mode={rule.leftKeyMode} onChange={(m) => updateRule(rule.id, { leftKeyMode: m })} />
              <ModeToggle mode={rule.contentMode} onChange={(m) => updateRule(rule.id, { contentMode: m })} />
              <ModeToggle mode={rule.rightKeyMode} onChange={(m) => updateRule(rule.id, { rightKeyMode: m })} />
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t space-y-2">
        <button
          onClick={addRule}
          className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          <i className="fas fa-plus mr-1"></i>添加染色规则
        </button>
        <button
          onClick={onRefreshAll}
          className="w-full py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-[10px] text-gray-600 transition-colors"
        >
          <i className="fas fa-sync-alt mr-1"></i>全局刷新染色
        </button>
      </div>
    </div>
  );
};

export default ColorRuleList;
