import React, { useMemo } from 'react';
import { ExtractRule, DisplayMode, LogEntry } from '../types';
import { hexToUint8Array, uint8ArrayToString, uint8ArrayToHex } from '../utils/converters';

interface ExtractRuleListProps {
  rules: ExtractRule[];
  onUpdate: (rules: ExtractRule[]) => void;
  logs: LogEntry[];
}

/** 在文本中查找最后（最近）一次 leftKey...rightKey 区间 */
function extractLastRange(
  text: string,
  leftKey: string,
  leftMode: DisplayMode,
  rightKey: string,
  rightMode: DisplayMode
): string | null {
  const keyToText = (key: string, mode: DisplayMode): string => {
    if (!key) return '';
    if (mode === DisplayMode.Hex) {
      try {
        const bytes = hexToUint8Array(key);
        return uint8ArrayToString(bytes);
      } catch { return ''; }
    }
    return key;
  };

  const leftText = keyToText(leftKey, leftMode);
  const rightText = keyToText(rightKey, rightMode);

  if (!leftText || !rightText) return null;

  // 正向扫描：每个 left 配对它最近的 right，取最后一段完整匹配（与染色逻辑一致）
  let lastMatch: string | null = null;
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const leftIdx = text.indexOf(leftText, searchFrom);
    if (leftIdx === -1) break;
    const rightIdx = text.indexOf(rightText, leftIdx + leftText.length);
    if (rightIdx === -1) break;
    lastMatch = text.slice(leftIdx, rightIdx + rightText.length);
    searchFrom = rightIdx + rightText.length;
  }

  return lastMatch;
}

const ExtractRuleList: React.FC<ExtractRuleListProps> = ({ rules, onUpdate, logs }) => {
  // 拼接所有 RX/TX 日志文本用于扫描
  const allText = useMemo(() => {
    return logs.filter(l => l.type === 'rx' || l.type === 'tx').map(l => l.text).join('');
  }, [logs]);

  // 计算每条规则的提取结果
  const extractedResults = useMemo(() => {
    return rules.map(rule => ({
      ruleId: rule.id,
      text: extractLastRange(allText, rule.leftKey, rule.leftKeyMode, rule.rightKey, rule.rightKeyMode)
    }));
  }, [rules, allText]);

  const addRule = () => {
    const newRule: ExtractRule = {
      id: Math.random().toString(36).substr(2, 9),
      leftKey: '',
      leftKeyMode: DisplayMode.Text,
      rightKey: '',
      rightKeyMode: DisplayMode.Text,
      displayMode: DisplayMode.Text
    };
    onUpdate([...rules, newRule]);
  };

  const removeRule = (id: string) => {
    onUpdate(rules.filter(r => r.id !== id));
  };

  const updateRule = (id: string, updates: Partial<ExtractRule>) => {
    onUpdate(rules.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const ModeToggle = ({ mode, onChange }: { mode: DisplayMode; onChange: (m: DisplayMode) => void }) => (
    <div className="flex bg-gray-200 p-0.5 rounded text-[9px] shrink-0">
      <button onClick={() => onChange(DisplayMode.Text)} className={`px-1.5 py-0.5 rounded ${mode === DisplayMode.Text ? 'bg-white shadow-sm font-bold text-blue-600' : 'text-gray-500'}`}>T</button>
      <button onClick={() => onChange(DisplayMode.Hex)} className={`px-1.5 py-0.5 rounded ${mode === DisplayMode.Hex ? 'bg-white shadow-sm font-bold text-blue-600' : 'text-gray-500'}`}>H</button>
    </div>
  );

  /** 将提取文本按显示模式转换 */
  const formatDisplayText = (text: string | null, mode: DisplayMode): string => {
    if (text === null) return '';
    if (mode === DisplayMode.Hex) {
      try {
        const bytes = new TextEncoder().encode(text);
        return uint8ArrayToHex(bytes);
      } catch { return text; }
    }
    return text;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
        {rules.length === 0 && (
          <div className="text-center text-gray-400 text-xs py-8">
            <i className="fas fa-cut text-2xl opacity-20 mb-2 block"></i>
            暂无提取规则，点击下方按钮添加
          </div>
        )}

        {rules.map((rule) => {
          const result = extractedResults.find(r => r.ruleId === rule.id);
          const displayText = formatDisplayText(result?.text ?? null, rule.displayMode);
          const hasMatch = result?.text !== null && result?.text !== undefined;

          return (
            <div key={rule.id} className="p-2 bg-gray-50 rounded-lg border border-gray-200 space-y-1.5">
              {/* 行1: 输入框 + 删除 */}
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={rule.leftKey}
                  onChange={(e) => updateRule(rule.id, { leftKey: e.target.value })}
                  placeholder="起始"
                  className="flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded text-[10px] font-mono outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={rule.rightKey}
                  onChange={(e) => updateRule(rule.id, { rightKey: e.target.value })}
                  placeholder="结束"
                  title={"别忘了切换 HEX 模式：\n\\r 回车 = 0D\n\\n 换行 = 0A"}
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
              <div className="flex items-center gap-1.5">
                <ModeToggle mode={rule.leftKeyMode} onChange={(m) => updateRule(rule.id, { leftKeyMode: m })} />
                <ModeToggle mode={rule.rightKeyMode} onChange={(m) => updateRule(rule.id, { rightKeyMode: m })} />
                <span className="text-[9px] text-gray-400 mx-1">|</span>
                <span className="text-[9px] text-gray-400">显示:</span>
                <ModeToggle mode={rule.displayMode} onChange={(m) => updateRule(rule.id, { displayMode: m })} />
              </div>
              {/* 行3: 提取结果显示区 */}
              <div className={`p-1.5 rounded text-[10px] font-mono min-h-[28px] max-h-[80px] overflow-auto custom-scrollbar whitespace-pre-wrap break-all border ${hasMatch ? 'bg-white border-gray-300 text-gray-800' : 'bg-gray-100 border-gray-200 text-gray-400'}`}>
                {hasMatch ? displayText : (
                  <span className="italic">等待匹配...</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t">
        <button
          onClick={addRule}
          className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          <i className="fas fa-plus mr-1"></i>添加提取规则
        </button>
      </div>
    </div>
  );
};

export default ExtractRuleList;
