// SPDX-License-Identifier: AGPL-3.0-only
// Each scene is a real screenshot of the site (video/public/*.jpg, produced by tools/screenshots.py),
// slowly zoomed, with a caption that rises in. 24 seconds at 30 fps.
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

const SCENES: { img: string; title: string; sub: string }[] = [
  { img: 'app-daynight.jpg', title: 'A living Earth you can hold', sub: 'Lit by the real Sun, right now' },
  { img: 'app-plates.jpg', title: 'The Ring of Fire', sub: 'Earthquakes and 52 tectonic plates' },
  { img: 'app-orbits.jpg', title: 'Every satellite, in orbit', sub: 'Propagated live in your browser' },
  { img: 'app-infra.jpg', title: 'The world’s plumbing', sub: 'Cables, pipelines and trade routes from World Monitor' },
  { img: 'app-flir.jpg', title: 'Change the optics', sub: 'Night vision, thermal and CRT' },
  { img: 'fluid.jpg', title: 'The maths of the wind', sub: 'A real-time fluid lab' },
  { img: 'learn.jpg', title: 'Learn how the planet works', sub: 'Nine lessons, each one opens on the globe' },
  { img: 'home.jpg', title: 'Global Intelligence Atlas', sub: 'On the web and on your desktop · built on World Monitor' },
];
const PER = 90;

const Scene: React.FC<{ img: string; title: string; sub: string }> = ({ img, title, sub }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame: f - 8, fps, config: { damping: 200 } });
  const fade = interpolate(f, [0, 10, PER - 10, PER], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#081827', opacity: fade }}>
      <Img src={staticFile(img)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${interpolate(f, [0, PER], [1.02, 1.1])})` }} />
      <AbsoluteFill style={{ background: 'linear-gradient(0deg, rgba(8,24,39,.92) 0%, rgba(8,24,39,0) 45%)' }} />
      <div style={{ position: 'absolute', left: 110, bottom: 110, color: '#eef3f6', fontFamily: 'Bricolage Grotesque, Segoe UI, sans-serif', transform: `translateY(${(1 - rise) * 40}px)`, opacity: rise }}>
        <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: -2 }}>{title}</div>
        <div style={{ fontSize: 40, color: '#e3b55b', marginTop: 10 }}>{sub}</div>
      </div>
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => (
  <AbsoluteFill style={{ background: '#081827' }}>
    {SCENES.map((s, i) => (
      <Sequence key={s.img} from={i * PER} durationInFrames={PER}>
        <Scene {...s} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
