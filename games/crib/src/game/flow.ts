import type { Sfx } from '../audio/sfx';
import { LEVELS, type LevelDef } from '../config/levels';
import type { MapId } from '../config/maps';
import type { Steer } from '../input/steer';
import { levelUnlocked, persist, starsFor, type SaveData } from '../meta/save';
import type { Decor } from '../render/decor';
import type { Hud } from '../ui/hud';
import type { BuildPanel } from '../ui/buildPanel';
import type { Screens } from '../ui/screens';
import { makeLevel, type Level } from './level';
import type { NightCheckpoint, World } from './world';

export type FlowState = 'menu' | 'levelSelect' | 'day' | 'night' | 'result';

/**
 * Machine à états menu → jour ⇄ nuit → résultat, et SEUL endroit du jeu habilité à
 * écrire la sauvegarde. `World` ne connaît ni les modes ni la méta ; `Screens` et
 * `Hud` ne lisent jamais le save pour décider quoi que ce soit.
 *
 * La règle de partage tient en une phrase : **Flow possède la PHASE, World possède
 * l'HORLOGE DE NUIT.** Le jour n'a délibérément aucune horloge — il dure tant que
 * le joueur n'a pas appuyé sur « Lancer la nuit ». C'est ça, la respiration qui
 * manquait au premier jet.
 *
 * C'est aussi Flow qui arme et désarme les entrées : sans ça le bébé dérive en
 * arrière-plan pendant qu'on lit l'écran de résultat.
 */
export class Flow {
  state: FlowState = 'menu';
  /** Seed de la partie courante — rejouable à l'identique, et lisible par le bot. */
  seed = 0xbebe;
  /** Index 0-based de la nuit en cours ou à venir. */
  nightIndex = 0;
  /** Index 0-based du niveau en cours dans la campagne. */
  levelIdx = 0;
  /** Hook de l'overlay `?debug` : appelé après chaque chargement de niveau. */
  onLevelLoaded: ((level: Level) => void) | null = null;

  private def: LevelDef = LEVELS[0].make();
  /** État du niveau au lancement de la nuit : c'est « Rejouer la nuit ». */
  private checkpoint: NightCheckpoint | null = null;

  constructor(
    private readonly world: World,
    private readonly screens: Screens,
    private readonly hud: Hud,
    private readonly decor: Decor,
    private readonly steer: Steer,
    private readonly save: SaveData,
    private readonly sfx: Sfx,
    private readonly buildPanel: BuildPanel,
  ) {
    this.screens.onPlay = () => this.play();
    this.screens.onMenu = () => this.showMenu();
    this.screens.onSelectLevel = (idx) => this.startCampaignLevel(idx);
    this.screens.onLevelSelect = () => this.showLevelSelect();
    this.screens.onRetryNight = () => this.retryNight();
    this.screens.onToggleMute = () => this.toggleMute();
    this.hud.onRestart = () => this.startCampaignLevel(this.levelIdx, this.seed);
    this.hud.onLaunchNight = () => this.startNight();
    this.world.onNightCleared = (i, sec) => this.onNightCleared(i, sec);
    this.world.onCribFallen = () => this.onDefeat();
    // LE seul chemin d'achat : le bouton du panneau et le bot passent par la même
    // fonction, gardes comprises (jour + à portée + finançable). Pas de second
    // chemin, donc pas de chemin non testé.
    this.buildPanel.onBuy = (slotId, offerId) => {
      if (this.world.buildings.buy(slotId, offerId, this.world.economy, this.world.phase)) {
        this.sfx.pickup();
        this.refreshBuildPanel();
      }
    };
  }

  showMenu(): void {
    this.state = 'menu';
    this.leaveGame();
    this.screens.showMenu(this.save.levels.garden.cleared);
  }

  showLevelSelect(): void {
    this.state = 'levelSelect';
    this.leaveGame();
    this.screens.showLevelSelect(
      LEVELS.map(({ id, make }, i) => {
        const def = make();
        const rec = this.save.levels[id];
        return {
          idx: i,
          name: def.name,
          emoji: def.map.emoji,
          nights: def.nights.length,
          unlocked: levelUnlocked(this.save, id),
          previous: i > 0 ? LEVELS[i - 1].id : null,
          record: rec,
        };
      }),
    );
  }

