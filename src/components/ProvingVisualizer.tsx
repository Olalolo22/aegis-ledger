import { useState, useEffect, useRef } from 'react';

interface Props {
  isActive: boolean;
  onComplete?: () => void;
}

const LOG_LINES = [
  '[CLOAK] Initializing circuit...',
  '[CLOAK] Building Merkle tree path...',
  '[CLOAK] Generating witness (1024 constraints)...',
  '[CLOAK] Constructing proof...',
  '[CLOAK] Proof created in 1.2s ✅',
];

const LINE_INTERVAL = 400; // ms between lines

export default function ProvingVisualizer({ isActive, onComplete }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (isActive) {
      setLines([]);
      let i = 0;
      intervalRef.current = setInterval(() => {
        setLines((prev) => {
          if (i < LOG_LINES.length) {
            const next = [...prev, LOG_LINES[i]];
            i++;
            return next;
          } else {
            if (intervalRef.current) clearInterval(intervalRef.current);
            onComplete?.();
            return prev;
          }
        });
      }, LINE_INTERVAL);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setLines([]);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, onComplete]);

  if (!isActive && lines.length === 0) return null;

  return (
    <div className="relative mt-4 p-4 bg-black/80 text-green-400 font-mono text-sm rounded-md border border-green-500/50 overflow-hidden">
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes pulse-ring {
          0% { border-color: rgba(74, 222, 128, 0.2); transform: scale(1); }
          50% { border-color: rgba(74, 222, 128, 0.6); transform: scale(1.02); }
          100% { border-color: rgba(74, 222, 128, 0.2); transform: scale(1); }
        }
      `}</style>

      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="uppercase tracking-wider text-[10px] font-bold opacity-80">Shielded Proving Engine</span>
      </div>

      <div className="space-y-1">
        {lines.map((line, idx) => (
          <div key={idx} className="opacity-0" style={{ animation: 'fadeIn 0.2s ease-in forwards' }}>
            <span className="text-green-500/50 mr-2">$</span>
            {line}
          </div>
        ))}
      </div>

      {isActive && (
        <div 
          className="absolute inset-0 border-2 rounded-md pointer-events-none" 
          style={{ animation: 'pulse-ring 2s infinite' }} 
        />
      )}
    </div>
  );
}
