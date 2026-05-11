"use client";

import { useEffect } from "react";
import Link from "next/link";
import "./landing.css";

export default function LandingPage() {
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
                    <span className="cloak-badge">⚡ Cloak Track</span>
                    <button className="btn-ghost">Docs</button>
                    <Link href="/dashboard" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
                        Request access
                    </Link>
                </div>
            </nav>

            {/* ─── HERO ─────────────────────────────────────────────── */}
            <div className="hero reveal">
                <div className="hero-left">
                    <div className="hero-eyebrow reveal" style={{ transitionDelay: '0.1s' }}>
                        <span className="hero-dot"></span>
                        Solana Colosseum · Cloak Track
                    </div>
                    <h1 className="serif reveal" style={{ transitionDelay: '0.2s' }}>
                        Your DAO's<br />
                        treasury is<br />
                        <em>an open book.</em>
                    </h1>
                    <p className="hero-sub reveal" style={{ transitionDelay: '0.3s' }}>
                        Aegis Ledger is a B2B private treasury and payroll engine for DAOs. Execute payroll, swaps, and
                        disbursements inside a shielded UTXO pool — invisible on-chain, cryptographically auditable off-chain.
                    </p>
                    <div className="hero-actions reveal" style={{ transitionDelay: '0.4s' }}>
                        <Link href="/dashboard" className="btn-lg" style={{ textDecoration: 'none', display: 'inline-block' }}>
                            Request early access
                        </Link>
                        <button className="btn-lg-ghost">See the architecture →</button>
                    </div>
                    <div className="hero-social reveal" style={{ transitionDelay: '0.5s' }}>
                        <span className="trust-line">Trusted by teams at</span>
                        <div className="trust-orgs">
                            <span className="trust-org">MetaDAO</span>
                            <span className="trust-org">Mango</span>
                            <span className="trust-org">Realms</span>
                        </div>
                    </div>
                </div>

                <div className="hero-mockup reveal" style={{ transitionDelay: '0.4s' }}>
                    <div className="mockup-stack">
                        {/* Treasury Card */}
                        <div className="card-treasury reveal" style={{ transitionDelay: '0.5s' }}>
                            <div className="card-t-header">
                                <div>
                                    <div className="card-t-label">Shielded treasury</div>
                                </div>
                                <div className="card-t-shield">
                                    🔒 CLOAK POOL
                                </div>
                            </div>
                            <div className="card-t-amount">$4,218,440</div>
                            <div className="card-t-sub">Pool depth: 847 UTXOs · AES-256-GCM encrypted</div>
                            <div className="card-t-grid">
                                <div>
                                    <div className="card-t-stat-label">Available</div>
                                    <div className="card-t-stat-val">$3.9M</div>
                                </div>
                                <div>
                                    <div className="card-t-stat-label">Locked (payroll)</div>
                                    <div className="card-t-stat-val">$124K</div>
                                </div>
                                <div>
                                    <div className="card-t-stat-label">ZK proofs</div>
                                    <div className="card-t-stat-val green">✓ 100%</div>
                                </div>
                            </div>
                        </div>

                        {/* Batch Run Card */}
                        <div className="card-batch reveal" style={{ transitionDelay: '0.6s' }}>
                            <div className="card-b-header">
                                <span className="card-b-title">Batch payroll run — May 2025</span>
                                <div className="card-b-status">
                                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}></span>
                                    SHIELDED
                                </div>
                            </div>
                            <div className="recipients">
                                <div className="recip-row">
                                    <span className="recip-addr">7xKt···m3F2</span>
                                    <span><span className="recip-amount">$8,500</span><span className="recip-token">USDC</span></span>
                                </div>
                                <div className="recip-row">
                                    <span className="recip-addr">BqPx···9aL1</span>
                                    <span><span className="recip-amount">312.89</span><span className="recip-token">SOL</span></span>
                                </div>
                                <div className="recip-row">
                                    <span className="recip-addr">Cm3R···vT5N</span>
                                    <span><span className="recip-amount">$9,800</span><span className="recip-token">USDT</span></span>
                                </div>
                            </div>
                            <div className="card-b-footer">
                                <span className="card-b-footer-l">18 recipients · batch fee ~$0.0008</span>
                                <span className="card-b-footer-r">On-chain amount: HIDDEN</span>
                            </div>
                        </div>

                        {/* Audit key */}
                        <div className="card-audit reveal" style={{ transitionDelay: '0.7s' }}>
                            <div className="audit-icon">🔑</div>
                            <div className="audit-key">
                                <div className="audit-key-label">Auditor viewing key</div>
                                <div className="audit-key-val">vk_aegis_3f9a···c2d1</div>
                            </div>
                            <span className="audit-action">Reveal ledger →</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── PROBLEM ───────────────────────────────────────────── */}
            <div className="problem-section" id="problem">
                <div className="problem-inner">
                    <div className="section-eyebrow reveal">The problem</div>
                    <h2 className="section-h2 serif reveal" style={{ transitionDelay: '0.1s' }}>Every on-chain treasury move leaks your strategy.</h2>
                    <p className="section-sub reveal" style={{ transitionDelay: '0.2s' }}>When DAOs run payroll or swap treasury assets on public chains, they broadcast their
                        runway, vendor relationships, and token strategy to every competitor watching the mempool.</p>
                    <div className="stats-grid">
                        <div className="stat-cell reveal" style={{ transitionDelay: '0.3s' }}>
                            <div className="stat-num serif"><span>100%</span></div>
                            <div className="stat-desc">of DAO treasury movements are publicly visible on-chain — including payroll
                                amounts, recipient wallets, and swap sizes.</div>
                            <div className="stat-source">Source: <a href="https://explorer.solana.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Solana Explorer</a></div>
                        </div>
                        <div className="stat-cell reveal" style={{ transitionDelay: '0.4s' }}>
                            <div className="stat-num serif">$370<span>M</span></div>
                            <div className="stat-desc">captured by sandwich bots in the last 16 months from high-slippage swaps on public AMMs.</div>
                            <div className="stat-source">Source: <a href="https://sandwiched.me" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Sandwiched.me Analysis</a></div>
                        </div>
                        <div className="stat-cell reveal" style={{ transitionDelay: '0.5s' }}>
                            <div className="stat-num serif">&lt; 1<span>sec</span></div>
                            <div className="stat-desc">the time it takes for a private searcher to identify and front-run your public treasury swap.</div>
                            <div className="stat-source">Source: <a href="https://www.helius.dev/blog/solana-mev-in-a-nutshell" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Helius Research</a></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── SOLUTION ──────────────────────────────────────────── */}
            <section id="solution">
                <div className="section-eyebrow reveal">The solution</div>
                <h2 className="section-h2 serif reveal" style={{ transitionDelay: '0.1s' }}>Shield every move. Prove every payment.</h2>
                <p className="section-sub reveal" style={{ transitionDelay: '0.2s' }}>Aegis Ledger runs your treasury operations inside a Cloak shielded UTXO pool. Everything
                    happens privately — but authorized auditors can cryptographically verify any transaction with a viewing key.
                </p>
                <div className="features-grid">
                    <div className="feature-cell reveal" style={{ transitionDelay: '0.3s' }}>
                        <div className="feat-num">01</div>
                        <span className="feat-icon">🛡</span>
                        <div className="feat-title">Shielded batch payroll</div>
                        <div className="feat-desc">Run payroll for 100+ contributors in a single private batch. Every recipient sees
                            their amount. Everyone else — including your competitors watching the mempool — sees nothing.</div>
                        <div className="feat-tag">cloak.privateBatch()</div>
                    </div>
                    <div className="feature-cell reveal" style={{ transitionDelay: '0.4s' }}>
                        <div className="feat-num">02</div>
                        <span className="feat-icon">⇄</span>
                        <div className="feat-title">Private treasury swaps</div>
                        <div className="feat-desc">Swap USDC for SOL, USDT, or any SPL token entirely inside the shielded pool. No
                            AMM footprint, no front-running surface. Output notes disbursable as multi-asset payroll in the same
                            batch.</div>
                        <div className="feat-tag">cloak.privateSwap()</div>
                    </div>
                    <div className="feature-cell reveal" style={{ transitionDelay: '0.5s' }}>
                        <div className="feat-num">03</div>
                        <span className="feat-icon">◈</span>
                        <div className="feat-title">Cryptographic audit access</div>
                        <div className="feat-desc">Issue time-limited viewing keys to auditors via magic-link JWT sessions. The
                            auditor portal animates encrypted nodes into plaintext — every payment verifiable, nothing exposed
                            by default.</div>
                        <div className="feat-tag">AES-256-GCM + HKDF</div>
                    </div>
                    <div className="feature-cell reveal" style={{ transitionDelay: '0.6s' }}>
                        <div className="feat-num">04</div>
                        <span className="feat-icon">⚙</span>
                        <div className="feat-title">Concurrency-safe execution</div>
                        <div className="feat-desc">Redis SET NX mutex locks scoped per org_id with atomic Lua release prevent UTXO
                            selection races. Groth16 ZK proofs verified server-side before any on-chain submission.</div>
                        <div className="feat-tag">Redis + Poseidon hash</div>
                    </div>
                </div>
            </section>

            {/* ─── HOW IT WORKS ──────────────────────────────────────── */}
            <div style={{ background: 'var(--paper)', borderTop: '1px solid var(--mist)', borderBottom: '1px solid var(--mist)' }} id="how">
                <section>
                    <div className="section-eyebrow reveal">How it works</div>
                    <h2 className="section-h2 serif reveal" style={{ transitionDelay: '0.1s' }}>From payroll CSV to shielded settlement in four steps.</h2>
                    <div className="how-grid" style={{ marginTop: '48px' }}>
                        <div className="how-step reveal" style={{ transitionDelay: '0.2s' }}>
                            <div className="how-num serif">01</div>
                            <div className="how-title">Deposit to pool</div>
                            <div className="how-desc">Treasury USDC enters the Cloak shielded UTXO pool. From this point, all
                                operations are private. The deposit is the last visible on-chain event.</div>
                        </div>
                        <div className="how-step reveal" style={{ transitionDelay: '0.3s' }}>
                            <div className="how-num serif">02</div>
                            <div className="how-title">Configure operations</div>
                            <div className="how-desc">Set up payroll recipients, swap targets, and disbursement rules through the
                                Aegis dashboard. All configuration stays server-side — never touches the public chain.</div>
                        </div>
                        <div className="how-step reveal" style={{ transitionDelay: '0.4s' }}>
                            <div className="how-num serif">03</div>
                            <div className="how-title">Execute shielded batch</div>
                            <div className="how-desc">A single atomic Cloak transaction privately swaps, splits, and disburses to
                                all recipients. On-chain: amounts hidden, recipients hidden, routing hidden.</div>
                        </div>
                        <div className="how-step reveal" style={{ transitionDelay: '0.5s' }}>
                            <div className="how-num serif">04</div>
                            <div className="how-title">Issue audit keys</div>
                            <div className="how-desc">Grant time-limited cryptographic viewing access to your auditors. They can
                                verify every payment without any public exposure. Keys expire automatically.</div>
                        </div>
                    </div>
                </section>
            </div>

            {/* ─── COMPARISON ────────────────────────────────────────── */}
            <section id="compare">
                <div className="section-eyebrow reveal">Compare</div>
                <h2 className="section-h2 serif reveal" style={{ transitionDelay: '0.1s' }}>Aegis vs. standard multisigs.</h2>
                <p className="section-sub reveal" style={{ transitionDelay: '0.2s' }}>Standard treasury tools are transparent by default. Aegis Ledger provides the only end-to-end shielded operations layer on Solana.
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
                                <th>Parcel</th>
                                <th>Raw multisig</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="feat-label">Shielded on-chain amounts</td>
                                <td className="aegis-col"><span className="check">✓</span> Always</td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                            </tr>
                            <tr>
                                <td className="feat-label">Private treasury swaps</td>
                                <td className="aegis-col"><span className="check">✓</span> In-pool</td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                            </tr>
                            <tr>
                                <td className="feat-label">Multi-asset batch payroll</td>
                                <td className="aegis-col"><span className="check">✓</span></td>
                                <td>Partial</td>
                                <td><span className="check">✓</span></td>
                                <td><span className="check">✓</span></td>
                                <td><span className="cross">✗</span></td>
                            </tr>
                            <tr>
                                <td className="feat-label">Cryptographic audit access</td>
                                <td className="aegis-col"><span className="check">✓</span> Viewing keys</td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td>Basic</td>
                                <td><span className="cross">✗</span></td>
                            </tr>
                            <tr>
                                <td className="feat-label">ZK proof compliance</td>
                                <td className="aegis-col"><span className="check">✓</span> Groth16</td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                            </tr>
                            <tr>
                                <td className="feat-label">Front-running protection</td>
                                <td className="aegis-col"><span className="check">✓</span> Full</td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                                <td><span className="cross">✗</span></td>
                            </tr>
                            <tr>
                                <td className="feat-label">Batch fee</td>
                                <td className="aegis-col">0.005 SOL + 0.3%</td>
                                <td>$2–15 (Gas)</td>
                                <td>Free*</td>
                                <td>0.25%</td>
                                <td>Manual</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ─── CTA ───────────────────────────────────────────────── */}
            <div className="cta-section">
                <h2 className="serif reveal">Stop telegraphing.<br /><em>Start shielding.</em></h2>
                <p className="reveal" style={{ transitionDelay: '0.1s' }}>Built for the Solana Colosseum Hackathon · Cloak Track · Powered by cloak.ag/sdk</p>
                <Link href="/dashboard" className="btn-white reveal" style={{ textDecoration: 'none', display: 'inline-block', transitionDelay: '0.2s' }}>
                    Request early access →
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
                    <a href="https://cloak.ag" target="_blank" rel="noopener noreferrer">Cloak SDK</a>
                    <a href="#how">Architecture</a>
                </div>
                <span className="footer-copy">© 2026 Aegis Ledger · Colosseum Hackathon</span>
            </footer>
        </div>
    );
}
