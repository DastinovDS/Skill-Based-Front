import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import { t } from '../i18n/index.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { arenaSides, fightPlace, placeKey, type FightPlace, type RoundFx } from './fightFx.ts';
import {
  ROUND_END_SHARE,
  armed,
  burstProgress,
  contactParticle,
  contactProgress,
  fxSeed,
  impactParticles,
  impactsOf,
  inFirstRound,
  silentParticle,
  silentProgress,
  sinceShare,
  windParticles,
  windProgress,
  CAPTION_SHARE,
  type Contacts,
} from './fightImpact.ts';
import type { Emit } from './particles.ts';
import { BG, FIGHT_FX_STRENGTH, PLATE_FILL, WARN, ownerColor } from './style.ts';

type FightData = RenderFrame['base']['view']['fights'][number];

/** How much a token swells when it is hit, and for how long (a share of a round: 0.25 s of 2 s). */
const PUNCH_SHARE = 0.125;
const PUNCH_AMPLITUDE = 0.22;
/** Where the amber sign of a silent charge sits on a group (world units at 100%). */
const SIGN_OFFSET = { x: 15, y: 13 } as const;
const SIGN_SCALE = 1.3;
/** Where the word "silent" sits under a group. */
const CAPTION_DROP = 31;
const MAX_SIGNS = 16;
const MAX_CAPTIONS = 8;

/** A token that swells for a moment: where it stands and by how much. */
export interface Punch {
  readonly at: Point;
  readonly scale: number;
}

interface Caption {
  readonly text: Text;
}

/**
 * What a fight does on the map besides its arena and its arrows (E3 "Expressive", ui-style 27, 29;
 * #351): the particles (the ring of a contact, the wind-up, hits, shots that cancel, silent charges)
 * go to the `ParticleLayer` through `emit`; here are also the amber sign of a silent charge on its
 * group and the word "silent" of the first round, pooled objects drawn only when their state changes.
 *
 * Every effect is a function of the render tick and of fields the server sent (`fight_round`,
 * `FightView`): a paused scene shows a fight in the state of that tick. Nothing is decided here
 * (AGENTS.md 7.1). `destroy()` frees the pools.
 */
export class HitView {
  private readonly layer = new Container({ label: 'fight-hits' });
  private readonly signContext: GraphicsContext;
  private readonly signs: Graphics[] = [];
  private readonly captions: Caption[] = [];
  private readonly style: TextStyle;
  private readonly colors: { own: number; enemy: number };

