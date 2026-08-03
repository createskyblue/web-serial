import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Rule, DisplayMode, LogEntry } from '../types';
import { hexToUint8Array, uint8ArrayToString, uint8ArrayToHex, stringToUint8Array } from '../utils/converters';

interface RuleListProps {
  rules: Rule[];
  onUpdate: (rules: Rule[]) => void;
  logs: LogEntry[];
  onRefreshAll: () => void;
}

interface MatchResult {
  text: string;
  timestamp: Date;
}

/** 将 key 转换为可搜索文本（Hex 模式先转换） */
function keyToText(key: string, mode: DisplayMode): string {
  if (!key) return '';
  if (mode === DisplayMode.Hex) {
    try {
      const bytes = hexToUint8Array(key);
      return uint8ArrayToString(bytes);
    } catch { return ''; }
  }
  return key;
}

/** 查找最后一次匹配：区间模式（起始..结束）或关键词模式（仅起始） */
function extractLastMatch(
  text: string,
  getTimestamp: (posInTrimmed: number) => Date | null,
  leftKey: string,
  leftMode: DisplayMode,
  rightKey: string,
  rightMode: DisplayMode
): MatchResult | null {
  const leftText = keyToText(leftKey, leftMode);
  if (!leftText) return null;
  const rightText = rightKey ? keyToText(rightKey, rightMode) : '';

  let lastMatch: MatchResult | null = null;
  let searchFrom = 0;

  if (leftText && rightText) {
    // 区间模式：每个 left 配对它最近的 right，取最后一段完整匹配
    while (searchFrom < text.length) {
      const leftIdx = text.indexOf(leftText, searchFrom);
      if (leftIdx === -1) break;
      const rightIdx = text.indexOf(rightText, leftIdx + leftText.length);
      if (rightIdx === -1) break;
      const endPos = rightIdx + rightText.length - 1;
      lastMatch = {
        text: text.slice(leftIdx, rightIdx + rightText.length),
        timestamp: getTimestamp(endPos) ?? new Date()
      };
      searchFrom = rightIdx + rightText.length;
    }
  } else {
    // 关键词模式：仅匹配起始字段
    while (searchFrom < text.length) {
      const idx = text.indexOf(leftText, searchFrom);
      if (idx === -1) break;
      const endPos = idx + leftText.length - 1;
      lastMatch = {
        text: leftText,
        timestamp: getTimestamp(endPos) ?? new Date()
      };
      searchFrom = idx + leftText.length;
    }
  }

  return lastMatch;
}

