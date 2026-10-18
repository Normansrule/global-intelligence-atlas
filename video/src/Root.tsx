// SPDX-License-Identifier: AGPL-3.0-only
// Global Intelligence Atlas promo, made programmatically with Remotion (remotion.dev).
import { Composition } from 'remotion';
import { Promo } from './Promo';

export const Root: React.FC = () => (
  <Composition id="GlobalIntelligenceAtlasPromo" component={Promo} durationInFrames={30 * 24} fps={30} width={1920} height={1080} />
);