  /**
   * « Jouer » depuis l'accueil. Tant que le jardin n'est pas terminé, on y va
   * DIRECTEMENT : un écran de sélection à une seule entrée jouable est un obstacle
   * pur, et le premier niveau est le tutoriel.
   */
  private play(): void {
    if (this.save.levels.garden.cleared) this.showLevelSelect();
    else this.startCampaignLevel(0);
  }

  /**
   * Signature STABLE : appelée telle quelle par `tools/verify-crib.mjs`. Le seed est
   * explicite pour que le bot puisse rejouer exactement la même partie — sans ça,
   * une régression d'équilibrage serait indiscernable d'un tirage malheureux.
   *
   * Elle dépose au JOUR 1, arène jouable : contacts, engluement et tir auto tournent
   * déjà, ce qui est la condition pour que le scénario `grip` fonctionne inchangé.
   */
  startLevel(seed?: number): void {
    this.startCampaignLevel(0, seed);
  }

  /**
   * Entrée de campagne. `levelIdx` est CLAMPÉ au déblocage : rien, pas même un
   * appel console, ne doit pouvoir sauter le tutoriel — le grenier à quatre voies
   * donnerait une image fausse du jeu à quelqu'un qui n'a pas vu le jardin.
   */
  startCampaignLevel(levelIdx: number, seed?: number): void {
    let idx = Math.max(0, Math.min(LEVELS.length - 1, Math.floor(levelIdx)));
    while (idx > 0 && !levelUnlocked(this.save, LEVELS[idx].id)) idx--;
    this.levelIdx = idx;
    this.seed = seed ?? (Math.floor(Math.random() * 0xffffff) | 1);
    this.def = LEVELS[idx].make(this.seed);
    const level = makeLevel(this.def);
    this.screens.hide();
    this.decor.setup(level);
    this.world.loadLevel(level);
    this.nightIndex = 0;
    this.checkpoint = null;
    this.steer.setEnabled(true);
    this.enterDay();
    this.onLevelLoaded?.(level);
  }

  /** Exactement ce que fait le bouton « Lancer la nuit ». Appelé aussi par le bot. */
  startNight(): void {
    if (this.state !== 'day') return;
    this.checkpoint = this.world.checkpoint();
    this.world.startNight(this.nightIndex);
    this.state = 'night';
    this.buildPanel.setTarget(null, []);
    this.hud.setPhase('night', this.nightView());
    this.sfx.wave();
  }

  /** `?stress` : mesure du budget de rendu, hors de toute condition de fin. */
  startStress(): void {
    this.startLevel(1);
    this.world.startStress();
  }

  /**
   * Ouvre ou ferme la feuille d'achat selon la proximité. Appelée depuis la boucle
   * de rendu (throttlée) et SYNCHRONEMENT après chaque achat : attendre la frame
   * suivante laisserait une offre déjà payée affichée comme disponible.
   */
  refreshBuildPanel(): void {
    if (this.state !== 'day') {
      this.buildPanel.setTarget(null, []);
      return;
    }
    const near = this.world.buildings.nearSlot;
    const view = near >= 0 ? this.world.buildings.view(near) : null;
    this.buildPanel.setTarget(view, view ? this.world.buildings.offersFor(near, this.world.economy) : []);
  }

  private enterDay(): void {
    this.state = 'day';
    this.world.phase = 'day';
    this.world.nightIndex = this.nightIndex;
    this.world.playing = true;
    this.steer.setEnabled(true);
    this.hud.setInGame(true);
    this.hud.setPhase('day', this.nightView());
    // les bâtiments entamés repartent à neuf, gratuitement : sans ça la dernière
    // nuit se joue derrière un mur de ruines déjà payé, et le joueur ne peut plus
    // que subir ce qu'il a acheté trois nuits plus tôt.
    this.world.buildings.repairAll();
    this.refreshBuildPanel();
  }

