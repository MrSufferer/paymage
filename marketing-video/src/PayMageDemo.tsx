import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Img,
  staticFile,
  Easing,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { loadFont } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { Lock, ShieldCheck, Zap, Users, Eye, EyeOff, Check, ArrowRight } from "lucide-react";

const { fontFamily } = loadFont();
const { fontFamily: monoFont } = loadMono();

// ─── PayMage brand palette (matches pitch deck) ───────────────────────────
const C = {
  bg: "#0f1729",
  bgAlt: "#131d33",
  bgCard: "#182240",
  surface: "#1e2a4a",
  border: "rgba(255,255,255,0.08)",
  primary: "#3b82f6",
  primaryDim: "rgba(59,130,246,0.12)",
  accent: "#10b981",
  accentDim: "rgba(16,185,129,0.10)",
  danger: "#ef4444",
  warning: "#f59e0b",
  text: "#f1f5f9",
  textSecondary: "rgba(241,245,249,0.65)",
  textMuted: "rgba(241,245,249,0.4)",
};

const SPRING = {
  smooth: { damping: 200 },
  snappy: { damping: 20, stiffness: 200 },
  heavy: { damping: 15, stiffness: 80, mass: 1.5 },
};

// ─── Shared helpers ──────────────────────────────────────────────────────────
const clamp = { extrapolateRight: "clamp" as const };

