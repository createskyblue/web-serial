import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { LogEntry, DisplayMode, ColorRule } from '../types';
import { hexToUint8Array, uint8ArrayToString } from '../utils/converters';

interface ColorSegment {
  text: string;
  color?: string;
}

function highlightText(text: string, data: Uint8Array, rules: ColorRule[]): ColorSegment[] {
  if (!rules.length) return [{ text }];

  // 收集所有匹配区间
  interface Interval {
    start: number;
    end: number;
    color: string;
    priority: number;
  }
  const intervals: Interval[] = [];

  for (let ri = 0; ri < rules.length; ri++) {
    const rule = rules[ri];

    // 将 key 转换为可搜索的文本（Hex 模式先转换）
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

    const leftText = keyToText(rule.leftKey, rule.leftKeyMode);
    const contentText = keyToText(rule.content, rule.contentMode);
    const rightText = keyToText(rule.rightKey, rule.rightKeyMode);

    // 区间模式：left + right 均非空
    if (leftText && rightText) {
      let searchFrom = 0;
      while (searchFrom < text.length) {
        const leftIdx = text.indexOf(leftText, searchFrom);
        if (leftIdx === -1) break;
        const rightIdx = text.indexOf(rightText, leftIdx + leftText.length);
        if (rightIdx === -1) break;
        intervals.push({
          start: leftIdx,
          end: rightIdx + rightText.length,
          color: rule.color,
          priority: ri
        });
        searchFrom = rightIdx + rightText.length;
      }
    }

    // 关键字模式：仅 content 非空
    if (contentText) {
      let searchFrom = 0;
      while (searchFrom < text.length) {
        const idx = text.indexOf(contentText, searchFrom);
        if (idx === -1) break;
        intervals.push({
          start: idx,
          end: idx + contentText.length,
          color: rule.color,
          priority: ri
        });
        searchFrom = idx + 1;
      }
    }
  }

  if (!intervals.length) return [{ text }];

  // 按 start 排序，同 start 时高 priority 排后（后覆盖前）
  intervals.sort((a, b) => a.start - b.start || a.priority - b.priority);

  // 合并重叠区间（后定义的规则覆盖前面的）
  const merged: Interval[] = [];
  for (const iv of intervals) {
    if (merged.length === 0) {
      merged.push({ ...iv });
      continue;
    }
    const last = merged[merged.length - 1];
    if (iv.start < last.end) {
      // 重叠：高 priority 覆盖
      if (iv.priority >= last.priority) {
        // 当前规则替换重叠部分
        if (iv.start > last.start) {
          last.end = iv.start; // 截断前一段
        } else {
          merged.pop(); // 完全覆盖
        }
        merged.push({ ...iv });
      }
      // 低 priority 忽略重叠部分
    } else {
      merged.push({ ...iv });
    }
  }

  // 切分文本为片段
  const segments: ColorSegment[] = [];
  let pos = 0;
  for (const iv of merged) {
    if (iv.start > pos) {
      segments.push({ text: text.slice(pos, iv.start) });
    }
    segments.push({ text: text.slice(iv.start, iv.end), color: iv.color });
    pos = iv.end;
  }
  if (pos < text.length) {
    segments.push({ text: text.slice(pos) });
  }
  return segments;
}

/** HEX 转换；仅在 \n（或 \r\n 的 \n）处换行，与文本列浏览器的换行行为保持一致 */
function bytesToHexWithBreaks(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    result += b.toString(16).padStart(2, '0').toUpperCase();
    if (b === 0x0D) {
      if (i + 1 < bytes.length && bytes[i + 1] === 0x0A) {
        result += ' '; // \r\n 中的 \r 不加换行，留给 \n 处理
      } else {
        result += ' '; // 独立 \r：文本列浏览器渲染不换行，HEX 侧也不换行，保持两列行数一致（如 0D 0D 0A）
      }
    } else if (b === 0x0A) {
      result += '\n'; // \n 或 \r\n 中的 \n
    } else {
      result += ' ';
    }
  }
  return result;
}

interface TerminalProps {
  logs: LogEntry[];
  displayMode: DisplayMode;
  isGroupByTimeout: boolean;
  isShowTimestamp: boolean;
  terminalEndRef: React.RefObject<HTMLDivElement>;
  aiAnalysis: string | null;
  onCloseAi: () => void;
  lineFrequency?: number;
  totalRxBytes?: number;
  totalTxBytes?: number;
  totalLogCount?: number;
  hasMoreChunks?: boolean;
  hiddenChunksCount?: number;
  onLoadMore?: () => void;
  colorRules?: ColorRule[];
  colorVersion?: number;
}