  private nightView(): { n: number; total: number; brief: string } {
    const night = this.def.nights[Math.min(this.nightIndex, this.def.nights.length - 1)];
    return { n: night.n, total: this.def.nights.length, brief: night.brief };
  }

  private leaveGame(): void {
    this.world.playing = false;
    this.steer.setEnabled(false);
    this.hud.setInGame(false);
    this.buildPanel.setTarget(null, []);
  }

  private onNightCleared(index: number, sec: number): void {
    if (index >= this.def.nights.length - 1) {
      this.onVictory();
      return;
    }
    this.nightIndex = index + 1;
    // les bâtiments entamés sont réparés au lever du jour (dès qu'ils existeront) :
    // sinon la dernière nuit se joue derrière un mur de ruines et le joueur ne peut
    // que subir ce qu'il a déjà payé.
    this.sfx.pickup();
    this.enterDay();
    this.hud.announce(`Nuit ${index + 1} tenue en ${Math.round(sec)} secondes. Jour ${index + 2}.`);
  }

  private onVictory(): void {
    this.state = 'result';
    this.leaveGame();
    const timeSec = this.world.nightSecTotal;
    const rec = this.save.levels[LEVELS[this.levelIdx].id as MapId];

    // une SEULE écriture par fin de NIVEAU, victoire comme défaite. Le redémarrage
    // ↻ et le retour menu ne flushent pas : assumé, c'est un abandon, pas un score.
    this.save.runs++;
    this.save.wins++;
    rec.cleared = true;
    rec.stars = Math.max(
      rec.stars,
      starsFor(this.world.crib.hp / this.world.crib.maxHp, this.world.buildings.lostBarricades),
    );
    // le critère de record est le temps de nuit cumulé, mais les PV de berceau
    // départagent : finir vite en laissant le berceau en ruine n'est pas mieux
    const better =
      rec.bestNightSec === null ||
      timeSec < rec.bestNightSec ||
      (Math.abs(timeSec - rec.bestNightSec) < 0.5 && this.world.crib.hp > rec.bestCribHp);
    if (better) {
      rec.bestNightSec = timeSec;
      rec.bestCribHp = this.world.crib.hp;
    }
    persist(this.save);
    this.sfx.victory();
    this.screens.showResult({
      victory: true,
      levelName: this.def.name,
      stars: rec.stars,
      night: this.def.nights.length,
      nights: this.def.nights.length,
      timeSec,
      cribHp: this.world.crib.hp,
      cribMax: this.world.crib.maxHp,
      run: this.world.run,
      goldEarned: this.world.economy.earnedTotal,
      record: better,
      canRetryNight: false,
    });
  }

  private onDefeat(): void {
    this.state = 'result';
    this.leaveGame();
    this.save.runs++;
    persist(this.save);
    this.sfx.defeat();
    this.screens.showResult({
      victory: false,
      levelName: this.def.name,
      stars: 0,
      night: this.nightIndex + 1,
      nights: this.def.nights.length,
      timeSec: this.world.nightSecTotal,
      cribHp: 0,
      cribMax: this.world.crib.maxHp,
      run: this.world.run,
      goldEarned: this.world.economy.earnedTotal,
      record: false,
      // deux issues, et c'est un choix de design : recommencer tout le niveau après
      // une erreur de placement de la dernière nuit serait la punition la plus
      // décourageante possible dans un jeu sans méta-progression, où repartir de
      // zéro n'apporte STRICTEMENT rien de nouveau.
      canRetryNight: this.checkpoint !== null,
    });
  }

  /** Rejoue la nuit perdue à partir de l'instantané pris à son lancement. */
  private retryNight(): void {
    if (!this.checkpoint) {
      this.startCampaignLevel(this.levelIdx, this.seed);
      return;
    }
    this.screens.hide();
    this.world.restore(this.checkpoint);
    this.world.endNight();
    this.enterDay();
    this.startNight();
  }

  private toggleMute(): void {
    this.save.muted = !this.save.muted;
    this.sfx.setMuted(this.save.muted);
    persist(this.save);
    this.screens.showMenu(this.save.levels.garden.cleared);
  }
}
