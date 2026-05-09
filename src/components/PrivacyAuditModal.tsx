export default function PrivacyAuditModal({ isOpen, onClose, txId }: { isOpen: boolean; onClose: () => void; txId: string }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#1a1c2e] text-green-300 p-8 rounded-xl max-w-md border border-green-500/30 shadow-2xl shadow-green-500/10">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">🔒</span>
          <h3 className="text-xl font-bold tracking-tight text-white">Zero-Trust Verification</h3>
        </div>
        
        <p className="text-sm text-gray-300 leading-relaxed mb-6">
          This payslip was decrypted <span className="text-green-400 font-semibold">entirely in your browser</span>. 
          The Cloak SDK used your local viewing key to reveal this data. Aegis Ledger servers never saw your private key, your identity, or the decrypted amount.
        </p>
        
        <div className="bg-black/40 p-4 rounded-lg border border-white/5 mb-6">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-bold">Proof Metadata</div>
          <div className="font-mono text-xs text-gray-400 break-all leading-relaxed">
            {txId}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <a 
            href={`https://explorer.solana.com/tx/${txId}?cluster=devnet`} 
            target="_blank" 
            rel="noreferrer"
            className="flex items-center justify-center gap-2 py-2.5 px-4 bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs font-bold rounded-lg transition-all border border-green-500/20"
          >
            <span>View on Solana Explorer</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
          </a>
          
          <a 
            href="https://docs.cloak.dev" 
            target="_blank" 
            rel="noreferrer"
            className="text-center text-[10px] text-gray-500 hover:text-gray-400 underline underline-offset-4"
          >
            How does ZK-decryption work?
          </a>

          <button 
            onClick={onClose} 
            className="mt-2 py-2 px-4 bg-white/5 hover:bg-white/10 text-white text-xs font-bold rounded-lg transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