const Terminal: React.FC<TerminalProps> = ({
  logs, displayMode, isGroupByTimeout, isShowTimestamp, terminalEndRef,
  lineFrequency, totalRxBytes = 0, totalTxBytes = 0,
  totalLogCount, hasMoreChunks = false, hiddenChunksCount = 0, onLoadMore,
  colorRules = [], colorVersion = 0
}) => {
  // 染色缓存
  const coloredLogs = useMemo(() => {
    return logs.map(log => ({
      log,
      segments: colorRules.length > 0 ? highlightText(log.text, log.data, colorRules) : [{ text: log.text } as ColorSegment]
    }));
  }, [logs, colorRules, colorVersion]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const isAtBottomRef = useRef(true); // 用户是否在底部
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 监听滚动位置，判断用户是否在底部
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 50; // 距离底部50px以内视为在底部
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // 新数据到达时，仅在用户处于底部时自动滚动
  useEffect(() => {
    if (isAtBottomRef.current) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [logs, terminalEndRef]);

  const handleLoadMore = useCallback(() => {
    if (!onLoadMore || isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    if (scrollContainerRef.current) {
      prevScrollHeightRef.current = scrollContainerRef.current.scrollHeight;
    }
    onLoadMore();
  }, [onLoadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMoreChunks) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) handleLoadMore(); },
      { root: scrollContainerRef.current, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreChunks, handleLoadMore]);

  useEffect(() => {
    if (prevScrollHeightRef.current > 0 && scrollContainerRef.current) {
      const newScrollHeight = scrollContainerRef.current.scrollHeight;
      scrollContainerRef.current.scrollTop += newScrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = 0;
      isLoadingMoreRef.current = false;
    }
  }, [logs]);

  return (
    <div className="flex-1 bg-white rounded-xl overflow-hidden shadow-sm flex flex-col relative border border-gray-200 h-full">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={`flex-1 p-4 overflow-y-auto custom-scrollbar font-mono text-[13px] bg-slate-50/20 ${displayMode !== DisplayMode.SplitView ? 'whitespace-pre-wrap break-all' : ''}`}
      >
        <div ref={sentinelRef} className="h-1 w-full" />

        {hasMoreChunks && (
          <div className="text-center py-1 text-[10px] text-gray-400 select-none">
            ↑ 上拉加载更多 (已隐藏 {hiddenChunksCount} 块)
          </div>
        )}

        {totalLogCount === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-300">
            <i className="fas fa-terminal text-4xl opacity-20 mb-2"></i>
            <p className="text-xs font-sans">等待串口数据...</p>
          </div>
        )}

        {displayMode === DisplayMode.SplitView ? (
          <div className="flex">
            {/* 左侧：文本列（overflow-x-scroll 始终预留横向滚动条高度，保证与右侧列高度对称） */}
            <div className="flex-1 overflow-x-scroll whitespace-pre border-r border-gray-300 pr-3 min-w-0">
              {coloredLogs.map(({ log, segments }, idx) => {
                const isSystem = log.type !== 'rx' && log.type !== 'tx';
                if (isSystem) {
                  return (
                    <span key={log.id} className="text-amber-600 block my-2 text-xs border-l-2 border-amber-200 pl-2">
                      {log.text}
                    </span>
                  );
                }
                const isFirst = idx === 0;
                const prevLog = idx > 0 ? coloredLogs[idx - 1].log : null;
                const prevIsSystem = prevLog && prevLog.type !== 'rx' && prevLog.type !== 'tx';
                const prevEndsNewline = prevLog && !prevIsSystem && prevLog.text.endsWith('\n');
                const secondChanged = prevLog && !prevIsSystem &&
                  Math.floor(log.timestamp.getTime() / 1000) !== Math.floor(prevLog.timestamp.getTime() / 1000);
                const showTs = isShowTimestamp && (isFirst || prevEndsNewline || secondChanged);
                return (
                  <span key={log.id} className={log.type === 'tx' ? 'text-blue-600' : 'text-slate-800'}>
                    {showTs && (
                      <span className="text-gray-400 text-[10px] select-none opacity-70 mr-1">
                        [{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalDigits: 3 } as any)}]
                      </span>
                    )}
                    {segments.map((seg, si) => (
                      <span key={si} style={seg.color ? { color: seg.color } : undefined}>{seg.text}</span>
                    ))}
                  </span>
                );
              })}
            </div>
            {/* 右侧：HEX 列 */}
            <div className="flex-1 overflow-x-scroll whitespace-pre pl-3 min-w-0">
              {coloredLogs.map(({ log, segments }, idx) => {
                const isSystem = log.type !== 'rx' && log.type !== 'tx';
                if (isSystem) {
                  return (
                    <span key={log.id} className="text-amber-600 block my-2 text-xs border-l-2 border-amber-200 pl-2">
                      {log.text}
                    </span>
                  );
                }
                const isFirst = idx === 0;
                const prevLog = idx > 0 ? coloredLogs[idx - 1].log : null;
                const prevIsSystem = prevLog && prevLog.type !== 'rx' && prevLog.type !== 'tx';
                const prevEndsNewline = prevLog && !prevIsSystem && prevLog.text.endsWith('\n');
                const secondChanged = prevLog && !prevIsSystem &&
                  Math.floor(log.timestamp.getTime() / 1000) !== Math.floor(prevLog.timestamp.getTime() / 1000);
                const showTs = isShowTimestamp && (isFirst || prevEndsNewline || secondChanged);
                return (
                  <span key={log.id} className={log.type === 'tx' ? 'text-blue-600' : 'text-slate-800'}>
                    {showTs && (
                      <span className="text-gray-400 text-[10px] select-none opacity-70 mr-1">
                        [{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalDigits: 3 } as any)}]
                      </span>
                    )}
                    {segments.map((seg, si) => {
                      const bytes = new TextEncoder().encode(seg.text);
                      return (
                        <span key={si} style={seg.color ? { color: seg.color } : undefined}>{bytesToHexWithBreaks(bytes)}</span>
                      );
                    })}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="inline">
            {coloredLogs.map(({ log, segments }, idx) => {
              const isSystem = log.type !== 'rx' && log.type !== 'tx';
              if (isSystem) {
                return (
                  <span key={log.id} className="text-amber-600 block my-2 text-xs border-l-2 border-amber-200 pl-2">
                    {log.text}
                  </span>
                );
              }

              // 时间戳：仅在第一条、上条以 \n 结尾、或秒数变化时显示
              const isFirst = idx === 0;
              const prevLog = idx > 0 ? coloredLogs[idx - 1].log : null;
              const prevIsSystem = prevLog && prevLog.type !== 'rx' && prevLog.type !== 'tx';
              const prevEndsNewline = prevLog && !prevIsSystem && prevLog.text.endsWith('\n');
              const secondChanged = prevLog && !prevIsSystem &&
                Math.floor(log.timestamp.getTime() / 1000) !== Math.floor(prevLog.timestamp.getTime() / 1000);
              const showTs = isShowTimestamp && (isFirst || prevEndsNewline || secondChanged);

              return (
                <span key={log.id} className={log.type === 'tx' ? 'text-blue-600' : 'text-slate-800'}>
                  {showTs && (
                    <span className="text-gray-400 text-[10px] select-none opacity-70 mr-1">
                      [{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalDigits: 3 } as any)}]
                    </span>
                  )}
                  {displayMode === DisplayMode.Hex
                    ? segments.map((seg, si) => {
                        const bytes = new TextEncoder().encode(seg.text);
                        return (
                          <span key={si} style={seg.color ? { color: seg.color } : undefined}>{bytesToHexWithBreaks(bytes)}</span>
                        );
                      })
                    : segments.map((seg, si) => (
                      <span key={si} style={seg.color ? { color: seg.color } : undefined}>{seg.text}</span>
                    ))}
                </span>
              );
            })}
          </div>
        )}
        <div ref={terminalEndRef} className="h-4 w-full invisible" />
      </div>

      <div className="bg-white px-4 py-1.5 text-[10px] text-gray-400 flex justify-between border-t border-gray-100 font-sans select-none">
        <div className="flex space-x-4">
          <span>总行数: {totalLogCount ?? logs.length}</span>
          <span className="text-emerald-600">接收: {totalRxBytes} 字节</span>
          <span className="text-blue-600">发送: {totalTxBytes} 字节</span>
          <span className="text-purple-600">换行频率: {lineFrequency !== undefined ? `${lineFrequency} 行/秒` : '0 行/秒'}</span>
        </div>
        <div className="flex items-center space-x-2 text-green-600">
          <i className={`fas fa-circle text-[6px] ${(totalLogCount ?? logs.length) > 0 ? 'text-green-500' : 'text-gray-300'}`}></i>
          <span>{now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
      </div>
    </div>
  );
};

export default Terminal;
