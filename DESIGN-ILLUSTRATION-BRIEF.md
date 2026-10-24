# BLCKSWAN Studio / NEST 0.9.3: Illustration & UI art direction
## A. Four controls: one logical line
- The brand sits above one four-column mobile action row.
- Left to right: connection status / high-risk profile / About / Setup.
- Controls never split characters or hyphenate labels. Keep labels short, expose full meaning through ARIA labels/tooltips, hide mobile peer count.
- Target widths: 280, 320, 360, 393, 412, 560px; maintain keyboard and Android safe areas.
- Do not shrink fonts to illegibility merely to force a row.

## B. About & Wizard editorial voice
- Voice: calm, competent, direct, positive; no comedy about safety that would confuse users.
- Focus on two people and two Android devices, shared channel, QR pairing, private repository, task dependencies and next actions.
- Preserve the concise beta security disclosure: private repository does not imply anonymity and forward secrecy is not established.
- Do not imply two physical devices have passed testing just because a one-device round-trip succeeded.

## C. Original hand-drawn SVG storyboards
All panels depict TWO identifiable human figures and TWO distinct phones. Original spare hand-drawn line illustration influenced by explanatory tech comics, on BLCKSWAN dark mineral/ivory background.

1. nest-comic-about.svg: two users face one another; encrypted envelope connects devices. Animate the envelope arriving ONCE.
2. nest-comic-repo.svg: two users access one locked shared repository. Animate the lock icon settling ONCE.
3. nest-comic-qr.svg: person A displays pairing QR, person B scans. Animate a short scan line TWICE; it is illustrative, not a live scanner or functional QR.
4. nest-comic-verify.svg: both people inspect their phones, twin checkmarks indicate illustrative confirmation. Animate ticks ONCE. This must never imply independent audit.

Motion: no loops; respect prefers-reduced-motion; maintain useful static presentation. No remote fonts, links, image trackers or SVG script.

Signatures, version code, authentication logic and crypto untouched by this visual-only pass. Candidate remains experimental and must go through release security gates separately from debug CI.