  constructor(
    parent: Container,
    private readonly map: MapFile,
    private readonly me: PlayerId,
    private resolution: number,
    private readonly radiusOf: (node: number) => number,
  ) {
    const enemy: PlayerId = me === 0 ? 1 : 0;
    this.colors = { own: ownerColor(me, me), enemy: ownerColor(me, enemy) };
    // The amber crossed disc of the chips of the arena, for the group on the map.
    this.signContext = new GraphicsContext()
      .circle(0, 0, 4.6)
      .fill(PLATE_FILL)
      .stroke({ width: 1.5, color: WARN })
      .moveTo(-3, 3)
      .lineTo(3, -3)
      .stroke({ width: 1.5, color: WARN });
    this.style = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: 12,
      fontWeight: '700',
      fill: WARN,
      stroke: { color: BG, width: 3.5, join: 'round' },
    });
    parent.addChild(this.layer);
  }

  setScreenResolution(resolution: number): void {
    this.resolution = resolution;
    for (const caption of this.captions) caption.text.resolution = resolution;
  }

  /**
   * Draws the effects of the frame into `emit` and returns the tokens that swell now.
   * `scale`: the size of everything on the map (more when zoomed out).
   */
  update(
    emit: Emit,
    frame: RenderFrame,
    rounds: readonly RoundFx[],
    roundTicks: number,
    contactsOf: (place: FightPlace) => Contacts,
    scale: number,
    strength: number = FIGHT_FX_STRENGTH,
  ): Punch[] {
    const tick = frame.tick;
    const punches: Punch[] = [];
    const live = new Map<string, { fight: FightData; place: FightPlace }>();
    let signs = 0;
    let captions = 0;
    for (const fight of frame.base.view.fights) {
      const place = fightPlace(this.map, fight.node, fight.edge, fight.point, this.radiusOf);
      if (place === undefined) continue;
      live.set(placeKey(place), { fight, place });
      const contacts = contactsOf(place);
      const sides = arenaSides(fight, frame.groups, this.me);
      // The ring of a contact, and the wind-up of the sides that can fire in the coming round.
      const q = contactProgress(tick - fight.start_tick, roundTicks);
      if (q !== null) contactParticle(emit, place.at, q, scale);
      const wind = windProgress(fight.next_round_tick, tick, roundTicks);
      for (const side of ['own', 'enemy'] as const) {
        if (wind !== null && armed(sides[side])) {
          windParticles(emit, contacts[side], this.colors[side], wind, scale, strength);
        }
        // The static sign of a silent charge: a charged unit that does not shoot (DEC-24, F2).
        if (sides[side].mute > 0 && sides[side].charged > 0 && signs < MAX_SIGNS) {
          const at = contacts[side];
          const sign = this.sign(signs++);
          sign.position.set(at.x + SIGN_OFFSET.x * scale, at.y + SIGN_OFFSET.y * scale);
          sign.scale.set(SIGN_SCALE * scale);
          sign.visible = true;
        }
      }
    }
    // The rounds that are still playing: the hits, and the ring of a silent charge.
    for (const fx of rounds) {
      const age = tick - fx.tick;
      if (age < 0 || age > ROUND_END_SHARE * roundTicks) continue;
      const contacts = contactsOf(fx.place);
      const seed = fxSeed(fx);
      for (const impact of impactsOf(fx, this.me)) {
        const u = burstProgress(age, impact, roundTicks);
        if (u === null) continue;
        impactParticles(emit, impact, u, {
          contacts,
          colors: this.colors,
          scale,
          strength,
          seed,
        });
        if (impact.victim !== null) {
          const p = sinceShare(age, impact.at, PUNCH_SHARE, roundTicks);
          if (p !== null) {
            punches.push({
              at: contacts[impact.victim],
              scale: 1 + PUNCH_AMPLITUDE * strength * Math.sin(Math.PI * p),
            });
          }
        }
      }
      const entry = live.get(placeKey(fx.place));
      if (entry === undefined) continue;
      const sides = arenaSides(entry.fight, frame.groups, this.me);
      const q = silentProgress(age, roundTicks);
      if (q === null) continue;
      for (const side of ['own', 'enemy'] as const) {
        if (sides[side].mute <= 0 || sides[side].charged <= 0) continue;
        silentParticle(emit, contacts[side], q, scale);
        // The word only in the first round, so that the sign is explained once.
        const c = sinceShare(age, 0, CAPTION_SHARE, roundTicks);
        if (
          c !== null &&
          inFirstRound(entry.fight.start_tick, fx.tick, roundTicks) &&
          captions < MAX_CAPTIONS
        ) {
          const caption = this.caption(captions++);
          const word = t('fight.silent');
          if (caption.text.text !== word) caption.text.text = word;
          caption.text.position.set(contacts[side].x, contacts[side].y + CAPTION_DROP * scale);
          caption.text.scale.set(scale);
          caption.text.alpha = Math.min(1, c / 0.2) * (1 - c * 0.6);
          caption.text.visible = true;
        }
      }
    }
    for (let i = signs; i < this.signs.length; i++) {
      const sign = this.signs[i];
      if (sign !== undefined) sign.visible = false;
    }
    for (let i = captions; i < this.captions.length; i++) {
      const caption = this.captions[i];
      if (caption !== undefined) caption.text.visible = false;
    }
    return punches;
  }

  private sign(index: number): Graphics {
    let sign = this.signs[index];
    if (sign === undefined) {
      sign = this.layer.addChild(new Graphics(this.signContext));
      sign.label = 'silent-sign';
      this.signs.push(sign);
    }
    return sign;
  }

  private caption(index: number): Caption {
    let caption = this.captions[index];
    if (caption === undefined) {
      const text = this.layer.addChild(
        new Text({
          text: '',
          style: this.style,
          anchor: 0.5,
          resolution: this.resolution,
          visible: false,
        }),
      );
      text.label = 'silent-caption';
      caption = { text };
      this.captions.push(caption);
    }
    return caption;
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    this.signContext.destroy();
    this.style.destroy();
  }
}
