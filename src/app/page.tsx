"use client";

import { useEffect } from "react";
import Link from "next/link";
import "./landing.css";
import { useLiveFx } from "@/hooks/useLiveFx";
import { IconBolt, IconShield, IconKey, IconFlagNG } from "@/components/Icons";

export default function LandingPage() {
    const { rates: liveFx } = useLiveFx();

    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, { threshold: 0.1 });

        document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
       
        return () => observer.disconnect();
    }, []);

    return (
        <div className="landing-wrapper">
            {/* NAV */}
            <nav>
                <Link href="#" className="nav-brand">
                    <img src="/logo.svg" alt="Aegis Logo" className="nav-mark" style={{ border: 'none', padding: 0 }} />
                    <span className="nav-name">Aegis Ledger</span>
                </Link>
                <ul className="nav-links">
                    <li><a href="#problem">Problem</a></li>
                    <li><a href="#solution">Solution</a></li>
                    <li><a href="#how">How it works</a></li>
                    <li><a href="#compare">Compare</a></li>
                </ul>
                <div className="nav-cta">
                    <span className="cloak-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <IconFlagNG width={13} height={9} /> Superteam Nigeria Track
                    </span>
                    <a href="https://github.com/Olalolo22/aegis-ledger" target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ textDecoration: 'none' }}>Docs</a>
                    <Link href="/dashboard" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
                        Launch Terminal
                    </Link>
                </div>
            </nav>

            {/* ─── HERO ─────────────────────────────────────────────── */}
            <div className="hero reveal">
                <div className="hero-left">
                    <div className="hero-eyebrow reveal" style={{ transitionDelay: '0.1s' }}>
                        <span className="hero-dot"></span>
                        Solana Confidential Settlement · Superteam Nigeria Track
                    </div>
                    <h1 className="serif reveal" style={{ transitionDelay: '0.2s' }}>
                        Emerging market<br />
                        payroll is<br />
                        <em>an open book.</em>
                    </h1>
                    <p className="hero-sub reveal" style={{ transitionDelay: '0.3s' }}>
                        Aegis Ledger is a confidential treasury disbursement engine for distributed teams and emerging market devshops.
                        Pay remote engineers in USDC without doxxing salaries on Solscan, reverse-engineering runway, or triggering P2P bank account freezes.
                    </p>
                    <div className="hero-actions reveal" style={{ transitionDelay: '0.4s' }}>
                        <Link href="/dashboard" className="btn-lg" style={{ textDecoration: 'none', display: 'inline-block' }}>
                            Launch Payroll Terminal →
                        </Link>
                        <a href="#how" className="btn-lg-ghost" style={{ textDecoration: 'none', display: 'inline-block' }}>See the architecture →</a>
                    </div>
                    <div className="hero-social reveal" style={{ transitionDelay: '0.5s' }}>
                        <span className="trust-line">Designed for remote teams across</span>
                        <div className="trust-orgs">
                            <span className="trust-org">Lagos</span>
                            <span className="trust-org">Nairobi</span>
                            <span className="trust-org">Kigali</span>
                            <span className="trust-org">Global ZK</span>
                        </div>
                    </div>
                </div>

                <div className="hero-mockup reveal" style={{ transitionDelay: '0.4s' }}>
                    <div className="mockup-stack">
                        {/* Treasury Card */}
                        <div className="card-treasury reveal" style={{ transitionDelay: '0.5s' }}>
                            <div className="card-t-header">
                                <div>
                                    <div className="card-t-label">Operating runway (Shielded)</div>
                                </div>
                                <div className="card-t-shield" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <IconBolt size={10} /> MAGICBLOCK PER
                                </div>
                            </div>
                            <div className="card-t-amount">$148,500</div>
                            <div className="card-t-sub">Active startup payroll pool · Uniform note splitting</div>
                            <div className="card-t-grid">
                                <div>
                                    <div className="card-t-stat-label">Available</div>
                                    <div className="card-t-stat-val">$136,400</div>
                                </div>
                                <div>
                                    <div className="card-t-stat-label">Locked (payroll)</div>
                                    <div className="card-t-stat-val">$12,100</div>
                                </div>
                                <div>
                                    <div className="card-t-stat-label">TEE Enclave</div>
                                    <div className="card-t-stat-val green">✓ &lt;50ms</div>
                                </div>
                            </div>
                        </div>

                        {/* Batch Run Card */}
                        <div className="card-batch reveal" style={{ transitionDelay: '0.6s' }}>
                            <div className="card-b-header">
                                <span className="card-b-title">Batch payroll run — October 2026</span>
                                <div className="card-b-status">
                                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}></span>
                                    SHIELDED
                                </div>
                            </div>
                            <div className="recipients">
                                <div className="recip-row">
                                    <span className="recip-addr">Lead Anchor Dev · Lagos</span>
                                    <span><span className="recip-amount">$4,850</span><span className="recip-token">USDC (₦{((4850 * liveFx.NGN) / 1e6).toFixed(1)}M)</span></span>
                                </div>
                                <div className="recip-row">
                                    <span className="recip-addr">Frontend Lead · Nairobi</span>
                                    <span><span className="recip-amount">$3,200</span><span className="recip-token">USDC (KSh {Math.round((3200 * liveFx.KES) / 1000)}K)</span></span>
                                </div>
                                <div className="recip-row">
                                    <span className="recip-addr">ZK Research Fellow · Global</span>
                                    <span><span className="recip-amount">$3,500</span><span className="recip-token">USDC (UTXO)</span></span>
                                </div>
                            </div>
                            <div className="card-b-footer">
                                <span className="card-b-footer-l">6 recipients · sub-50ms TEE slot</span>
                                <span className="card-b-footer-r">On-chain view: [CONFIDENTIAL]</span>
                            </div>
                        </div>

                        {/* Audit key */}
                        <div className="card-audit reveal" style={{ transitionDelay: '0.7s' }}>
                            <div className="audit-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <IconKey size={16} />
                            </div>
                            <div className="audit-key">
                                <div className="audit-key-label">Auditor viewing key (24-hr)</div>
                                <div className="audit-key-val">vk_aegis_3f9a···c2d1</div>
                            </div>
                            <Link href="/audit" className="audit-action" style={{ textDecoration: 'none' }}>Reveal ledger →</Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── PROBLEM ───────────────────────────────────────────── */}
            <div className="problem-section" id="problem">
                <div className="problem-inner">
                    <div className="section-eyebrow reveal">The problem</div>
                    <h2 className="section-h2 serif reveal" style={{ transitionDelay: '0.1s' }}>Public Solana rails make emerging-market payroll dangerous.</h2>
                    <p className="section-sub reveal" style={{ transitionDelay: '0.2s' }}>
                        When startups in Lagos, Nairobi, or Kigali pay remote contractors on public Solana, every competitor inspects their burn rate,
                        and developers face real-world personal safety and banking risks.
                    </p>
                    <div className="stats-grid">
                        <div className="stat-cell reveal" style={{ transitionDelay: '0.3s' }}>
                            <div className="stat-num serif"><span>100%</span></div>
                            <div className="stat-desc">of public wallet balances are visible on Solscan — exposing remote developers to extortion, kidnapping, and targeted harassment in emerging markets.</div>
                            <div className="stat-source">Source: <a href="https://explorer.solana.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Solana Explorer</a></div>
                        </div>
                        <div className="stat-cell reveal" style={{ transitionDelay: '0.4s' }}>
                            <div className="stat-num serif">₦<span>0</span></div>
                            <div className="stat-desc">access to funds when centralized banks freeze developers' local accounts due to automated P2P crypto transaction flags.</div>
                            <div className="stat-source">Source: Superteam Nigeria Community Research</div>
                        </div>
                        <div className="stat-cell reveal" style={{ transitionDelay: '0.5s' }}>
                            <div className="stat-num serif">&lt; 50<span>ms</span></div>
                            <div className="stat-desc">batch execution inside MagicBlock TEE hardware enclaves eliminates browser WASM timeouts and proves transactions in sub-seconds.</div>
                            <div className="stat-source">Source: <a href="https://magicblock.gg" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>MagicBlock Benchmarks</a></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── SOLUTION ──────────────────────────────────────────── */}
            <section id="solution">
                <div className="section-eyebrow reveal">The solution</div>
                <h2 className="section-h2 serif reveal" style={{ transitionDelay: '0.1s' }}>Confidential on-chain. Accountable off-chain. Direct to local fiat.</h2>
                <p className="section-sub reveal" style={{ transitionDelay: '0.2s' }}>
                    Aegis Ledger runs treasury disbursements inside MagicBlock Private Ephemeral Rollups (TEE), partitions non-uniform salaries into standardized notes, and triggers automated fiat off-ramps.
                </p>
                <div className="features-grid">
                    <div className="feature-cell reveal" style={{ transitionDelay: '0.3s' }}>
                        <div className="feat-num">01</div>
                        <span className="feat-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <IconBolt size={20} />
                        </span>
                        <div className="feat-title">Sub-50ms TEE batch execution</div>
                        <div className="feat-desc">Run payroll for 50+ contributors in a single hardware-enclave transaction. Sub-second execution with zero browser Groth16 WASM lag.</div>
                        <div className="feat-tag">magicblock.perBatch()</div>
                    </div>
                    <div className="feature-cell reveal" style={{ transitionDelay: '0.4s' }}>
                        <div className="feat-num">02</div>
                        <span className="feat-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <IconShield size={20} />
                        </span>
                        <div className="feat-title">Uniform note splitting</div>
                        <div className="feat-desc">Decomposes non-uniform salaries into standardized $1000, $500, and $100 notes. Destroys amount-clustering and balance-correlation attacks on Solscan.</div>
                        <div className="feat-tag">denominate.ts</div>
                    </div>
                    <div className="feature-cell reveal" style={{ transitionDelay: '0.5s' }}>
                        <div className="feat-num">03</div>
                        <span className="feat-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <IconFlagNG width={22} height={15} />
                        </span>
                        <div className="feat-title">Native dual-rail settlement (NGN / KES)</div>
                        <div className="feat-desc">Direct automated off-ramp triggers into Nigerian banks (Providus/Kuda) and Kenyan Safaricom M-Pesa with live Spot FX and zero P2P bank-freeze risk.</div>
                        <div className="feat-tag">Live Spot: ₦{liveFx.NGN.toLocaleString()} / KSh {liveFx.KES}</div>
                    </div>
                    <div className="feature-cell reveal" style={{ transitionDelay: '0.6s' }}>
                        <div className="feat-num">04</div>
                        <span className="feat-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <IconKey size={20} />
                        </span>
                        <div className="feat-title">Cryptographic audit access</div>
                        <div className="feat-desc">Issue time-limited viewing keys to auditors via magic-link sessions. Verify tax compliance without leaking ongoing treasury activity.</div>
                        <div className="feat-tag">AES-256-GCM + HKDF</div>
                    </div>
                </div>
            </section>

            {/* ─── HOW IT WORKS ──────────────────────────────────────── */}
            <div style={{ background: 'var(--paper)', borderTop: '1px solid var(--mist)', borderBottom: '1px solid var(--mist)' }} id="how">
                <section>
                    <div className="section-eyebrow reveal">How it works</div>
                    <h2 className="section-h2 serif reveal" style={{ transitionDelay: '0.1s' }}>From payroll CSV to confidential settlement in four steps.</h2>
                    <div className="how-grid" style={{ marginTop: '48px' }}>
                        <div className="how-step reveal" style={{ transitionDelay: '0.2s' }}>
                            <div className="how-num serif">01</div>
                            <div className="how-title">Upload contributor CSV</div>
                            <div className="how-desc">Import roles, Solana wallet addresses, and preferred payout rails (USDC, Nigerian Bank, or Kenyan M-Pesa). Addresses validated on-curve.</div>
                        </div>
                        <div className="how-step reveal" style={{ transitionDelay: '0.3s' }}>
                            <div className="how-num serif">02</div>
                            <div className="how-title">Uniform note splitting</div>
                            <div className="how-desc">Standardized note denomination splitting breaks salaries into uniform amounts so on-chain observers cannot link deposits to withdrawals.</div>
                        </div>
                        <div className="how-step reveal" style={{ transitionDelay: '0.4s' }}>
                            <div className="how-num serif">03</div>
                            <div className="how-title">Sub-50ms TEE dispatch</div>
                            <div className="how-desc">Hardware enclaves inside MagicBlock PER execute the confidential state transition in sub-seconds. Public Solscan view: 0 bytes leaked.</div>
                        </div>
                        <div className="how-step reveal" style={{ transitionDelay: '0.5s' }}>
                            <div className="how-num serif">04</div>
                            <div className="how-title">Direct settlement & audit keys</div>
                            <div className="how-desc">Off-ramp triggers dispatch local fiat directly to contractors while auditors receive 24-hour cryptographic viewing keys.</div>
                        </div>
                    </div>
                </section>
            </div>

            {/* ─── COMPARISON ────────────────────────────────────────── */}
            <section id="compare">
                <div className="section-eyebrow reveal">Compare</div>
                <h2 className="section-h2 serif reveal" style={{ transitionDelay: '0.1s' }}>Aegis vs. standard multisigs.</h2>
                <p className="section-sub reveal" style={{ transitionDelay: '0.2s' }}>
                    Standard treasury tools broadcast compensation on-chain. Aegis Ledger provides the only end-to-end confidential operations layer with emerging-market settlement.
                </p>
                <div className="comp-table-wrap reveal" style={{ transitionDelay: '0.3s' }}>
                    <table className="comp-table">
                        <thead>
                            <tr>
                                <th style={{ width: '220px' }}>Feature</th>
                                <th className="aegis-col" style={{ width: '160px' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <img src="/logo.svg" alt="Aegis Logo" style={{ width: '16px', height: '16px', borderRadius: '4px', display: 'inline-block' }} />
                                        Aegis Ledger
                                    </span>
                                </th>
                                <th>Gnosis Safe</th>
                                <th>Squads</th>
                                <th>Traditional Mixers</th>
                                <th>Raw multisig</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="feat-label">Shielded on-chain amounts</td>
                                <td className="aegis-col"><span className="check">✓</span> Always</td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="check">✓</span></td>
                                <td><span className="cross">✗</span></td>
                            </tr>
                            <tr>
                                <td className="feat-label">Emerging market off-ramps</td>
                                <td className="aegis-col"><span className="check">✓</span> NGN & KES</td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                            </tr>
                            <tr>
                                <td className="feat-label">Amount-clustering defense</td>
                                <td className="aegis-col"><span className="check">✓</span> Uniform notes</td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                            </tr>
                            <tr>
                                <td className="feat-label">Sub-50ms batch execution</td>
                                <td className="aegis-col"><span className="check">✓</span> MagicBlock TEE</td>
                                <td><span className="check">✓</span> (Public)</td>
                                <td><span className="check">✓</span> (Public)</td>
                                <td><span className="cross">✗</span> 30s+ WASM</td>
                                <td><span className="cross">✗</span> Manual</td>
                            </tr>
                            <tr>
                                <td className="feat-label">Cryptographic audit access</td>
                                <td className="aegis-col"><span className="check">✓</span> Viewing keys</td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                            </tr>
                            <tr>
                                <td className="feat-label">Non-custodial execution</td>
                                <td className="aegis-col"><span className="check">✓</span> 100%</td>
                                <td><span className="check">✓</span></td>
                                <td><span className="check">✓</span></td>
                                <td><span className="check">✓</span></td>
                                <td><span className="check">✓</span></td>
                            </tr>
                            <tr>
                                <td className="feat-label">Batch fee</td>
                                <td className="aegis-col">&lt; 0.00005 SOL</td>
                                <td>$2–15 (Gas)</td>
                                <td>Free*</td>
                                <td>High fee</td>
                                <td>Manual</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ─── CTA ───────────────────────────────────────────────── */}
            <div className="cta-section">
                <h2 className="serif reveal">Stop telegraphing salaries.<br /><em>Start shielding.</em></h2>
                <p className="reveal" style={{ transitionDelay: '0.1s' }}>Built for the Solana Colosseum World's Fair · Superteam Nigeria Track · Powered by MagicBlock PER</p>
                <Link href="/dashboard" className="btn-white reveal" style={{ textDecoration: 'none', display: 'inline-block', transitionDelay: '0.2s' }}>
                    Launch Payroll Terminal →
                </Link>
            </div>

            {/* ─── FOOTER ────────────────────────────────────────────── */}
            <footer>
                <div className="footer-brand">
                    <img src="/logo.svg" alt="Aegis Logo" className="footer-mark" style={{ border: 'none', padding: 0 }} />
                    <span className="footer-name">Aegis Ledger</span>
                </div>
                <div className="footer-links">
                    <a href="https://x.com/aegis_ledger" target="_blank" rel="noopener noreferrer">X (Twitter)</a>
                    <a href="https://github.com/Olalolo22/aegis-ledger" target="_blank" rel="noopener noreferrer">GitHub</a>
                    <a href="https://superteam.fun/earn/listing/colosseum-crypto-worlds-fair-hackathon-superteam-nigeria-track" target="_blank" rel="noopener noreferrer">Superteam NG Track</a>
                    <a href="#how">Architecture</a>
                </div>
                <span className="footer-copy">© 2026 Aegis Ledger · Colosseum Hackathon & Superteam Nigeria</span>
            </footer>
        </div>
    );
}
