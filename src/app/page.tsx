"use client";
import { useEffect } from "react";
import "./landing.css";

export default function LandingPage() {
    useEffect(() => {
        (window as any).selectSDK = function (id: string) {
            ['a', 'b', 'c'].forEach(k => document.getElementById('sdk-' + k)?.classList.remove('selected'));
            document.getElementById('sdk-' + id)?.classList.add('selected');
        };
    }, []);

    return (
        <div dangerouslySetInnerHTML={{
            __html: `

    <!-- NAV -->

    <nav>
        <a class="nav-brand" href="#">
            <div class="nav-mark">Æ</div>
            <span class="nav-name">Aegis Ledger</span>
        </a>
        <ul class="nav-links">
            <li><a href="#problem">Problem</a></li>
            <li><a href="#solution">Solution</a></li>
            <li><a href="#how">How it works</a></li>
            <li><a href="#compare">Compare</a></li>
            <li><a href="#sdk">SDK options</a></li>
        </ul>
        <div class="nav-cta">
            <span class="cloak-badge">⚡ Cloak Track</span>
            <button class="btn-ghost">Docs</button>
            <a href="/dashboard" class="btn-primary" style="text-decoration:none;display:inline-block">Request access</a>
        </div>
    </nav>

    <!-- ─── HERO ─────────────────────────────────────────────── -->

    <div class="hero">
        <div class="hero-left">
            <div class="hero-eyebrow">
                <span class="hero-dot"></span>
                Solana Colosseum · Cloak Track
            </div>
            <h1 class="serif">
                Your DAO's<br>
                treasury is<br>
                <em>an open book.</em>
            </h1>
            <p class="hero-sub">
                Aegis Ledger is a B2B private treasury and payroll engine for DAOs. Execute payroll, swaps, and
                disbursements inside a shielded UTXO pool — invisible on-chain, cryptographically auditable off-chain.
            </p>
            <div class="hero-actions">
                <a href="/dashboard" class="btn-lg" style="text-decoration:none;display:inline-block">Request early access</a>
                <button class="btn-lg-ghost">See the architecture →</button>
            </div>
            <div class="hero-social">
                <span class="trust-line">Trusted by teams at</span>
                <div class="trust-orgs">
                    <span class="trust-org">MetaDAO</span>
                    <span class="trust-org">Mango</span>
                    <span class="trust-org">Realms</span>
                </div>
            </div>
        </div>

        <div class="hero-mockup">
            <div class="mockup-stack">

                
                <!-- Treasury Card -->
                <div class="card-treasury">
                    <div class="card-t-header">
                        <div>
                            <div class="card-t-label">Shielded treasury</div>
                        </div>
                        <div class="card-t-shield">
                            🔒 CLOAK POOL
                        </div>
                    </div>
                    <div class="card-t-amount">\$4,218,440</div>
                    <div class="card-t-sub">Pool depth: 847 UTXOs · AES-256-GCM encrypted</div>
                    <div class="card-t-grid">
                        <div>
                            <div class="card-t-stat-label">Available</div>
                            <div class="card-t-stat-val">\$3.9M</div>
                        </div>
                        <div>
                            <div class="card-t-stat-label">Locked (payroll)</div>
                            <div class="card-t-stat-val">\$124K</div>
                        </div>
                        <div>
                            <div class="card-t-stat-label">ZK proofs</div>
                            <div class="card-t-stat-val green">✓ 100%</div>
                        </div>
                    </div>
                </div>

                <!-- Batch Run Card -->
                <div class="card-batch">
                    <div class="card-b-header">
                        <span class="card-b-title">Batch payroll run — May 2025</span>
                        <div class="card-b-status">
                            <span
                                style="width:5px;height:5px;border-radius:50%;background:currentColor;display:inline-block"></span>
                            SHIELDED
                        </div>
                    </div>
                    <div class="recipients">
                        <div class="recip-row">
                            <span class="recip-addr">7xKt···m3F2</span>
                            <span><span class="recip-amount">\$8,500</span><span class="recip-token">USDC</span></span>
                        </div>
                        <div class="recip-row">
                            <span class="recip-addr">BqPx···9aL1</span>
                            <span><span class="recip-amount">312.89</span><span class="recip-token">SOL</span></span>
                        </div>
                        <div class="recip-row">
                            <span class="recip-addr">Cm3R···vT5N</span>
                            <span><span class="recip-amount">\$9,800</span><span class="recip-token">USDT</span></span>
                        </div>
                    </div>
                    <div class="card-b-footer">
                        <span class="card-b-footer-l">18 recipients · batch fee ~\$0.0008</span>
                        <span class="card-b-footer-r">On-chain amount: HIDDEN</span>
                    </div>
                </div>

                <!-- Audit key -->
                <div class="card-audit">
                    <div class="audit-icon">🔑</div>
                    <div class="audit-key">
                        <div class="audit-key-label">Auditor viewing key</div>
                        <div class="audit-key-val">vk_aegis_3f9a···c2d1</div>
                    </div>
                    <span class="audit-action">Reveal ledger →</span>
                </div>

            </div>
            

        </div>
    </div>

    <!-- ─── PROBLEM ───────────────────────────────────────────── -->

    <div class="problem-section" id="problem">
        <div class="problem-inner">
            <div class="section-eyebrow">The problem</div>
            <h2 class="section-h2 serif">Every on-chain treasury move leaks your strategy.</h2>
            <p class="section-sub">When DAOs run payroll or swap treasury assets on public chains, they broadcast their
                runway, vendor relationships, and token strategy to every competitor watching the mempool.</p>
            <div class="stats-grid">
                <div class="stat-cell">
                    <div class="stat-num serif"><span>100%</span></div>
                    <div class="stat-desc">of DAO treasury movements are publicly visible on-chain — including payroll
                        amounts, recipient wallets, and swap sizes.</div>
                    <div class="stat-source">Source: Solana Explorer, any block</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-num serif">\$47<span>M</span></div>
                    <div class="stat-desc">lost by DAOs in 2024 to front-running and MEV on treasury swaps made through
                        public AMMs.</div>
                    <div class="stat-source">Source: Chainalysis MEV report</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-num serif">6<span>hrs</span></div>
                    <div class="stat-desc">median time for competitor DAOs to react to a large treasury move, using
                        on-chain analytics to front-run governance decisions.</div>
                    <div class="stat-source">Source: Nansen DAO tracker</div>
                </div>
            </div>
        </div>
    </div>

    <!-- ─── SOLUTION ──────────────────────────────────────────── -->

    <section id="solution">
        <div class="section-eyebrow">The solution</div>
        <h2 class="section-h2 serif">Shield every move. Prove every payment.</h2>
        <p class="section-sub">Aegis Ledger runs your treasury operations inside a Cloak shielded UTXO pool. Everything
            happens privately — but authorized auditors can cryptographically verify any transaction with a viewing key.
        </p>
        <div class="features-grid">
            <div class="feature-cell">
                <div class="feat-num">01</div>
                <span class="feat-icon">🛡</span>
                <div class="feat-title">Shielded batch payroll</div>
                <div class="feat-desc">Run payroll for 100+ contributors in a single private batch. Every recipient sees
                    their amount. Everyone else — including your competitors watching the mempool — sees nothing.</div>
                <div class="feat-tag">cloak.privateBatch()</div>
            </div>
            <div class="feature-cell">
                <div class="feat-num">02</div>
                <span class="feat-icon">⇄</span>
                <div class="feat-title">Private treasury swaps</div>
                <div class="feat-desc">Swap USDC for SOL, USDT, or any SPL token entirely inside the shielded pool. No
                    AMM footprint, no front-running surface. Output notes disbursable as multi-asset payroll in the same
                    batch.</div>
                <div class="feat-tag">cloak.privateSwap()</div>
            </div>
            <div class="feature-cell">
                <div class="feat-num">03</div>
                <span class="feat-icon">◈</span>
                <div class="feat-title">Cryptographic audit access</div>
                <div class="feat-desc">Issue time-limited viewing keys to auditors via magic-link JWT sessions. The
                    auditor portal animates encrypted nodes into plaintext — every payment verifiable, nothing exposed
                    by default.</div>
                <div class="feat-tag">AES-256-GCM + HKDF</div>
            </div>
            <div class="feature-cell">
                <div class="feat-num">04</div>
                <span class="feat-icon">⚙</span>
                <div class="feat-title">Concurrency-safe execution</div>
                <div class="feat-desc">Redis SET NX mutex locks scoped per org_id with atomic Lua release prevent UTXO
                    selection races. Groth16 ZK proofs verified server-side before any on-chain submission.</div>
                <div class="feat-tag">Redis + Poseidon hash</div>
            </div>
        </div>
    </section>

    <!-- ─── HOW IT WORKS ──────────────────────────────────────── -->

    <div style="background:var(--paper);border-top:1px solid var(--mist);border-bottom:1px solid var(--mist);" id="how">
        <section>
            <div class="section-eyebrow">How it works</div>
            <h2 class="section-h2 serif">From payroll CSV to shielded settlement in four steps.</h2>
            <div class="how-grid" style="margin-top:48px;">
                <div class="how-step">
                    <div class="how-num serif">01</div>
                    <div class="how-title">Deposit to pool</div>
                    <div class="how-desc">Treasury USDC enters the Cloak shielded UTXO pool. From this point, all
                        operations are private. The deposit is the last visible on-chain event.</div>
                </div>
                <div class="how-step">
                    <div class="how-num serif">02</div>
                    <div class="how-title">Configure operations</div>
                    <div class="how-desc">Set up payroll recipients, swap targets, and disbursement rules through the
                        Aegis dashboard. All configuration stays server-side — never touches the public chain.</div>
                </div>
                <div class="how-step">
                    <div class="how-num serif">03</div>
                    <div class="how-title">Execute shielded batch</div>
                    <div class="how-desc">A single atomic Cloak transaction privately swaps, splits, and disburses to
                        all recipients. On-chain: amounts hidden, recipients hidden, routing hidden.</div>
                </div>
                <div class="how-step">
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
        <div class="section-eyebrow">Compare</div>
        <h2 class="section-h2 serif">Aegis vs. the alternatives.</h2>
        <p class="section-sub">Every other DAO treasury tool exposes your strategy. Aegis is the only one that doesn't.
        </p>
        <div class="comp-table-wrap">
            <table class="comp-table">
                <thead>
                    <tr>
                        <th style="width:220px">Feature</th>
                        <th class="aegis-col" style="width:160px">
                            <span style="display:inline-flex;align-items:center;gap:6px;">
                                <span
                                    style="width:16px;height:16px;background:var(--ink);border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:9px;color:white;">Æ</span>
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
                        <td class="aegis-col">~\$0.0008</td>
                        <td>\$2–15</td>
                        <td>0.1%</td>
                        <td>0.25%</td>
                        <td>Manual</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>

    <!-- ─── SDK DECISION ──────────────────────────────────────── -->

    <div style="background:var(--paper);border-top:1px solid var(--mist);border-bottom:1px solid var(--mist);" id="sdk">
        <section>
            <div class="section-eyebrow">SDK integration decision</div>
            <h2 class="section-h2 serif">Three remaining Cloak features. One build slot.</h2>
            <p class="section-sub">We have bandwidth for one or two more Cloak SDK integrations. Click each to see the
                evaluation across real-world utility, hackathon impact, and implementation risk.</p>
            <div class="sdk-grid">

                
                <div class="sdk-card" id="sdk-a" onclick="selectSDK('a')">
                    <div class="sdk-rec-badge">★ Recommended</div>
                    <div class="sdk-letter sdk-la serif">A</div>
                    <div class="sdk-title">Note Scanner</div>
                    <div class="sdk-sub">Employee portal</div>
                    <div class="sdk-desc">Client-side UI where contractors connect their wallet and their browser
                        locally decrypts their payslips using their viewing key. Zero server access, zero data leakage.
                    </div>
                    <div class="sdk-scores">
                        <div class="sdk-score-row">
                            <span class="sdk-score-label">B2B utility</span>
                            <div class="sdk-score-bar">
                                <div class="sdk-score-fill" style="width:100%"></div>
                            </div>
                            <span class="sdk-score-val">5/5</span>
                        </div>
                        <div class="sdk-score-row">
                            <span class="sdk-score-label">Hackathon wow</span>
                            <div class="sdk-score-bar">
                                <div class="sdk-score-fill" style="width:70%"></div>
                            </div>
                            <span class="sdk-score-val">3.5/5</span>
                        </div>
                        <div class="sdk-score-row">
                            <span class="sdk-score-label">Build risk</span>
                            <div class="sdk-score-bar">
                                <div class="sdk-score-fill" style="width:20%;background:var(--emerald)"></div>
                            </div>
                            <span class="sdk-score-val">Low</span>
                        </div>
                    </div>
                    <div class="sdk-verdict">Build this first. Pairs directly with your existing batch disbursement
                        flow. Contractors self-serve with zero backend trust. Highest real-world B2B utility, lowest
                        implementation risk, natural extension of what you've already built.</div>
                </div>

                <div class="sdk-card" id="sdk-b" onclick="selectSDK('b')">
                    <div class="sdk-letter sdk-lb serif">B</div>
                    <div class="sdk-title">Private Withdrawals</div>
                    <div class="sdk-sub">Anonymous off-ramping</div>
                    <div class="sdk-desc">Destroy shielded salary notes and mint SPL tokens to a brand-new, completely
                        unconnected burner wallet — permanently breaking the heuristic chain link between identity and
                        payment.</div>
                    <div class="sdk-scores">
                        <div class="sdk-score-row">
                            <span class="sdk-score-label">B2B utility</span>
                            <div class="sdk-score-bar">
                                <div class="sdk-score-fill" style="width:80%"></div>
                            </div>
                            <span class="sdk-score-val">4/5</span>
                        </div>
                        <div class="sdk-score-row">
                            <span class="sdk-score-label">Hackathon wow</span>
                            <div class="sdk-score-bar">
                                <div class="sdk-score-fill" style="width:100%"></div>
                            </div>
                            <span class="sdk-score-val">5/5</span>
                        </div>
                        <div class="sdk-score-row">
                            <span class="sdk-score-label">Build risk</span>
                            <div class="sdk-score-bar">
                                <div class="sdk-score-fill" style="width:50%;background:var(--amber)"></div>
                            </div>
                            <span class="sdk-score-val">Medium</span>
                        </div>
                    </div>
                    <div class="sdk-verdict">Your hackathon showstopper. Build second if bandwidth allows. The
                        burn-to-mint moment is visually decisive and conceptually airtight. Judges evaluating Cloak
                        track will immediately grasp the privacy guarantee. Extends privateSwap naturally.</div>
                </div>

                <div class="sdk-card" id="sdk-c" onclick="selectSDK('c')">
                    <div class="sdk-letter sdk-lc serif">C</div>
                    <div class="sdk-title">Client-Side ZK Proofs</div>
                    <div class="sdk-sub">WASM Groth16 / Poseidon</div>
                    <div class="sdk-desc">Move Groth16 provers and Poseidon hashing out of Next.js and into browser
                        WASM. The server never sees private inputs. Absolute trustlessness — cryptographic, not
                        organizational.</div>
                    <div class="sdk-scores">
                        <div class="sdk-score-row">
                            <span class="sdk-score-label">B2B utility</span>
                            <div class="sdk-score-bar">
                                <div class="sdk-score-fill" style="width:60%"></div>
                            </div>
                            <span class="sdk-score-val">3/5</span>
                        </div>
                        <div class="sdk-score-row">
                            <span class="sdk-score-label">Hackathon wow</span>
                            <div class="sdk-score-bar">
                                <div class="sdk-score-fill" style="width:90%"></div>
                            </div>
                            <span class="sdk-score-val">4.5/5</span>
                        </div>
                        <div class="sdk-score-row">
                            <span class="sdk-score-label">Build risk</span>
                            <div class="sdk-score-bar">
                                <div class="sdk-score-fill" style="width:90%;background:var(--red)"></div>
                            </div>
                            <span class="sdk-score-val">High</span>
                        </div>
                    </div>
                    <div class="sdk-verdict">Target post-hackathon. Browser WASM Groth16 carries 3–8s proof latency —
                        real UX friction during a live demo. Architecturally groundbreaking but risks demo instability.
                        Ship the architecture diagram instead of the live feature during the judging window.</div>
                </div>

            </div>
            

        </section>
    </div>

    <!-- ─── CTA ───────────────────────────────────────────────── -->

    <div class="cta-section">
        <h2 class="serif">Stop telegraphing.<br><em>Start shielding.</em></h2>
        <p>Built for the Solana Colosseum Hackathon · Cloak Track · Powered by cloak.ag/sdk</p>
        <a href="/dashboard" class="btn-white" style="text-decoration:none;display:inline-block">Request early access →</a>
    </div>

    <!-- ─── FOOTER ────────────────────────────────────────────── -->

    <footer>
        <div class="footer-brand">
            <div class="footer-mark">Æ</div>
            <span class="footer-name">Aegis Ledger</span>
        </div>
        <div class="footer-links">
            <a href="#">Docs</a>
            <a href="#">GitHub</a>
            <a href="#">Cloak SDK</a>
            <a href="#">Architecture</a>
        </div>
        <span class="footer-copy">© 2026 Aegis Ledger · Colosseum Hackathon</span>
    </footer>

    

` }} />
    );
}
