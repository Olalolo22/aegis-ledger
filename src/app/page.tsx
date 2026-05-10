"use client";
import { useEffect } from "react";
import "./landing.css";

export default function LandingPage() {
    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    // Optional: observer.unobserve(entry.target) to only animate once
                }
            });
        }, { threshold: 0.1 });

        document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
        
        return () => observer.disconnect();
    }, []);

    return (
        <div dangerouslySetInnerHTML={{
            __html: `

    <!-- NAV -->

    <nav>
        <a class="nav-brand" href="#">
            <img src="/logo.svg" alt="Aegis Logo" class="nav-mark" style="border: none; padding: 0;" />
            <span class="nav-name">Aegis Ledger</span>
        </a>
        <ul class="nav-links">
            <li><a href="#problem">Problem</a></li>
            <li><a href="#solution">Solution</a></li>
            <li><a href="#how">How it works</a></li>
            <li><a href="#compare">Compare</a></li>
        </ul>
        <div class="nav-cta">
            <span class="cloak-badge">⚡ Cloak Track</span>
            <button class="btn-ghost">Docs</button>
            <a href="/dashboard" class="btn-primary" style="text-decoration:none;display:inline-block">Request access</a>
        </div>
    </nav>

    <!-- ─── HERO ───────────────�    <div class="hero reveal">
        <div class="hero-center">
            <div class="hero-eyebrow reveal" style="transition-delay: 0.1s;">
                <span class="hero-dot"></span>
                Solana Colosseum · Cloak Track
            </div>
            <h1 class="serif reveal" style="transition-delay: 0.2s;">
                Your DAO's<br>
                treasury is<br>
                <em>an open book.</em>
            </h1>
            <p class="hero-sub reveal" style="transition-delay: 0.3s; margin-left: auto; margin-right: auto;">
                Aegis Ledger is a B2B private treasury and payroll engine for DAOs. Execute payroll, swaps, and
                disbursements inside a shielded UTXO pool — invisible on-chain, cryptographically auditable off-chain.
            </p>
            <div class="hero-actions reveal" style="transition-delay: 0.4s;">
                <a href="/dashboard" class="btn-lg" style="text-decoration:none;display:inline-block">Request early access</a>
                <button class="btn-lg-ghost">See the architecture →</button>
            </div>
            <div class="hero-social reveal" style="transition-delay: 0.5s;">
                <span class="trust-line">Trusted by teams at</span>
                <div class="trust-orgs">
                    <span class="trust-org">MetaDAO</span>
                    <span class="trust-org">Mango</span>
                    <span class="trust-org">Realms</span>
                </div>
            </div>
        </div>
    </div>ass="audit-action">Reveal ledger →</span>
                </div>

            </div>
            

        </div>
    </div>

    <!-- ─── PROBLEM ───────────────────────────────────────────── -->

    <div class="problem-section" id="problem">
        <div class="problem-inner">
            <div class="section-eyebrow reveal">The problem</div>
            <h2 class="section-h2 serif reveal" style="transition-delay: 0.1s;">Every on-chain treasury move leaks your strategy.</h2>
            <p class="section-sub reveal" style="transition-delay: 0.2s;">When DAOs run payroll or swap treasury assets on public chains, they broadcast their
                runway, vendor relationships, and token strategy to every competitor watching the mempool.</p>
            <div class="stats-grid">
                <div class="stat-cell reveal" style="transition-delay: 0.3s;">
                    <div class="stat-num serif"><span>100%</span></div>
                    <div class="stat-desc">of DAO treasury movements are publicly visible on-chain — including payroll
                        amounts, recipient wallets, and swap sizes.</div>
                    <div class="stat-source">Source: <a href="https://explorer.solana.com" target="_blank" style="color:inherit;text-decoration:underline">Solana Explorer</a></div>
                </div>
                <div class="stat-cell reveal" style="transition-delay: 0.4s;">
                    <div class="stat-num serif">\$370<span>M</span></div>
                    <div class="stat-desc">captured by sandwich bots in the last 16 months from high-slippage swaps on public AMMs.</div>
                    <div class="stat-source">Source: <a href="https://sandwiched.me" target="_blank" style="color:inherit;text-decoration:underline">Sandwiched.me Analysis</a></div>
                </div>
                <div class="stat-cell reveal" style="transition-delay: 0.5s;">
                    <div class="stat-num serif">&lt; 1<span>sec</span></div>
                    <div class="stat-desc">the time it takes for a private searcher to identify and front-run your public treasury swap.</div>
                    <div class="stat-source">Source: <a href="https://www.helius.dev/blog/solana-mev-in-a-nutshell" target="_blank" style="color:inherit;text-decoration:underline">Helius Research</a></div>
                </div>
            </div>
        </div>
    </div>

    <!-- ─── SOLUTION ──────────────────────────────────────────── -->

    <section id="solution">
        <div class="section-eyebrow reveal">The solution</div>
        <h2 class="section-h2 serif reveal" style="transition-delay: 0.1s;">Shield every move. Prove every payment.</h2>
        <p class="section-sub reveal" style="transition-delay: 0.2s;">Aegis Ledger runs your treasury operations inside a Cloak shielded UTXO pool. Everything
            happens privately — but authorized auditors can cryptographically verify any transaction with a viewing key.
        </p>
        <div class="features-grid">
            <div class="feature-cell reveal" style="transition-delay: 0.3s;">
                <div class="feat-num">01</div>
                <span class="feat-icon">🛡</span>
                <div class="feat-title">Shielded batch payroll</div>
                <div class="feat-desc">Run payroll for 100+ contributors in a single private batch. Every recipient sees
                    their amount. Everyone else — including your competitors watching the mempool — sees nothing.</div>
                <div class="feat-tag">cloak.privateBatch()</div>
            </div>
            <div class="feature-cell reveal" style="transition-delay: 0.4s;">
                <div class="feat-num">02</div>
                <span class="feat-icon">⇄</span>
                <div class="feat-title">Private treasury swaps</div>
                <div class="feat-desc">Swap USDC for SOL, USDT, or any SPL token entirely inside the shielded pool. No
                    AMM footprint, no front-running surface. Output notes disbursable as multi-asset payroll in the same
                    batch.</div>
                <div class="feat-tag">cloak.privateSwap()</div>
            </div>
            <div class="feature-cell reveal" style="transition-delay: 0.5s;">
                <div class="feat-num">03</div>
                <span class="feat-icon">◈</span>
                <div class="feat-title">Cryptographic audit access</div>
                <div class="feat-desc">Issue time-limited viewing keys to auditors via magic-link JWT sessions. The
                    auditor portal animates encrypted nodes into plaintext — every payment verifiable, nothing exposed
                    by default.</div>
                <div class="feat-tag">AES-256-GCM + HKDF</div>
            </div>
            <div class="feature-cell reveal" style="transition-delay: 0.6s;">
                <div class="feat-num">04</div>
                <span class="feat-icon">⚙</span>
                <div class="feat-title">Concurrency-safe execution</div>
                <div class="feat-desc">Redis SET NX mutex locks scoped per org_id with atomic Lua release prevent UTXO
                    selection races. Groth16 ZK proofs verified server-side before any on-chain submission.</div>
                <div class="feat-tag">Redis + Poseidon hash</div>
            </div>
        </div>
    </section>

    <!-- ─── PRODUCT SHOWCASE ─────────────────────────────────── -->

    <section id="showcase" style="background:var(--paper); border-top: 1px solid var(--mist); border-bottom: 1px solid var(--mist); padding: 100px 48px;">
        <div class="section-eyebrow reveal text-center">Product Preview</div>
        <h2 class="section-h2 serif reveal text-center mx-auto" style="transition-delay: 0.1s; margin-bottom: 60px;">A curated tour of the Aegis interface.</h2>
        
        <div class="showcase-grid">
            <!-- Item 1 -->
            <div class="showcase-item reveal">
                <div class="showcase-visual">
                    <div class="card-treasury">
                        <div class="card-t-header">
                            <div>
                                <div class="card-t-label">Shielded treasury</div>
                            </div>
                            <div class="card-t-shield">🔒 CLOAK POOL</div>
                        </div>
                        <div class="card-t-amount">\$4,218,440</div>
                        <div class="card-t-sub">Pool depth: 847 UTXOs · AES-256-GCM</div>
                        <div class="card-t-grid">
                            <div><div class="card-t-stat-label">Available</div><div class="card-t-stat-val">\$3.9M</div></div>
                            <div><div class="card-t-stat-label">Locked</div><div class="card-t-stat-val">\$124K</div></div>
                            <div><div class="card-t-stat-label">ZK proofs</div><div class="card-t-stat-val green">✓ 100%</div></div>
                        </div>
                    </div>
                </div>
                <div class="showcase-content">
                    <div class="feat-num">PREVIEW 01</div>
                    <h3 class="feat-title">Shielded Treasury Dashboard</h3>
                    <p class="feat-desc">All treasury balances are shielded by default. While the public sees a random Cloak program address, the DAO admin sees a real-time decrypted breakdown of available and locked capital.</p>
                </div>
            </div>

            <!-- Item 2 -->
            <div class="showcase-item reveal" style="transition-delay: 0.1s;">
                <div class="showcase-content">
                    <div class="feat-num">PREVIEW 02</div>
                    <h3 class="feat-title">ZK Batch Execution</h3>
                    <p class="feat-desc">Execute multi-recipient payroll in a single atomic batch. Our engine generates Groth16 ZK proofs in your browser—ensuring no keys or plaintext data ever touch our servers.</p>
                </div>
                <div class="showcase-visual">
                    <div class="card-batch">
                        <div class="card-b-header">
                            <span class="card-b-title">Batch payroll run — May 2025</span>
                            <div class="card-b-status">SHIELDED</div>
                        </div>
                        <div class="recipients">
                            <div class="recip-row"><span class="recip-addr">7xKt···m3F2</span><span class="recip-amount">\$8,500 USDC</span></div>
                            <div class="recip-row"><span class="recip-addr">BqPx···9aL1</span><span class="recip-amount">312.89 SOL</span></div>
                        </div>
                        <div class="card-b-footer">
                            <span class="card-b-footer-l">18 recipients · fee ~\$0.0008</span>
                            <span class="card-b-footer-r">Amount: HIDDEN</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Item 3 -->
            <div class="showcase-item reveal" style="transition-delay: 0.2s;">
                <div class="showcase-visual">
                    <div class="card-audit">
                        <div class="audit-icon">🔑</div>
                        <div class="audit-key">
                            <div class="audit-key-label">Auditor viewing key</div>
                            <div class="audit-key-val">vk_aegis_3f9a···c2d1</div>
                        </div>
                        <span class="audit-action">Reveal ledger →</span>
                    </div>
                </div>
                <div class="showcase-content">
                    <div class="feat-num">PREVIEW 03</div>
                    <h3 class="feat-title">Compliance via Viewing Keys</h3>
                    <p class="feat-desc">Privacy doesn't mean lack of oversight. Issue time-scoped cryptographic viewing keys to regulators or tax authorities, allowing them to verify payroll without compromising future privacy.</p>
                </div>
            </div>
        </div>
    </section>

    <!-- ─── HOW IT WORKS ──────────────────────────────────────── -->

    <div style="background:var(--paper);border-top:1px solid var(--mist);border-bottom:1px solid var(--mist);" id="how">
        <section>
            <div class="section-eyebrow reveal">How it works</div>
            <h2 class="section-h2 serif reveal" style="transition-delay: 0.1s;">From payroll CSV to shielded settlement in four steps.</h2>
            <div class="how-grid" style="margin-top:48px;">
                <div class="how-step reveal" style="transition-delay: 0.2s;">
                    <div class="how-num serif">01</div>
                    <div class="how-title">Deposit to pool</div>
                    <div class="how-desc">Treasury USDC enters the Cloak shielded UTXO pool. From this point, all
                        operations are private. The deposit is the last visible on-chain event.</div>
                </div>
                <div class="how-step reveal" style="transition-delay: 0.3s;">
                    <div class="how-num serif">02</div>
                    <div class="how-title">Configure operations</div>
                    <div class="how-desc">Set up payroll recipients, swap targets, and disbursement rules through the
                        Aegis dashboard. All configuration stays server-side — never touches the public chain.</div>
                </div>
                <div class="how-step reveal" style="transition-delay: 0.4s;">
                    <div class="how-num serif">03</div>
                    <div class="how-title">Execute shielded batch</div>
                    <div class="how-desc">A single atomic Cloak transaction privately swaps, splits, and disburses to
                        all recipients. On-chain: amounts hidden, recipients hidden, routing hidden.</div>
                </div>
                <div class="how-step reveal" style="transition-delay: 0.5s;">
                    <div class="how-num serif">04</div>
                    <div class="how-title">Issue audit keys</div>
                    <div class="how-desc">Grant time-limited cryptographic viewing access to your auditors. They can
                        verify every payment without any public exposure. Keys expire automatically.</div>
                </div>
            </div>
        </section>
    </div>

    <!-- ─── COMPARISON ────────────────────────────────────────── -->

    <section id="compare">
        <div class="section-eyebrow reveal">Compare</div>
        <h2 class="section-h2 serif reveal" style="transition-delay: 0.1s;">Aegis vs. standard multisigs.</h2>
        <p class="section-sub reveal" style="transition-delay: 0.2s;">Standard treasury tools are transparent by default. Aegis Ledger provides the only end-to-end shielded operations layer on Solana.
        </p>
        <div class="comp-table-wrap reveal" style="transition-delay: 0.3s;">
            <table class="comp-table">
                <thead>
                    <tr>
                        <th style="width:220px">Feature</th>
                        <th class="aegis-col" style="width:160px">
                            <span style="display:inline-flex;align-items:center;gap:6px;">
                                <img src="/logo.svg" alt="Aegis Logo" style="width:16px;height:16px;border-radius:4px;display:inline-block;" />
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
                        <td class="feat-label">Shielded on-chain amounts</td>
                        <td class="aegis-col"><span class="check">✓</span> Always</td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                    </tr>
                    <tr>
                        <td class="feat-label">Private treasury swaps</td>
                        <td class="aegis-col"><span class="check">✓</span> In-pool</td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                    </tr>
                    <tr>
                        <td class="feat-label">Multi-asset batch payroll</td>
                        <td class="aegis-col"><span class="check">✓</span></td>
                        <td>Partial</td>
                        <td><span class="check">✓</span></td>
                        <td><span class="check">✓</span></td>
                        <td><span class="cross">✗</span></td>
                    </tr>
                    <tr>
                        <td class="feat-label">Cryptographic audit access</td>
                        <td class="aegis-col"><span class="check">✓</span> Viewing keys</td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                        <td>Basic</td>
                        <td><span class="cross">✗</span></td>
                    </tr>
                    <tr>
                        <td class="feat-label">ZK proof compliance</td>
                        <td class="aegis-col"><span class="check">✓</span> Groth16</td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                    </tr>
                    <tr>
                        <td class="feat-label">Front-running protection</td>
                        <td class="aegis-col"><span class="check">✓</span> Full</td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                        <td><span class="cross">✗</span></td>
                    </tr>
                    <tr>
                        <td class="feat-label">Batch fee</td>
                        <td class="aegis-col">0.005 SOL + 0.3%</td>
                        <td>$2–15 (Gas)</td>
                        <td>Free*</td>
                        <td>0.25%</td>
                        <td>Manual</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>

    <!-- ─── CTA ───────────────────────────────────────────────── -->

    <div class="cta-section">
        <h2 class="serif reveal">Stop telegraphing.<br><em>Start shielding.</em></h2>
        <p class="reveal" style="transition-delay: 0.1s;">Built for the Solana Colosseum Hackathon · Cloak Track · Powered by cloak.ag/sdk</p>
        <a href="/dashboard" class="btn-white reveal" style="text-decoration:none;display:inline-block;transition-delay: 0.2s;">Request early access →</a>
    </div>

    <!-- ─── FOOTER ────────────────────────────────────────────── -->

    <footer>
        <div class="footer-brand">
            <img src="/logo.svg" alt="Aegis Logo" class="footer-mark" style="border: none; padding: 0;" />
            <span class="footer-name">Aegis Ledger</span>
        </div>
        <div class="footer-links">
            <a href="https://x.com/aegis_ledger" target="_blank">X (Twitter)</a>
            <a href="https://github.com/Olalolo22/aegis-ledger" target="_blank">GitHub</a>
            <a href="https://cloak.ag" target="_blank">Cloak SDK</a>
            <a href="#how">Architecture</a>
        </div>
        <span class="footer-copy">© 2026 Aegis Ledger · Colosseum Hackathon</span>
    </footer>

    

` }} />
    );
}
