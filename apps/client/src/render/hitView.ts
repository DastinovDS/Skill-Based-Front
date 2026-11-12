import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { RenderFrame } from '../net/interpolate.ts';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { arenaSides, fightPlace, placeKey, type FightPlace, type RoundFx } from './fightFx.ts';
import {
  silentParticle,
  silentProgress,
  sinceShare,
  SILENT_SHARE,
  type Contacts,
} from './fightImpact.ts';
import { endShare, hitLandings, roundLayout } from './parryLayout.ts';
import type { Emit } from './particles.ts';
import { FIGHT_FX_STRENGTH, PLATE_FILL, WARN } from './style.ts';

type FightData = RenderFrame['base']['view']['fights'][number];

/** How much a token swells when it is hit, and for how long (a share of a round: 0.25 s of 2 s). */
const PUNCH_SHARE = 0.125;
const PUNCH_AMPLITUDE = 0.22;
/** Where the amber sign of a silent charge sits on a group (world units at 100%). */
const SIGN_OFFSET = { x: 15, y: 13 } as const;
const SIGN_SCALE = 1.3;
const MAX_SIGNS = 16;

/** A token that swells for a moment: where it stands and by how much. */
export interface Punch {
  readonly at: Point;
  readonly scale: number;
}

/**
 * What a fight does on the map besides its arena and its shots (the Parry arcs of `ParryView`, #856):
 * the token that was hit swells once as the shot lands, the amber sign of a silent charge stays on its
 * group and a dim dashed ring marks it at each round (DEC-24, F2); no word explains it (the owner's
 * marks on the pop-up catalogue, #765: the sign and the burn show it). No glow and no light (the Engraved style, #829): the wind-up glow and the contact ring of
 * #351 are gone. Pooled objects, drawn only when their state changes.
 *
 * Every effect is a function of the render tick and of fields the server sent (`fight_round`,
 * `FightView`): a paused scene shows a fight in the state of that tick. Nothing is decided here
 * (AGENTS.md 7.1). `destroy()` frees the pools.
 */
export class HitView {
  private readonly layer = new Container({ label: 'fight-hits' });
  private readonly signContext: GraphicsContext;
  private readonly signs: Graphics[] = [];

  constructor(
    parent: Container,
    private readonly map: MapFile,
    private readonly me: PlayerId,
    private readonly radiusOf: (node: number) => number,
  ) {
    // The amber crossed disc of the chips of the arena, for the group on the map.
    this.signContext = new GraphicsContext()
      .circle(0, 0, 4.6)
      .fill(PLATE_FILL)
      .stroke({ width: 1.5, color: WARN })
      .moveTo(-3, 3)
      .lineTo(3, -3)
      .stroke({ width: 1.5, color: WARN });
    parent.addChild(this.layer);
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
    for (const fight of frame.base.view.fights) {
      const place = fightPlace(this.map, fight.node, fight.edge, fight.point, this.radiusOf);
      if (place === undefined) continue;
      live.set(placeKey(place), { fight, place });
      const contacts = contactsOf(place);
      const sides = arenaSides(fight, frame.groups, this.me);
      for (const side of ['own', 'enemy'] as const) {
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
    // The rounds that are still playing: the swell of a token hit, and the ring of a silent charge.
    const round = Math.max(1, roundTicks);
    for (const fx of rounds) {
      const age = tick - fx.tick;
      const layout = roundLayout(fx, this.me);
      if (age < 0 || age > Math.max(endShare(layout), SILENT_SHARE) * round) continue;
      const contacts = contactsOf(fx.place);
      for (const hit of hitLandings(layout)) {
        const p = sinceShare(age, hit.at, PUNCH_SHARE, roundTicks);
        if (p === null) continue;
        punches.push({
          at: contacts[hit.side === 'own' ? 'enemy' : 'own'],
          scale: 1 + PUNCH_AMPLITUDE * strength * Math.sin(Math.PI * p),
        });
      }
      const entry = live.get(placeKey(fx.place));
      if (entry === undefined) continue;
      const sides = arenaSides(entry.fight, frame.groups, this.me);
      const q = silentProgress(age, roundTicks);
      if (q === null) continue;
      for (const side of ['own', 'enemy'] as const) {
        if (sides[side].mute <= 0 || sides[side].charged <= 0) continue;
        silentParticle(emit, contacts[side], q, scale);
      }
    }
    for (let i = signs; i < this.signs.length; i++) {
      const sign = this.signs[i];
      if (sign !== undefined) sign.visible = false;
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

  destroy(): void {
    this.layer.destroy({ children: true });
    this.signContext.destroy();
  }
}