const RuleList: React.FC<RuleListProps> = ({ rules, onUpdate, logs, onRefreshAll }) => {
  // 拼接所有 RX/TX 日志文本（只取最近 1KB）+ 构建位置→时间戳映射
  const scanData = useMemo(() => {
    const filtered = logs.filter(l => l.type === 'rx' || l.type === 'tx');
    if (filtered.length === 0) {
      return {
        text: '',
        hasData: false,
        getTimestamp: (_pos: number) => null as Date | null
      };
    }

    const parts: string[] = [];
    const offsets: { upTo: number; ts: Date }[] = [];
    let total = 0;
    for (const log of filtered) {
      parts.push(log.text);
      total += log.text.length;
      offsets.push({ upTo: total, ts: log.timestamp });
    }

    const full = parts.join('');
    const SCAN_WINDOW = 5 * 1024; // 只扫描最近 5KB
    const trimAmount = full.length > SCAN_WINDOW ? full.length - SCAN_WINDOW : 0;
    const text = trimAmount > 0 ? full.slice(trimAmount) : full;

    const getTimestamp = (posInTrimmed: number): Date | null => {
      const posInFull = posInTrimmed + trimAmount;
      for (let i = 0; i < offsets.length; i++) {
        if (offsets[i].upTo > posInFull) return offsets[i].ts;
      }
      return null;
    };

    return { text, hasData: true, getTimestamp };
  }, [logs]);

  // 每条规则最近一次命中的锁存（匹配结果不因新数据挤出扫描窗口而丢失）
  const latchedRef = useRef<Record<string, MatchResult>>({});
  // 记录每条规则上次的区间字段签名，字段被编辑时清除旧锁存
  const ruleSigRef = useRef<Record<string, string>>({});

  // 计算每条规则的提取结果（未命中但数据仍在时保留锁存）
  const extractedResults = useMemo(() => {
    const latched = latchedRef.current;
    const sigs = ruleSigRef.current;

    const results = rules.map(rule => {
      const sig = `${rule.leftKeyMode}|${rule.leftKey}|${rule.rightKeyMode}|${rule.rightKey}`;
      if (sigs[rule.id] !== sig) {
        delete latched[rule.id]; // 规则字段变化 → 旧锁存失效
        sigs[rule.id] = sig;
      }

      const current = extractLastMatch(
        scanData.text,
        scanData.getTimestamp,
        rule.leftKey, rule.leftKeyMode,
        rule.rightKey, rule.rightKeyMode
      );

      if (current) {
        latched[rule.id] = current; // 命中 → 更新并锁存
      } else if (!scanData.hasData) {
        delete latched[rule.id]; // 日志被清空 → 清除锁存
      }
      // 未命中但数据仍在（如匹配文本被挤出1KB窗口）→ 保留上次锁存

      return { ruleId: rule.id, match: latched[rule.id] ?? null };
    });

    // 清理已删除规则留下的锁存
    for (const id of Object.keys(latched)) {
      if (!rules.some(r => r.id === id)) delete latched[id];
    }
    for (const id of Object.keys(sigs)) {
      if (!rules.some(r => r.id === id)) delete sigs[id];
    }

    return results;
  }, [rules, scanData]);

  // 拖拽排序（调整优先级：越靠下优先级越高，后定义的规则覆盖前面的）
  const listRef = useRef<HTMLDivElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  // 用 ref 保存最新值，避免 mousemove 监听器重复注册
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
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
      const items = Array.from(list.querySelectorAll('[data-rule-id]')) as HTMLElement[];
      let to = from;
      for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          to = i;
          break;
        }
        to = i + 1;
      }
      to = Math.max(0, Math.min(to, rulesRef.current.length - 1));
      if (to !== from) {
        const next = [...rulesRef.current];
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

  const addRule = () => {
    const newRule: Rule = {
      id: Math.random().toString(36).substr(2, 9),
      color: '#e53e3e',
      bgColor: '',
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

  const updateRule = (id: string, updates: Partial<Rule>) => {
    onUpdate(rules.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  // 切换起始/结束字段的 T/H 模式时自动转换内容（HEX 用空格分隔）
  const changeKeyMode = (
    rule: Rule,
    modeField: 'leftKeyMode' | 'rightKeyMode',
    field: 'leftKey' | 'rightKey',
    newMode: DisplayMode
  ) => {
    if (rule[modeField] === newMode) return;
    let key = rule[field];
    try {
      if (rule[modeField] === DisplayMode.Text && newMode === DisplayMode.Hex) {
        key = uint8ArrayToHex(stringToUint8Array(rule[field]));
      } else if (rule[modeField] === DisplayMode.Hex && newMode === DisplayMode.Text) {
        key = uint8ArrayToString(hexToUint8Array(rule[field]));
      }
    } catch {
      // 非法 HEX 等转换失败时保留原内容，仅切换模式
    }
    updateRule(rule.id, { [modeField]: newMode, [field]: key } as Partial<Rule>);
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
    // 文本模式：镜像终端文本列渲染。textarea 中独立 \r 也算一次换行，而终端 div 里 \r 不换行，
    // 故 \r\n 归为单个 \n、独立 \r 直接移除，保证与终端一致（如 0D 0D 0A 只换一次行）
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
        {rules.length === 0 && (
          <div className="text-center text-gray-400 text-xs py-8">
            <i className="fas fa-palette text-2xl opacity-20 mb-2 block"></i>
            暂无规则，点击下方按钮添加
          </div>
        )}

        {rules.map((rule, index) => {
          const result = extractedResults.find(r => r.ruleId === rule.id);
          const match = result?.match ?? null;
          const displayText = formatDisplayText(match?.text ?? null, rule.displayMode);
          const hasMatch = match !== null;
          const isKeywordMode = !!rule.leftKey && !rule.rightKey;

          return (
            <div
              key={rule.id}
              data-rule-id={rule.id}
              className={`p-2 bg-gray-50 rounded-lg border border-gray-200 space-y-1.5 transition-opacity ${draggingIndex === index ? 'opacity-50' : ''}`}
            >
              {/* 行1: 拖拽手柄 + 颜色 + 起始 + 结束 + 删除 */}
              <div className="flex items-center gap-1.5">
                <span
                  onMouseDown={(e) => onHandleMouseDown(e, index)}
                  title="拖拽调整优先级（越靠下优先级越高）"
                  className="cursor-grab text-gray-400 hover:text-blue-500 select-none active:cursor-grabbing"
                >
                  <i className="fas fa-grip-vertical text-[10px]"></i>
                </span>
                <input
                  type="color"
                  value={rule.color}
                  onChange={(e) => updateRule(rule.id, { color: e.target.value })}
                  title="文字颜色"
                  className="w-6 h-6 rounded cursor-pointer border-0 p-0 shrink-0"
                />
                {/* 背景色（可选）：未设置时置灰，设置后右上角出现小叉可清除 */}
                <div className="relative shrink-0">
                  <input
                    type="color"
                    value={rule.bgColor || '#f6e05e'}
                    onChange={(e) => updateRule(rule.id, { bgColor: e.target.value })}
                    title={rule.bgColor ? `背景色 ${rule.bgColor}（点右上角 × 清除）` : '背景色（可选）'}
                    className="w-6 h-6 rounded cursor-pointer border-0 p-0 shrink-0"
                    style={rule.bgColor ? undefined : { opacity: 0.35, filter: 'grayscale(1)' }}
                  />
                  {rule.bgColor && (
                    <span
                      onClick={() => updateRule(rule.id, { bgColor: '' })}
                      title="清除背景色"
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gray-300 hover:bg-red-500 text-white rounded-full flex items-center justify-center cursor-pointer text-[8px] leading-none select-none"
                    >×</span>
                  )}
                </div>
                <input
                  type="text"
                  value={rule.leftKey}
                  onChange={(e) => updateRule(rule.id, { leftKey: e.target.value })}
                  placeholder="起始/关键字"
                  title="只填起始、结束留空 = 关键词模式"
                  className="flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded text-[10px] font-mono outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={rule.rightKey}
                  onChange={(e) => updateRule(rule.id, { rightKey: e.target.value })}
                  placeholder="结束"
                  title={"只填起始=关键词模式；\n区间模式切换 HEX：\n\\r 回车 = 0D\n\\n 换行 = 0A"}
                  className="flex-1 min-w-0 px-1.5 py-1 border border-gray-300 rounded text-[10px] font-mono outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => removeRule(rule.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
                >
                  <i className="fas fa-times text-[10px]"></i>
                </button>
              </div>
              {/* 行2: mode toggles + 模式标签 + 显示模式 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <ModeToggle mode={rule.leftKeyMode} onChange={(m) => changeKeyMode(rule, 'leftKeyMode', 'leftKey', m)} />
                  {!isKeywordMode && <ModeToggle mode={rule.rightKeyMode} onChange={(m) => changeKeyMode(rule, 'rightKeyMode', 'rightKey', m)} />}
                  <span className={`text-[9px] font-bold ${isKeywordMode ? 'text-amber-600' : 'text-gray-400'}`}>
                    {isKeywordMode ? '关键词' : '区间'}
                  </span>
                  <span className="text-[9px] text-gray-400 mx-0.5">|</span>
                  <span className="text-[9px] text-gray-400">提取:</span>
                  <ModeToggle mode={rule.displayMode} onChange={(m) => updateRule(rule.id, { displayMode: m })} />
                </div>
                {hasMatch && (
                  <span className="text-[9px] text-gray-400 shrink-0">
                    {match.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalDigits: 3 } as any)}
                  </span>
                )}
              </div>
              {/* 行3: 提取结果显示区（只读输出框：可鼠标选中复制，右下角可拖拽调整大小） */}
              <textarea
                readOnly
                value={hasMatch ? displayText : '等待匹配...'}
                rows={2}
                spellCheck={false}
                title="可选中复制；拖拽右下角调整大小"
                className={`w-full px-1.5 py-1 rounded text-[10px] font-mono min-h-[28px] resize-y overflow-auto custom-scrollbar whitespace-pre-wrap break-all border outline-none ${hasMatch ? 'bg-white border-gray-300 text-gray-800' : 'bg-gray-100 border-gray-200 text-gray-400'}`}
              />
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t space-y-2">
        <button
          onClick={addRule}
          className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          <i className="fas fa-plus mr-1"></i>添加规则
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

export default RuleList;