function BackgroundGlow({ color = C.primary, opacity = 0.06 }: { color?: string; opacity?: number }) {
  const frame = useCurrentFrame();
  const pulse = Math.sin(frame * 0.015) * 0.5 + 0.5;
  const glowOpacity = interpolate(pulse, [0, 1], [opacity * 0.5, opacity]);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(ellipse at center, ${color}${Math.round(glowOpacity * 255).toString(16).padStart(2, "0")} 0%, transparent 70%)`,
      }}
    />
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 18,
        fontWeight: 500,
        color: C.textMuted,
        letterSpacing: 2,
        textTransform: "uppercase",
        fontFamily,
      }}
    >
      {children}
    </span>
  );
}

// ─── SCENE 1: HOOK (0-4s, 120 frames) ───────────────────────────────────────
const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const metricScale = spring({ frame, fps, config: SPRING.heavy });
  const subProgress = spring({ frame: frame - 20, fps, config: SPRING.smooth });
  const subOpacity = interpolate(subProgress, [0, 1], [0, 1], clamp);
  const subY = interpolate(subProgress, [0, 1], [30, 0], clamp);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, justifyContent: "center", alignItems: "center" }}>
      <BackgroundGlow color={C.accent} opacity={0.08} />
      <div style={{ fontSize: 140, fontWeight: 900, color: C.accent, fontFamily, transform: `scale(${metricScale})`, letterSpacing: -4, textAlign: "center" }}>
        $48,200
      </div>
      <div style={{ fontSize: 44, fontWeight: 700, color: C.text, fontFamily, opacity: subOpacity, transform: `translateY(${subY}px)`, marginTop: 16, textAlign: "center" }}>
        paid on-chain. <span style={{ color: C.accent }}>Zero salaries visible.</span>
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 2: PROBLEM (4-10s, 180 frames) ────────────────────────────────────
const ProblemScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lines = [
    "Every USDC payment broadcasts salary amounts to the world",
    "Competitors reconstruct your entire org chart",
    "Employees' financial data becomes public record",
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, justifyContent: "center", padding: 100 }}>
      <BackgroundGlow color={C.danger} opacity={0.04} />
      <div style={{ position: "relative" }}>
        <Caption>THE PROBLEM</Caption>
        <div style={{ fontSize: 64, fontWeight: 800, color: C.text, fontFamily, marginTop: 16, maxWidth: 1200, lineHeight: 1.15 }}>
          On-chain payroll is a <span style={{ color: C.danger }}>data leak</span>.
        </div>
        <div style={{ width: 64, height: 3, backgroundColor: C.danger, opacity: 0.6, margin: "32px 0" }} />
        {lines.map((line, i) => {
          const progress = spring({ frame: frame - 30 - i * 15, fps, config: SPRING.smooth });
          const opacity = interpolate(progress, [0, 1], [0, 1], clamp);
          const x = interpolate(progress, [0, 1], [-30, 0], clamp);
          return (
            <div
              key={i}
              style={{
                fontSize: 32,
                fontWeight: 400,
                color: C.textSecondary,
                fontFamily,
                padding: "16px 0 16px 32px",
                position: "relative",
                opacity,
                transform: `translateX(${x}px)`,
              }}
            >
              <div style={{ position: "absolute", left: 0, top: "50%", width: 8, height: 8, borderRadius: "50%", backgroundColor: C.danger, transform: "translateY(-50%)" }} />
              {line}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 3: SOLUTION (10-16s, 180 frames) ─────────────────────────────────
const SolutionScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: SPRING.heavy });
  const tagProgress = spring({ frame: frame - 15, fps, config: SPRING.smooth });
  const tagOpacity = interpolate(tagProgress, [0, 1], [0, 1], clamp);
  const tagY = interpolate(tagProgress, [0, 1], [30, 0], clamp);
  const subProgress = spring({ frame: frame - 30, fps, config: SPRING.smooth });
  const subOpacity = interpolate(subProgress, [0, 1], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bgAlt, justifyContent: "center", alignItems: "center" }}>
      <BackgroundGlow color={C.primary} opacity={0.1} />
      <div style={{ transform: `scale(${logoScale})`, marginBottom: 32 }}>
        <Img src={staticFile("paymage-logo.svg")} style={{ height: 140, width: 140 }} />
      </div>
      <div style={{ fontSize: 96, fontWeight: 900, color: C.primary, fontFamily, opacity: tagOpacity, transform: `translateY(${tagY}px)`, letterSpacing: -3 }}>
        PayMage
      </div>
      <div style={{ fontSize: 36, fontWeight: 600, color: C.textSecondary, fontFamily, opacity: subOpacity, marginTop: 20, textAlign: "center", maxWidth: 900 }}>
        ZK proves the payroll math.<br />
        <span style={{ color: C.accent }}>The salaries stay hidden.</span>
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 4: DEMO (16-32s, 480 frames) ─────────────────────────────────────
const DemoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Phase 1 (0-90): dashboard mock slides in
  // Phase 2 (90-210): 3 employee rows stagger in with "hidden" badges
  // Phase 3 (210-330): "Generate Proof" button pulses, proof bar fills
  // Phase 4 (330-420): "Verified ✓" appears, salaries stay hidden
  // Phase 5 (420-480): hold

  const mockProgress = spring({ frame, fps, config: SPRING.smooth });
  const mockX = interpolate(mockProgress, [0, 1], [100, 0], clamp);

  const employees = ["Alice · Engineer", "Bob · Designer", "Carol · PM"];
  const proofProgress = interpolate(frame, [210, 330], [0, 100], clamp);
  const verifiedOpacity = interpolate(frame, [340, 380], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, justifyContent: "center", alignItems: "center" }}>
      <BackgroundGlow color={C.primary} opacity={0.05} />
      <div
        style={{
          transform: `translateX(${mockX}px)`,
          width: 900,
          backgroundColor: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: 40,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.text, fontFamily }}>PayMage Dashboard</div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ padding: "6px 16px", borderRadius: 100, fontSize: 14, fontWeight: 600, backgroundColor: C.accentDim, color: C.accent, fontFamily }}>Freighter · TESTNET</span>
          </div>
        </div>

        {/* Summary card */}
        <div style={{ backgroundColor: C.surface, borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 18, color: C.textMuted, fontFamily }}>Payroll period #7</span>
            <span style={{ fontSize: 18, color: C.accent, fontFamily, fontWeight: 600 }}>pending</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: 14, color: C.textMuted, fontFamily, textTransform: "uppercase", letterSpacing: 1 }}>Total payroll</div>
              <div style={{ fontSize: 40, fontWeight: 900, color: C.text, fontFamily }}>$48,200.00 USDC</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, color: C.textMuted, fontFamily, textTransform: "uppercase", letterSpacing: 1 }}>Individual salaries</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: C.textMuted, fontFamily }}>
                hidden <span style={{ fontSize: 24 }}>🔒</span>
              </div>
            </div>
          </div>
        </div>

        {/* Employee rows */}
        {employees.map((emp, i) => {
          const empProgress = spring({ frame: frame - 90 - i * 15, fps, config: SPRING.smooth });
          const empOpacity = interpolate(empProgress, [0, 1], [0, 1], clamp);
          const empY = interpolate(empProgress, [0, 1], [20, 0], clamp);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: `1px solid ${C.border}`,
                opacity: empOpacity,
                transform: `translateY(${empY}px)`,
              }}
            >
              <span style={{ fontSize: 20, color: C.text, fontFamily }}>{emp}</span>
              <span style={{ fontSize: 16, color: C.textMuted, fontFamily, display: "flex", alignItems: "center", gap: 6 }}>
                <EyeOff size={16} color={C.textMuted} /> hidden
              </span>
            </div>
          );
        })}

        {/* Proof generation bar */}
        {frame > 210 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 16, color: C.primary, fontFamily, fontWeight: 600 }}>Generating Groth16 proof…</span>
              <span style={{ fontSize: 16, color: C.textMuted, fontFamily, fontFamily: monoFont }}>{Math.round(proofProgress)}%</span>
            </div>
            <div style={{ width: "100%", height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.06)" }}>
              <div style={{ height: "100%", borderRadius: 4, backgroundColor: C.primary, width: `${proofProgress}%` }} />
            </div>
          </div>
        )}

        {/* Verified badge */}
        {frame > 340 && (
          <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 12, opacity: verifiedOpacity }}>
            <ShieldCheck size={32} color={C.accent} />
            <span style={{ fontSize: 22, fontWeight: 700, color: C.accent, fontFamily }}>Groth16 verified on-chain</span>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 5: HOW IT WORKS (32-42s, 300 frames) ─────────────────────────────
const HowItWorksScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cards = [
    {
      title: "PayrollBatch",
      label: "EMPLOYER",
      code: "proof = PayrollBatch(levels, n)\n  public: employeeRoot,\n           totalPayrollAmount\n  constraint: Σ salary === total\n  constraint: each in tree",
      color: C.accent,
    },
    {
      title: "PayrollWithdraw",
      label: "EMPLOYEE",
      code: "nullifier = Poseidon2(commit, salt)\nproof = PayrollWithdraw(levels)\n  public: commitmentId,\n           nullifier, salaryAmount\n  contract: check nullifier unused",
      color: C.primary,
    },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: C.bgAlt, justifyContent: "center", padding: 80 }}>
      <BackgroundGlow color={C.primary} opacity={0.04} />
      <div style={{ position: "relative" }}>
        <Caption>HOW IT WORKS</Caption>
        <div style={{ fontSize: 56, fontWeight: 800, color: C.text, fontFamily, marginTop: 12 }}>
          Two circuits. One contract. <span style={{ color: C.accent }}>Zero salary leaks.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginTop: 40 }}>
          {cards.map((card, i) => {
            const progress = spring({ frame: frame - 20 - i * 20, fps, config: SPRING.smooth });
            const opacity = interpolate(progress, [0, 1], [0, 1], clamp);
            const y = interpolate(progress, [0, 1], [30, 0], clamp);
            return (
              <div
                key={i}
                style={{
                  backgroundColor: C.bgCard,
                  border: `1px solid ${C.border}`,
                  borderRadius: 16,
                  padding: 32,
                  opacity,
                  transform: `translateY(${y}px)`,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: card.color, fontFamily, letterSpacing: 2, textTransform: "uppercase" }}>{card.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.text, fontFamily, marginTop: 8 }}>{card.title}</div>
                <pre style={{ fontSize: 16, color: C.textSecondary, fontFamily: monoFont, marginTop: 16, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{card.code}</pre>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 6: WHY STELLAR (42-52s, 300 frames) ──────────────────────────────
const WhyStellarScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const stats = [
    { value: "$836M", label: "Stablecoins on Stellar", desc: "USDC CCTP live May 2026" },
    { value: "1.68M", label: "Daily active accounts", desc: "Real payment network volume" },
    { value: "Protocol 25/26", label: "Native BLS12-381 + Poseidon2", desc: "ZK verification in protocol" },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, justifyContent: "center", padding: 80 }}>
      <BackgroundGlow color={C.primary} opacity={0.06} />
      <div style={{ position: "relative" }}>
        <Caption>WHY STELLAR</Caption>
        <div style={{ fontSize: 56, fontWeight: 800, color: C.text, fontFamily, marginTop: 12, maxWidth: 1000 }}>
          Only Stellar gives us <span style={{ color: C.primary }}>compliance-grade privacy</span>.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24, marginTop: 40 }}>
          {stats.map((stat, i) => {
            const progress = spring({ frame: frame - 20 - i * 15, fps, config: SPRING.smooth });
            const opacity = interpolate(progress, [0, 1], [0, 1], clamp);
            const scale = interpolate(progress, [0, 1], [0.8, 1], clamp);
            return (
              <div
                key={i}
                style={{
                  backgroundColor: C.bgCard,
                  border: `1px solid ${C.border}`,
                  borderRadius: 16,
                  padding: 32,
                  textAlign: "center",
                  opacity,
                  transform: `scale(${scale})`,
                }}
              >
                <div style={{ fontSize: 48, fontWeight: 900, color: C.accent, fontFamily, letterSpacing: -2 }}>{stat.value}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: C.text, fontFamily, marginTop: 12 }}>{stat.label}</div>
                <div style={{ fontSize: 16, color: C.textMuted, fontFamily, marginTop: 8 }}>{stat.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 7: METRICS / TRACTION (52-68s, 480 frames) ──────────────────────
const MetricsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const metrics = [
    { value: "5", label: "Soroban contracts\ndeployed (testnet)" },
    { value: "2", label: "Circom circuits\ncompiled & proving" },
    { value: "14", label: "Dashboard routes\n(payroll, audit, treasury)" },
    { value: "58", label: "Tests passing\n(dashboard + contracts)" },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: C.bgAlt, justifyContent: "center", padding: 80 }}>
      <BackgroundGlow color={C.accent} opacity={0.05} />
      <div style={{ position: "relative" }}>
        <Caption>TRACTION</Caption>
        <div style={{ fontSize: 56, fontWeight: 800, color: C.text, fontFamily, marginTop: 12 }}>
          Built. Deployed. <span style={{ color: C.accent }}>Proving on testnet.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 24, marginTop: 48 }}>
          {metrics.map((m, i) => {
            const progress = spring({ frame: frame - 20 - i * 12, fps, config: SPRING.heavy });
            const opacity = interpolate(progress, [0, 1], [0, 1], clamp);
            const scale = interpolate(progress, [0, 1], [0.5, 1], clamp);
            return (
              <div
                key={i}
                style={{
                  textAlign: "center",
                  opacity,
                  transform: `scale(${scale})`,
                }}
              >
                <div style={{ fontSize: 80, fontWeight: 900, color: C.accent, fontFamily, letterSpacing: -2, lineHeight: 1 }}>{m.value}</div>
                <div style={{ fontSize: 18, color: C.textMuted, fontFamily, marginTop: 12, fontWeight: 500, whiteSpace: "pre-line" }}>{m.label}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 48, flexWrap: "wrap" }}>
          {["PayrollBatch ✓", "PayrollWithdraw ✓", "Groth16 verifier ✓", "Auditor view keys ✓", "ASP membership ✓"].map((badge, i) => {
            const badgeProgress = spring({ frame: frame - 80 - i * 10, fps, config: SPRING.snappy });
            const badgeOpacity = interpolate(badgeProgress, [0, 1], [0, 1], clamp);
            return (
              <span
                key={i}
                style={{
                  padding: "8px 20px",
                  borderRadius: 100,
                  fontSize: 16,
                  fontWeight: 600,
                  backgroundColor: C.primaryDim,
                  color: C.primary,
                  fontFamily,
                  opacity: badgeOpacity,
                }}
              >
                {badge}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── SCENE 8: CTA (68-75s, 210 frames) ──────────────────────────────────────
const CTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoProgress = spring({ frame, fps, config: SPRING.heavy });
  const logoScale = interpolate(logoProgress, [0, 1], [0.5, 1], clamp);
  const tagProgress = spring({ frame: frame - 15, fps, config: SPRING.smooth });
  const tagOpacity = interpolate(tagProgress, [0, 1], [0, 1], clamp);
  const linkProgress = spring({ frame: frame - 30, fps, config: SPRING.smooth });
  const linkOpacity = interpolate(linkProgress, [0, 1], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bgAlt, justifyContent: "center", alignItems: "center", textAlign: "center" }}>
      <BackgroundGlow color={C.primary} opacity={0.08} />
      <div style={{ transform: `scale(${logoScale})`, marginBottom: 24 }}>
        <Img src={staticFile("paymage-logo.svg")} style={{ height: 100, width: 100 }} />
      </div>
      <div style={{ fontSize: 88, fontWeight: 900, color: C.primary, fontFamily, opacity: tagOpacity, letterSpacing: -3 }}>PayMage</div>
      <div style={{ fontSize: 32, fontWeight: 600, color: C.textSecondary, fontFamily, opacity: tagOpacity, marginTop: 12 }}>
        Private payroll for the on-chain economy.
      </div>
      <div style={{ marginTop: 40, opacity: linkOpacity, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 24, color: C.text, fontFamily }}>github.com/paymage/zk-payroll-dashboard</div>
        <div style={{ fontSize: 18, color: C.textMuted, fontFamily, fontFamily: monoFont, marginTop: 8 }}>
          Stellar Testnet · CBN3XSKSAN3TFA7HHLQY3MRVU2WXY5MRY4AKIUDTMGQ2LAVKJUXGAPXU
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── MAIN COMPOSITION ──────────────────────────────────────────────────────
export const PayMageDemo: React.FC = () => {
  return (
    <TransitionSeries>
      {/* Scene 1: Hook (4s) */}
      <TransitionSeries.Sequence durationInFrames={120}>
        <HookScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />

      {/* Scene 2: Problem (6s) */}
      <TransitionSeries.Sequence durationInFrames={180}>
        <ProblemScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />

      {/* Scene 3: Solution (6s) */}
      <TransitionSeries.Sequence durationInFrames={180}>
        <SolutionScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={linearTiming({ durationInFrames: 15 })} />

      {/* Scene 4: Demo (16s) */}
      <TransitionSeries.Sequence durationInFrames={480}>
        <DemoScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />

      {/* Scene 5: How It Works (10s) */}
      <TransitionSeries.Sequence durationInFrames={300}>
        <HowItWorksScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />

      {/* Scene 6: Why Stellar (10s) */}
      <TransitionSeries.Sequence durationInFrames={300}>
        <WhyStellarScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />

      {/* Scene 7: Metrics (16s) */}
      <TransitionSeries.Sequence durationInFrames={480}>
        <MetricsScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />

      {/* Scene 8: CTA (7s) */}
      <TransitionSeries.Sequence durationInFrames={210}>
        <CTAScene />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};