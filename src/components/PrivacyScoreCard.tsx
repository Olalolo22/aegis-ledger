export default function PrivacyScoreCard({ usingDenominations }: { usingDenominations: boolean }) {
  const score = usingDenominations ? 92 : 45;
  
  const issues = usingDenominations
    ? [
        { msg: '✓ Using uniform denominations', pass: true },
        { msg: '✓ Sequential batching active', pass: true },
        { msg: '⚠ Timing correlation possible (random delay relay disabled)', pass: false }
      ]
    : [
        { msg: '❌ Value-linkage risk: Exact amounts used', pass: false },
        { msg: '⚠️ Timing correlation detected', pass: false },
        { msg: '💡 Enable uniform denominations for +47 points', pass: false }
      ];

  const color = score > 70 ? '#4ade80' : '#f87171';

  return (
    <div className="bg-[#1a1c2e]/60 backdrop-blur-md p-6 rounded-2xl border border-purple-500/20 shadow-xl relative overflow-hidden">
      <div className="absolute top-0 right-0 p-2 opacity-10">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>

      <div className="flex items-start gap-6">
        <div className="relative w-20 h-20 flex-shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
            <circle 
              cx="18" cy="18" r="16" 
              fill="none" 
              stroke={color} 
              strokeWidth="3" 
              strokeDasharray={`${score}, 100`} 
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 8px ${color}44)` }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-white tracking-tighter">{score}</span>
            <span className="text-[8px] uppercase tracking-widest text-gray-500 font-bold">Health</span>
          </div>
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Privacy Diagnostic</h3>
            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-white/5 text-gray-400 border border-white/10">BETA</span>
          </div>
          
          <ul className="space-y-2">
            {issues.map((issue, i) => (
              <li key={i} className="flex items-center gap-2">
                <div className={`w-1 h-1 rounded-full ${issue.pass ? 'bg-green-400' : 'bg-red-400'}`} />
                <span className={`text-[11px] font-medium ${issue.pass ? 'text-gray-300' : 'text-gray-400'}`}>
                  {issue.msg}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      
      <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
        <span className="text-[10px] text-gray-500 font-medium">Last scan: Just now</span>
        <button className="text-[10px] text-purple-400 font-bold hover:text-purple-300 transition-colors">
          View Detail Report →
        </button>
      </div>
    </div>
  );
}
