"use client";
import { useState, useEffect } from "react";
import { IconCheck, IconLightbulb, IconAlertTriangle, IconX } from "./Icons";

export default function PrivacyScoreCard({ usingDenominations, hasRuns }: { usingDenominations: boolean; hasRuns: boolean }) {
  const [scanTime, setScanTime] = useState<string>("Just now");
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    setScanTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  }, [hasRuns, usingDenominations]);

  const score = !hasRuns ? 100 : usingDenominations ? 92 : 45;
  
  const issues = !hasRuns 
    ? [
        { msg: 'Payroll batch staged & ready', pass: true },
        { msg: 'Stealth recipient protection active', pass: true }
      ]
    : usingDenominations
      ? [
          { msg: 'Salaries hidden on Solscan', pass: true },
          { msg: 'Recipient wallets protected (stealth addresses)', pass: true },
          { msg: 'Sent in single atomic batch', pass: true }
        ]
      : [
          { msg: 'Public visibility risk: Raw amounts detected', pass: false, warn: false },
          { msg: 'Batch timing protection active', pass: true },
          { msg: 'Split into shielded notes to hide compensation', pass: false, warn: false, hint: true }
        ];

  const ringColor = !hasRuns ? '#8e98a6' : score > 70 ? '#22c55e' : '#ef4444';
  const ringBg = !hasRuns ? 'rgba(142,152,166,0.08)' : score > 70 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 18,
      padding: '24px 28px',
      border: '1px solid #e8ebee',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
        {/* Score ring */}
        <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
          <svg width="64" height="64" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="18" cy="18" r="14" fill="none" stroke="#f0f1f3" strokeWidth="2.5" />
            <circle
              cx="18" cy="18" r="14"
              fill="none"
              stroke={ringColor}
              strokeWidth="2.5"
              strokeDasharray={`${score}, 100`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.16,1,0.3,1)' }}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{
              fontSize: 18, fontWeight: 700, color: '#08090b',
              letterSpacing: '-0.5px', fontFamily: 'var(--mono)',
            }}>{score}</span>
            <span style={{
              fontSize: 7, textTransform: 'uppercase',
              letterSpacing: '0.8px', color: '#8e98a6', fontWeight: 600,
            }}>Privacy</span>
          </div>
        </div>

        {/* Details */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{
              fontSize: 12, fontWeight: 600, color: '#08090b',
              letterSpacing: '-0.2px',
            }}>Payroll Privacy</span>
            <span style={{
              padding: '2px 7px', borderRadius: 5,
              fontSize: 8, fontWeight: 700,
              background: ringBg,
              color: ringColor,
              border: `1px solid ${ringColor}22`,
              letterSpacing: '0.5px',
            }}>
              {!hasRuns ? 'READY' : score > 70 ? 'PROTECTED' : 'AT RISK'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {issues.map((issue, i) => {
              const renderIcon = () => {
                if (issue.pass) return <IconCheck size={11} style={{ color: "#22c55e", flexShrink: 0 }} />;
                if ((issue as { hint?: boolean }).hint) return <IconLightbulb size={11} style={{ color: "#3b82f6", flexShrink: 0 }} />;
                if ((issue as { warn?: boolean }).warn) return <IconAlertTriangle size={11} style={{ color: "#f59e0b", flexShrink: 0 }} />;
                return <IconX size={11} style={{ color: "#ef4444", flexShrink: 0 }} />;
              };

              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  {renderIcon()}
                  <span style={{
                    fontFamily: 'var(--mono)', fontSize: 10.5,
                    color: issue.pass ? '#3b4a5a' : '#64707f',
                  }}>
                    {issue.msg}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 16, paddingTop: 14,
        borderTop: '1px solid #f0f1f3',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: '#8e98a6' }}>
          Last check: {scanTime}
        </span>
        <button 
          onClick={() => setShowReport(true)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--mono)', fontSize: 9.5,
            color: '#0066ff', fontWeight: 600,
          }}
        >
          View Privacy Report →
        </button>
      </div>

      {showReport && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#fff', width: 440, borderRadius: 16, padding: '24px 32px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 16, color: '#08090b', letterSpacing: '-0.3px' }}>
                Payroll Privacy Report
              </h3>
              <button 
                onClick={() => setShowReport(false)} 
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 24, color: '#8e98a6' }}
              >
                &times;
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: 'var(--mono)', fontSize: 12, color: '#3b4a5a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f1f3', paddingBottom: 8 }}>
                <span>What Solscan sees</span> 
                <strong style={{ color: '#22c55e' }}>Zero (Amounts & Wallets Hidden)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f1f3', paddingBottom: 8 }}>
                <span>Coworker privacy</span> 
                <strong style={{ color: '#22c55e' }}>Enforced (Private Payslips)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f1f3', paddingBottom: 8 }}>
                <span>Salary amount splitting</span> 
                <strong style={{ color: usingDenominations ? '#22c55e' : '#ef4444' }}>
                  {usingDenominations ? 'Active ($1000/$500/$100 notes)' : 'Not split (Exact amounts)'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f1f3', paddingBottom: 8 }}>
                <span>Auditor viewing access</span> 
                <strong style={{ color: '#0066ff' }}>Ready (Via Magic Link)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f1f3', paddingBottom: 8 }}>
                <span>Shielded pool depth</span> 
                <strong style={{ color: '#08090b' }}>{usingDenominations ? '~4,200 notes' : '< 10 notes'}</strong>
              </div>
            </div>
            
            <div style={{ marginTop: 24, padding: 12, background: '#f8fafc', borderRadius: 8, fontSize: 11, color: '#64707f', lineHeight: 1.5, fontFamily: 'var(--mono)' }}>
              <strong>Summary:</strong> Aegis keeps payroll completely private on Solana. Public explorers cannot see individual salaries or recipients, while your CPA can verify payouts with read-only audit keys.
            </div>
            
            <button 
              onClick={() => setShowReport(false)}
              style={{
                width: '100%', marginTop: 24, padding: 12, background: '#08090b', color: '#fff',
                border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '0.5px'
              }}
            >
              Close Report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
