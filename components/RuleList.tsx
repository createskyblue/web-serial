import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Rule, DisplayMode, LogEntry } from '../types';
import { hexToUint8Array, uint8ArrayToString, uint8ArrayToHex, stringToUint8Array } from '../utils/converters';
import HsvPicker from './HsvPicker';

/** 预置色板（多巴胺彩色 + 黑/白，参考 Tailwind 色系）：点击设为文字/背景色 */
const PRESET_COLORS = [
  '#000000', '#ffffff',
  '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'
];

interface RuleListProps {
  rules: Rule[];
  onUpdate: (rules: Rule[]) => void;
  logs: LogEntry[];
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

const RuleList: React.FC<RuleListProps> = ({ rules, onUpdate, logs }) => {
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
      if (rule.enabled === false) {
        // 停用的规则：清除锁存，不参与提取
        delete latched[rule.id];
        delete sigs[rule.id];
        return { ruleId: rule.id, match: null };
      }
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
  // 颜色选择模态框状态：正在编辑的规则 + 目标（文字色/背景色）
  const [pickerState, setPickerState] = useState<{ ruleId: string; target: 'color' | 'bgColor' } | null>(null);
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
      enabled: true,
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

  const ModeToggle = ({ label, mode, onChange }: { label?: string; mode: DisplayMode; onChange: (m: DisplayMode) => void }) => (
    <div className="flex items-center gap-0.5 shrink-0">
      {label && <span className="text-[9px] text-gray-400 shrink-0">{label}:</span>}
      <div className="flex bg-gray-200 p-0.5 rounded text-[9px]">
        <button onClick={() => onChange(DisplayMode.Text)} className={`px-1 py-0.5 rounded ${mode === DisplayMode.Text ? 'bg-white shadow-sm font-bold text-blue-600' : 'text-gray-500'}`}>Text</button>
        <button onClick={() => onChange(DisplayMode.Hex)} className={`px-1 py-0.5 rounded ${mode === DisplayMode.Hex ? 'bg-white shadow-sm font-bold text-blue-600' : 'text-gray-500'}`}>HEX</button>
      </div>
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

  // 颜色选择模态框：当前编辑的规则与颜色
  const pickerRule = pickerState ? rules.find(r => r.id === pickerState.ruleId) : null;
  const pickerColor = pickerState && pickerRule
    ? (pickerState.target === 'color' ? (pickerRule.color || '#000000') : (pickerRule.bgColor || '#f6e05e'))
    : '#f6e05e';
  const applyPickerColor = (color: string) => {
    if (!pickerState) return;
    updateRule(pickerState.ruleId, { [pickerState.target]: color } as Partial<Rule>);
  };

  // HEX 直接输入：草稿跟随当前颜色，输入合法时实时应用
  const [hexDraft, setHexDraft] = useState('');
  useEffect(() => {
    setHexDraft(pickerColor);
  }, [pickerColor]);
  const normalizeHex = (val: string): string | null => {
    let v = val.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(v)) v = v.split('').map(c => c + c).join('');
    if (/^[0-9a-fA-F]{6}$/.test(v)) return '#' + v.toLowerCase();
    return null;
  };
  const onHexChange = (val: string) => {
    setHexDraft(val);
    const normalized = normalizeHex(val);
    if (normalized) applyPickerColor(normalized);
  };

  // 双击颜色按钮：对调文字色与背景色
  const swapRuleColors = (ruleId: string) => {
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;
    updateRule(ruleId, {
      color: rule.bgColor || '',   // 背景色为空时文字色同步清空（真正的对调）
      bgColor: rule.color
    });
  };

  // 单击延迟打开取色模态框；双击时不打开（仅对调），避免误弹
  const colorClickTimerRef = useRef<number | null>(null);
  const onColorClick = (ruleId: string, target: 'color' | 'bgColor') => {
    if (colorClickTimerRef.current) window.clearTimeout(colorClickTimerRef.current);
    colorClickTimerRef.current = window.setTimeout(() => {
      setPickerState({ ruleId, target });
      colorClickTimerRef.current = null;
    }, 250);
  };
  const onColorDoubleClick = (ruleId: string) => {
    if (colorClickTimerRef.current) {
      window.clearTimeout(colorClickTimerRef.current);
      colorClickTimerRef.current = null;
    }
    swapRuleColors(ruleId);
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
              className={`p-2 bg-gray-50 rounded-lg border border-gray-200 space-y-1.5 transition-opacity ${draggingIndex === index ? 'opacity-50' : ''} ${rule.enabled === false ? 'opacity-60' : ''}`}
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
                {/* 启用/停用开关：停用后不染色、不提取 */}
                <input
                  type="checkbox"
                  checked={rule.enabled !== false}
                  onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                  title={rule.enabled !== false ? '点击停用该规则（不染色不提取）' : '点击启用该规则'}
                  className="w-3.5 h-3.5 accent-blue-600 cursor-pointer shrink-0"
                />
                {/* 文字颜色：单击取色，双击与背景色对调 */}
                <button
                  onClick={() => onColorClick(rule.id, 'color')}
                  onDoubleClick={() => onColorDoubleClick(rule.id)}
                  title={'文字颜色\n单击取色，双击与背景色对调'}
                  className="w-6 h-6 rounded cursor-pointer border border-black/10 shrink-0"
                  style={{ backgroundColor: rule.color }}
                />
                {/* 背景色（可选）：点击弹出色板模态框，未设置时置灰，设置后右上角出现小叉可清除 */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => onColorClick(rule.id, 'bgColor')}
                    onDoubleClick={() => onColorDoubleClick(rule.id)}
                    title={rule.bgColor ? `背景色 ${rule.bgColor}\n单击取色，双击与文字色对调` : '背景色（可选）\n单击取色，双击与文字色对调'}
                    className="block w-6 h-6 rounded cursor-pointer border border-black/10 shrink-0"
                    style={rule.bgColor ? { backgroundColor: rule.bgColor } : { opacity: 0.35, filter: 'grayscale(1)', backgroundColor: '#f6e05e' }}
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
                  placeholder="结束（鼠标悬浮查看提示）"
                  title={"结束留空 = 关键词模式：\n只匹配「起始」关键字，并提取出现时间\n\n填「起始 + 结束」 = 区间模式：\n染色该区间并提取区间内容\n\n区间模式 HEX 下：\n\\r 回车 = 0D\n\\n 换行 = 0A"}
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
              <div className="flex items-center justify-between gap-1 flex-wrap">
                <div className="flex items-center gap-0.5 flex-wrap">
                  <ModeToggle label="开始" mode={rule.leftKeyMode} onChange={(m) => changeKeyMode(rule, 'leftKeyMode', 'leftKey', m)} />
                  {!isKeywordMode && <ModeToggle label="结束" mode={rule.rightKeyMode} onChange={(m) => changeKeyMode(rule, 'rightKeyMode', 'rightKey', m)} />}
                  <ModeToggle label="提取结果" mode={rule.displayMode} onChange={(m) => updateRule(rule.id, { displayMode: m })} />
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
                value={rule.enabled === false ? '已停用' : hasMatch ? displayText : '等待匹配...'}
                rows={2}
                spellCheck={false}
                title="可选中复制；拖拽右下角调整大小"
                className={`w-full px-1.5 py-1 rounded text-[10px] font-mono min-h-[28px] resize-y overflow-auto custom-scrollbar whitespace-pre-wrap break-all border outline-none ${rule.enabled === false ? 'bg-gray-100 border-gray-200 text-gray-400' : hasMatch ? 'bg-white border-gray-300 text-gray-800' : 'bg-gray-100 border-gray-200 text-gray-400'}`}
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
      </div>

      {/* 颜色选择模态框：预置色板 + HSV 取色器 */}
      {pickerState && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setPickerState(null)}
        >
          <div className="bg-white rounded-xl shadow-2xl p-4 w-72" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-gray-700">
                {pickerState.target === 'color' ? '选择文字颜色' : '选择背景颜色'}
              </h3>
              <button onClick={() => setPickerState(null)} className="text-gray-400 hover:text-gray-600" title="关闭">
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => applyPickerColor(c)}
                  title={c}
                  className={`w-7 h-7 rounded-full shrink-0 cursor-pointer transition-transform hover:scale-110 ${pickerColor.toLowerCase() === c ? 'ring-2 ring-offset-1 ring-gray-500' : 'border border-black/10'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <HsvPicker color={pickerColor} onChange={applyPickerColor} />
            <div className="flex items-center gap-2 border-t border-gray-100 mt-3 pt-2">
              {/* 颜色预览 */}
              <div
                className="w-8 h-8 rounded-lg border border-black/10 shrink-0 shadow-inner"
                style={{ backgroundColor: pickerColor }}
              />
              <input
                type="text"
                value={hexDraft}
                onChange={(e) => onHexChange(e.target.value)}
                onBlur={() => setHexDraft(pickerColor)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                spellCheck={false}
                className="flex-1 min-w-0 px-1.5 py-1 text-xs font-mono text-gray-600 border border-gray-300 rounded outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="#RRGGBB"
                title="直接输入十六进制颜色值（#ff0000 / ff0000 / #f00 均可，输入合法即生效）"
              />
              {pickerState.target === 'bgColor' && (
                <button
                  onClick={() => applyPickerColor('')}
                  className="text-[10px] text-gray-400 hover:text-red-500"
                >
                  清除背景色
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RuleList;
