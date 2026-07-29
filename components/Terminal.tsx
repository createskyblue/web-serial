import React, { useEffect, useRef, useCallback } from 'react';
import { LogEntry, DisplayMode } from '../types';
import { uint8ArrayToHex } from '../utils/converters';

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
}

const Terminal: React.FC<TerminalProps> = ({
  logs, displayMode, isGroupByTimeout, isShowTimestamp, terminalEndRef,
  lineFrequency, totalRxBytes = 0, totalTxBytes = 0,
  totalLogCount, hasMoreChunks = false, hiddenChunksCount = 0, onLoadMore
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const isLoadingMoreRef = useRef(false);

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
            {/* 左侧：文本列 */}
            <div className="flex-1 overflow-x-auto whitespace-pre border-r border-gray-300 pr-3 min-w-0">
              {logs.map((log, idx) => {
                const isSystem = log.type !== 'rx' && log.type !== 'tx';
                if (isSystem) {
                  return (
                    <span key={log.id} className="text-amber-600 block my-2 text-xs border-l-2 border-amber-200 pl-2">
                      {log.text}
                    </span>
                  );
                }
                const isFirst = idx === 0;
                const prevLog = idx > 0 ? logs[idx - 1] : null;
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
                    {log.text}
                  </span>
                );
              })}
            </div>
            {/* 右侧：HEX 列 */}
            <div className="flex-1 overflow-x-auto whitespace-pre pl-3 min-w-0">
              {logs.map((log, idx) => {
                const isSystem = log.type !== 'rx' && log.type !== 'tx';
                if (isSystem) {
                  return (
                    <span key={log.id} className="text-amber-600 block my-2 text-xs border-l-2 border-amber-200 pl-2">
                      {log.text}
                    </span>
                  );
                }
                const isFirst = idx === 0;
                const prevLog = idx > 0 ? logs[idx - 1] : null;
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
                    {(() => {
                      const newlineCount = (log.text.match(/\n/g) || []).length;
                      const suffix = newlineCount > 0 ? '\n'.repeat(newlineCount) : ' ';
                      return uint8ArrayToHex(log.data) + suffix;
                    })()}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="inline">
            {logs.map((log, idx) => {
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
              const prevLog = idx > 0 ? logs[idx - 1] : null;
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
                    ? (isGroupByTimeout
                      ? uint8ArrayToHex(log.data) + '\n'
                      : uint8ArrayToHex(log.data) + ' ')
                    : log.text}
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
        <div className="flex items-center space-x-2">
          <i className={`fas fa-circle text-[6px] ${(totalLogCount ?? logs.length) > 0 ? 'text-green-500' : 'text-gray-300'}`}></i>
          <span>{isShowTimestamp ? '时间戳' : '原始流'}</span>
        </div>
      </div>
    </div>
  );
};

export default Terminal;
